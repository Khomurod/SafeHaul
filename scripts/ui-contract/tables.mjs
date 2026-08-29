/**
 * The native-table exception, checked rather than trusted.
 *
 * The roadmap approves native tables for editable matrices, so a `<table>` is not
 * a violation by itself. This is what stops that approval becoming a blanket one:
 * an approved table still has to carry the contract token, and this parses the
 * file to find out rather than grepping for it.
 */

import { parse } from '@babel/parser';

export function tablesOffContract(source, contractToken) {
    const ast = parse(source, {
        sourceType: 'module',
        plugins: ['jsx'],
        errorRecovery: false,
    });

    /* A token counts only as a whole class, delimited by whitespace or an edge. */
    const tokenIn = (text) => String(text).split(/\s+/).filter(Boolean).includes(contractToken);

    /*
     * The same, for one chunk of a template literal — where a token can be
     * extended by an interpolation sitting against it.
     *
     *     `ds-native-table ${density}`   token followed by a space: safe
     *     `ds-native-table${suffix}`     token runs into the hole: NOT safe
     *
     * Round five of this rule was exactly that: the quasi split to
     * ['ds-native-table'] and looked certain while one branch of the
     * interpolation rendered `ds-native-table-broken`. A token touching a quasi
     * edge only counts when that edge is the edge of the whole template rather
     * than an interpolation, so an open edge is padded with a non-space to make
     * the token un-whole.
     */
    const tokenInQuasi = (raw, openAtStart, openAtEnd) => tokenIn(
        `${openAtStart ? 'x' : ' '}${raw}${openAtEnd ? 'x' : ' '}`,
    );

    /*
     * True only when every path through `node` yields a class list containing a
     * token. Anything this cannot PROVE is a violation.
     *
     * ## Why the accepted set is deliberately small
     *
     * The first version of this walk also trusted `CallExpression`,
     * `ArrayExpression` and `+` concatenation, reasoning that their parts are all
     * joined. Round six showed that was my reasoning rather than JavaScript's:
     * `selectClass('ds-native-table', 'other')` is a call whose arguments are
     * NOT all joined, and nothing in the syntax says which kind of call it is.
     * Whitelisting known combiners would work, but this repository contains no
     * `clsx`, `classnames` or `cx`, and all fifteen real `<table>` classNames are
     * plain string literals — so each of those branches was accommodating a form
     * that does not exist, and each guess at its semantics became a false pass.
     *
     * They are gone. What remains is the set whose meaning is unambiguous, which
     * covers every real call site. A form outside it fails loudly, and extending
     * the set then means adding a branch WITH a test rather than an assumption.
     */
    const certainlyTokenised = (node) => {
        if (!node) return false;
        switch (node.type) {
            case 'StringLiteral':
                return tokenIn(node.value);
            case 'JSXExpressionContainer':
            case 'ParenthesizedExpression':
            case 'TSAsExpression':
            case 'TSNonNullExpression':
                return certainlyTokenised(node.expression);
            case 'TemplateLiteral':
                return node.quasis.some((quasi, index) => tokenInQuasi(
                    quasi.value.cooked ?? quasi.value.raw,
                    index > 0,
                    index < node.quasis.length - 1,
                ));
            case 'ConditionalExpression':
                return certainlyTokenised(node.consequent) && certainlyTokenised(node.alternate);
            case 'LogicalExpression':
                // `a || b` and `a ?? b` yield one side or the other, so both must
                // carry it. `a && b` yields a falsy `a` — no class at all — so it
                // can never be certain.
                if (node.operator === '&&') return false;
                return certainlyTokenised(node.left) && certainlyTokenised(node.right);
            default:
                // Identifier, member expression, any call, array, concatenation,
                // object form, anything else: not provable, therefore not allowed.
                return false;
        }
    };

    const offContract = [];
    let total = 0;
    const walk = (node) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (node.type === 'JSXOpeningElement' && node.name?.type === 'JSXIdentifier'
            && node.name.name === 'table') {
            total += 1;
            /*
             * The LAST attribute that can set the class list is the one that
             * decides it. JSX applies attributes in order, so a later duplicate
             * or a later spread overrides an earlier `className` at runtime:
             *
             *     <table className="ds-native-table" {...props}>
             *     <table className="ds-native-table" className={other}>
             *
             * Taking the first match and ignoring what follows was the seventh
             * demonstrated bypass of this rule, reproduced in `AssignmentTable`.
             *
             * Unlike the expression space, this one is CLOSED: an opening
             * element's attributes are exactly `JSXAttribute | JSXSpreadAttribute`
             * and there is no third way to set a prop. So "find the last setter
             * and require it to be a provable class" is complete over the
             * grammar rather than another guess. A spread BEFORE the class is
             * fine — the class still wins — and this allows it.
             */
            let lastSetter = null;
            for (const attribute of node.attributes) {
                if (attribute.type === 'JSXSpreadAttribute') {
                    lastSetter = { spread: true };
                } else if (attribute.type === 'JSXAttribute'
                    && (attribute.name?.name === 'className' || attribute.name?.name === 'class')) {
                    lastSetter = { value: attribute.value };
                }
            }
            if (lastSetter?.spread || !certainlyTokenised(lastSetter?.value)) {
                offContract.push(node.loc?.start?.line ?? 0);
            }
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments') continue;
            walk(node[key]);
        }
    };
    walk(ast.program);
    return { offContract, total };
}
