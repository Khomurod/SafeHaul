/**
 * functions/index.js as the deploy planner compares it. Every function starts
 * on index.js: the loader around its export statements picks the module
 * FUNCTION_TARGET names (functions/test/unit/functionTarget.test.js).
 *
 * The file is read as its syntax tree (@babel/parser, as scripts/ui-contract/
 * reads JSX), without positions, comments or how a literal was written, so
 * formatting never counts and the meaning always does:
 * - an export's wiring is a statement of exactly the form `exports.X = <module
 *   or its member>;`, alone or under `if (<check>('X'))`, with its place among
 *   the loader's statements;
 * - in the file's older form, `const x = require('./m')` that only wiring reads
 *   is wiring of the exports that read it, with its place too;
 * - everything else is the loader, which every function runs, and so is a
 *   statement of any other form, export or not.
 * The order of wiring statements among themselves does not count: a deployed
 * function loads only its own module.
 */
import { parse } from '@babel/parser';

const SKIPPED = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments']);
const shape = (node) => JSON.stringify(node, (key, value) => (SKIPPED.has(key) ? undefined : value));
const STATEMENT_LISTS = { Program: 'body', BlockStatement: 'body', StaticBlock: 'body', SwitchCase: 'consequent' };

/** A node's child nodes, each with its key and its step in a path. */
function* children(node) {
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED.has(key)) continue;
    if (Array.isArray(value)) {
      for (const [index, child] of value.entries()) if (child && typeof child.type === 'string') yield [key, child, `${key}[${index}]`];
    } else if (value && typeof value.type === 'string') yield [key, value, key];
  }
}

const isString = (node, test) => node?.type === 'StringLiteral' && test(node.value);
const isRequire = (node) => node?.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require'
  && node.arguments.length === 1 && isString(node.arguments[0], (value) => value.startsWith('./'));

/** A module, a module variable, or a member of one: what wiring may assign. */
function isModuleReference(node) {
  if (node.type === 'Identifier' || isRequire(node)) return true;
  return node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier' && isModuleReference(node.object);
}

/** The export a statement wires (see the header), or null. */
function wiredExport(statement) {
  let body = statement;
  let check = null;
  if (statement.type === 'IfStatement' && !statement.alternate) {
    check = statement.test;
    const { consequent } = statement;
    body = consequent.type === 'BlockStatement' && consequent.body.length === 1 ? consequent.body[0] : consequent;
  }
  const assignment = body.type === 'ExpressionStatement' ? body.expression : null;
  const target = assignment?.type === 'AssignmentExpression' && assignment.operator === '=' ? assignment.left : null;
  if (target?.type !== 'MemberExpression' || target.computed || target.object.type !== 'Identifier'
      || target.object.name !== 'exports' || target.property.type !== 'Identifier') return null;
  const name = target.property.name;
  const ownCheck = !check || (check.type === 'CallExpression' && check.callee.type === 'Identifier' && check.callee.name !== 'require'
    && check.arguments.length === 1 && isString(check.arguments[0], (value) => value === name));
  return ownCheck && isModuleReference(assignment.right) ? name : null;
}

/** The wiring statements in the tree, each with its export's name. */
function collectWiring(node, found = new Map()) {
  const listKey = STATEMENT_LISTS[node.type];
  for (const [key, child] of children(node)) {
    const name = key === listKey ? wiredExport(child) : null;
    if (name) found.set(child, name);
    else collectWiring(child, found);
  }
  return found;
}

/** Takes the given statements out of the tree, each with its list and its slot: how many loader statements precede it there. */
function takeOut(node, wiring, taken = []) {
  const listKey = STATEMENT_LISTS[node.type];
  if (listKey) {
    const kept = [];
    for (const statement of node[listKey]) {
      const names = wiring.get(statement);
      if (names) taken.push({ list: node, slot: kept.length, statement, names });
      else kept.push(statement);
    }
    node[listKey] = kept;
  }
  for (const [, child] of children(node)) takeOut(child, wiring, taken);
  return taken;
}

/** The path of every statement list in the tree. */
function listPaths(node, path = '', paths = new Map()) {
  if (STATEMENT_LISTS[node.type]) paths.set(node, path);
  for (const [, child, step] of children(node)) listPaths(child, `${path}/${step}`, paths);
  return paths;
}

/** Whether `name` is read inside a node, outside the `skip` nodes: as an identifier, not a property name or key. */
function reads(node, name, skip = new Set()) {
  for (const [key, child] of children(node)) {
    if (skip.has(child)) continue;
    const isName = child.type === 'Identifier' && child.name === name
      && !(key === 'property' && node.type === 'MemberExpression' && !node.computed)
      && !(key === 'key' && /Property|Method/.test(node.type) && !node.computed);
    if (isName || reads(child, name, skip)) return true;
  }
  return false;
}

/** `const x = require('./m')`: the name, or null. */
function moduleVariable(statement) {
  const [declaration, ...more] = statement.type === 'VariableDeclaration' ? statement.declarations : [];
  return isRequire(declaration?.init) && !more.length && declaration.id.type === 'Identifier' ? declaration.id.name : null;
}

/**
 * An index.js source as `{ exports, loader }`: each export's wiring and the
 * loader, each as one comparable string. Throws when the source does not parse.
 */
export function indexParts(src) {
  const { program } = parse(src, { sourceType: 'script', allowReturnOutsideFunction: true });
  const found = collectWiring(program);
  const wiring = new Map([...found].map(([statement, name]) => [statement, [name]]));
  for (const statement of program.body) {
    const variable = moduleVariable(statement);
    const readers = variable ? [...found.keys()].filter((wire) => reads(wire, variable)) : [];
    if (readers.length && !reads(program, variable, new Set([statement, ...found.keys()]))) {
      wiring.set(statement, readers.map((wire) => found.get(wire)));
    }
  }
  const taken = takeOut(program, wiring);
  const paths = listPaths(program);
  const exports = new Map();
  for (const { list, slot, statement, names } of taken) {
    const piece = `${paths.get(list)}@${slot} ${shape(statement)}`;
    for (const name of new Set(names)) exports.set(name, [...(exports.get(name) || []), piece]);
  }
  return {
    exports: new Map([...exports].map(([name, pieces]) => [name, pieces.join('\n')])),
    loader: shape(program),
  };
}
