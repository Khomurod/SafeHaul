/**
 * functions/index.js as the deploy planner compares it. Every function starts
 * on index.js: the loader around its export statements picks the module
 * FUNCTION_TARGET names (functions/test/unit/functionTarget.test.js).
 *
 * The file is read as its syntax tree (@babel/parser, as scripts/ui-contract/
 * reads JSX), without positions, comments or how a literal was written, so
 * formatting never counts and the meaning always does:
 * - an export's wiring is a statement of exactly the form `exports.X = <module
 *   or its member>;`, alone or under `if (<check>('X'))`, wherever it sits;
 * - in the file's older form, `const x = require('./m')` is wiring when only
 *   wiring reads `x`;
 * - everything else is the loader, which every function runs, and so is a
 *   statement of any other form, export or not.
 */
import { parse } from '@babel/parser';

const SKIPPED = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments']);
const shape = (node) => JSON.stringify(node, (key, value) => (SKIPPED.has(key) ? undefined : value));
const STATEMENT_LISTS = { Program: 'body', BlockStatement: 'body', StaticBlock: 'body', SwitchCase: 'consequent' };

function* children(node) {
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED.has(key)) continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child.type === 'string') yield [key, child];
    }
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

/** Takes every wiring statement in the tree out of it, into `wiring` by export name. */
function takeWiring(node, wiring) {
  const key = STATEMENT_LISTS[node.type];
  if (key) {
    node[key] = node[key].filter((statement) => {
      const name = wiredExport(statement);
      if (name) wiring.set(name, [...(wiring.get(name) || []), statement]);
      return !name;
    });
  }
  for (const [, child] of children(node)) takeWiring(child, wiring);
}

/** Whether `name` is read inside a node: as an identifier, not a property name or key. */
function reads(node, name, skip) {
  if (node === skip) return false;
  for (const [key, child] of children(node)) {
    if (child === skip) continue;
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
  const wiring = new Map();
  takeWiring(program, wiring);
  const wired = [...wiring.values()].flat();
  program.body = program.body.filter((statement) => {
    const name = moduleVariable(statement);
    return !name || !wired.some((wire) => reads(wire, name)) || reads(program, name, statement);
  });
  return {
    exports: new Map([...wiring].map(([name, statements]) => [name, statements.map(shape).join('\n')])),
    loader: shape(program),
  };
}
