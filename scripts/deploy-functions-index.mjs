/**
 * functions/index.js as the deploy planner compares it. Every function starts
 * on index.js: the loader around its export statements picks the module
 * FUNCTION_TARGET names (functions/test/unit/functionTarget.test.js).
 *
 * The file is read as its syntax tree (@babel/parser, as scripts/ui-contract/
 * reads JSX), without positions, comments or how a literal was written, so
 * formatting never counts and the meaning always does:
 * - an export's wiring is a statement of exactly the form
 *   `if (wanted('X')) exports.X = <module or its member>;`, with its place among
 *   the loader's statements, inside a function whose only parameter is the
 *   selector it calls (`wanted`, or any name the file declares and assigns
 *   nowhere else): every function asks the selector, which the loader passes in,
 *   and only the function named X goes on to run the rest;
 * - everything else is the loader, which every function runs: a statement of any
 *   other form, export or not, and so every unconditional `require()` of the
 *   file's older form, where each function loaded every module.
 * The order of wiring statements among themselves does not count: a deployed
 * function runs only its own.
 */
import { parse } from '@babel/parser';

const SKIPPED = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments']);
const shape = (node) => JSON.stringify(node, (key, value) => (SKIPPED.has(key) ? undefined : value));
const STATEMENT_LISTS = { Program: 'body', BlockStatement: 'body', StaticBlock: 'body', SwitchCase: 'consequent' };
const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);

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

/** The names a pattern declares or assigns: `a`, `{ a, b: [c] }`, `a = 1`, `...a`. */
function* namesIn(pattern) {
  if (pattern?.type === 'Identifier') yield pattern.name;
  else if (pattern?.type === 'AssignmentPattern') yield* namesIn(pattern.left);
  else if (pattern?.type === 'RestElement') yield* namesIn(pattern.argument);
  else if (pattern?.type === 'ArrayPattern') for (const element of pattern.elements) yield* namesIn(element);
  else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) yield* namesIn(property.type === 'RestElement' ? property : property.value);
}

/** How many times the tree declares or assigns each name. */
function writesTo(node, counts = new Map()) {
  const patterns = FUNCTIONS.has(node.type) ? [node.id, ...node.params]
    : { VariableDeclarator: [node.id], ClassDeclaration: [node.id], ClassExpression: [node.id], CatchClause: [node.param],
      AssignmentExpression: [node.left], UpdateExpression: [node.argument], ForInStatement: [node.left], ForOfStatement: [node.left] }[node.type] || [];
  for (const pattern of patterns) for (const name of namesIn(pattern)) counts.set(name, (counts.get(name) || 0) + 1);
  for (const [, child] of children(node)) writesTo(child, counts);
  return counts;
}

/** The selector a function's wiring calls: its only parameter, if nothing else declares or assigns that name. */
function selectorOf(fn, writes) {
  const [param, ...rest] = fn.params;
  return param?.type === 'Identifier' && rest.length === 0 && writes.get(param.name) === 1 ? param.name : null;
}

/** The export a statement wires (see the header), or null. */
function wiredExport(statement, selector) {
  if (statement.type !== 'IfStatement' || statement.alternate) return null;
  const { test: check, consequent } = statement;
  const body = consequent.type === 'BlockStatement' && consequent.body.length === 1 ? consequent.body[0] : consequent;
  const assignment = body.type === 'ExpressionStatement' ? body.expression : null;
  const target = assignment?.type === 'AssignmentExpression' && assignment.operator === '=' ? assignment.left : null;
  if (target?.type !== 'MemberExpression' || target.computed || target.object.type !== 'Identifier'
      || target.object.name !== 'exports' || target.property.type !== 'Identifier') return null;
  const name = target.property.name;
  const ownCheck = check.type === 'CallExpression' && check.callee.type === 'Identifier' && check.callee.name === selector
    && check.arguments.length === 1 && isString(check.arguments[0], (value) => value === name);
  return ownCheck && isModuleReference(assignment.right) ? name : null;
}

/** The wiring statements in the tree, each with its export's name. */
function collectWiring(node, writes, selector = null, found = new Map()) {
  const listKey = STATEMENT_LISTS[node.type];
  const own = FUNCTIONS.has(node.type) ? selectorOf(node, writes) : selector;
  for (const [key, child] of children(node)) {
    const name = key === listKey && own ? wiredExport(child, own) : null;
    if (name) found.set(child, name);
    else collectWiring(child, writes, own, found);
  }
  return found;
}

/**
 * Takes the given statements out of the tree, each with its list and its slot:
 * how many loader statements precede it there. An empty statement in a list
 * (`;;`) does nothing, and leaves too.
 */
function takeOut(node, wiring, taken = []) {
  const listKey = STATEMENT_LISTS[node.type];
  if (listKey) {
    const kept = [];
    for (const statement of node[listKey]) {
      if (statement.type === 'EmptyStatement') continue;
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

/**
 * An index.js source as `{ exports, loader }`: each export's wiring and the
 * loader, each as one comparable string. Throws when the source does not parse.
 */
export function indexParts(src) {
  const { program } = parse(src, { sourceType: 'script', allowReturnOutsideFunction: true });
  const wiring = new Map([...collectWiring(program, writesTo(program))].map(([statement, name]) => [statement, [name]]));
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
