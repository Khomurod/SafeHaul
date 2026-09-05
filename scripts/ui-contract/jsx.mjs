/**
 * The JSX reading shared by the rules that need a parser rather than a regex.
 *
 * Two rules need one, for the same reason: what a class list *is* cannot be
 * decided by looking at the characters between `<` and `>`. `tables.mjs` asks
 * whether a `<table>` certainly carries the contract token; `bindings.mjs` asks
 * whether a control's class list — hoisted into a variable — certainly styles it.
 * Both questions are "does every path through this expression yield text that
 * satisfies a predicate", and both need the same answer to "which attribute
 * actually sets the class".
 *
 * They lived in `tables.mjs` first, where the second caller would have had to
 * copy them. A copy of `lastClassSetter` is the interesting one to avoid: it
 * encodes seven rounds of demonstrated bypasses, and the copy would have started
 * at round one.
 */

import { parse } from '@babel/parser';

/**
 * Parse a source file as a JSX module.
 *
 * `errorRecovery: false` deliberately: a file this cannot parse is a file whose
 * class lists this cannot judge, and a guard that shrugs at unreadable input is
 * the failure mode this repository keeps writing down. The throw reaches the
 * caller, which fails the run.
 */
export function parseModule(source) {
    return parse(source, { sourceType: 'module', plugins: ['jsx'], errorRecovery: false });
}

/** Every node in the tree, `loc` and comment back-references excluded. */
export function walkAst(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((child) => walkAst(child, visit)); return; }
    if (typeof node.type === 'string') visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
        walkAst(node[key], visit);
    }
}

/**
 * The attribute that actually decides the class list, or `null` for none.
 *
 * JSX applies attributes in order, so a later duplicate or a later spread
 * overrides an earlier `className` at runtime:
 *
 *     <table className="ds-native-table" {...props}>
 *     <table className="ds-native-table" className={other}>
 *
 * Taking the first match and ignoring what follows was the seventh demonstrated
 * bypass of the table rule, reproduced in `AssignmentTable`.
 *
 * Unlike the expression space, this one is CLOSED: an opening element's
 * attributes are exactly `JSXAttribute | JSXSpreadAttribute` and there is no
 * third way to set a prop. So "find the last setter" is complete over the
 * grammar rather than another guess. A spread BEFORE the class is fine — the
 * class still wins — and this reports the class.
 *
 * @returns {{spread: true} | {value: object|null} | null}
 */
export function lastClassSetter(openingElement) {
    let last = null;
    for (const attribute of openingElement.attributes ?? []) {
        if (attribute.type === 'JSXSpreadAttribute') {
            last = { spread: true };
        } else if (attribute.type === 'JSXAttribute'
            && (attribute.name?.name === 'className' || attribute.name?.name === 'class')) {
            last = { value: attribute.value };
        }
    }
    return last;
}

/**
 * One chunk of a template literal, padded so an interpolation cannot lend it a
 * word boundary it does not have.
 *
 *     `ds-native-table ${density}`   token followed by a space: safe
 *     `ds-native-table${suffix}`     token runs into the hole: NOT safe
 *
 * Round five of the table rule was exactly that: the quasi split to
 * ['ds-native-table'] and looked certain while one branch of the interpolation
 * rendered `ds-native-table-broken`. A chunk edge only counts as a real edge
 * when it is the edge of the whole template, so an open edge is padded with a
 * word character — which breaks a whole-class match and a `\b` alike.
 */
export function paddedQuasi(raw, openAtStart, openAtEnd) {
    return `${openAtStart ? 'x' : ' '}${raw}${openAtEnd ? 'x' : ' '}`;
}

/**
 * True only when EVERY path through `node` yields text satisfying `matches`.
 * Anything this cannot prove is false.
 *
 * ## Why the accepted set is deliberately small
 *
 * The first version of the table walk also trusted `CallExpression`,
 * `ArrayExpression` and `+` concatenation, reasoning that their parts are all
 * joined. Round six showed that was reasoning rather than JavaScript's:
 * `selectClass('ds-native-table', 'other')` is a call whose arguments are NOT
 * all joined, and nothing in the syntax says which kind of call it is.
 * Whitelisting known combiners would work, but this repository contains no
 * `clsx`, `classnames` or `cx` — so each of those branches was accommodating a
 * form that does not exist, and each guess at its semantics became a false pass.
 *
 * They are gone. What remains is the set whose meaning is unambiguous. A form
 * outside it is not provable, so extending the set means adding a branch WITH a
 * test rather than an assumption.
 */
export function certainlyText(node, matches) {
    if (!node) return false;
    switch (node.type) {
        case 'StringLiteral':
            return matches(node.value);
        case 'JSXExpressionContainer':
        case 'ParenthesizedExpression':
        case 'TSAsExpression':
        case 'TSNonNullExpression':
            return certainlyText(node.expression, matches);
        case 'TemplateLiteral':
            return node.quasis.some((quasi, index) => matches(paddedQuasi(
                quasi.value.cooked ?? quasi.value.raw,
                index > 0,
                index < node.quasis.length - 1,
            )));
        case 'ConditionalExpression':
            return certainlyText(node.consequent, matches)
                && certainlyText(node.alternate, matches);
        case 'LogicalExpression':
            // `a || b` and `a ?? b` yield one side or the other, so both must
            // carry it. `a && b` yields a falsy `a` — no text at all — so it
            // can never be certain.
            if (node.operator === '&&') return false;
            return certainlyText(node.left, matches) && certainlyText(node.right, matches);
        default:
            // Identifier, member expression, any call, array, concatenation,
            // object form, anything else: not provable, therefore not allowed.
            return false;
    }
}
