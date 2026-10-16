/**
 * Reading JSX in ESLint's syntax tree, for the design-system rules.
 *
 * The questions are about elements and attributes, never about characters
 * between `<` and `>`: which element this is, whether it carries an attribute,
 * which attribute decides its class list, and whether every path through an
 * expression certainly yields a class. `lastClassSetter` and `certainlyText`
 * answer the same questions as `scripts/ui-contract/jsx.mjs`, over ESLint's
 * tree (`Literal`) instead of Babel's (`StringLiteral`), and
 * `scripts/test-lint-rules.mjs` §O drives them over every bypass that module
 * was hardened against.
 */

/** A lowercase host element's name (`button`, `table`, `h3`), or a component's; `null` for `<a.b>`. */
export function elementName(openingElement) {
    return openingElement.name?.type === 'JSXIdentifier' ? openingElement.name.name : null;
}

/** The attribute named `name` on an opening element, or `undefined`. */
export function attribute(openingElement, name) {
    return openingElement.attributes.find((one) => one.type === 'JSXAttribute' && one.name?.name === name);
}

/**
 * The text an attribute value or expression certainly is: `"x"`, `{'x'}`,
 * `` {`x`} `` with no hole. Anything computed is `null`.
 */
export function staticString(node) {
    if (!node) return null;
    if (node.type === 'JSXExpressionContainer') return staticString(node.expression);
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
    return null;
}

/**
 * The attribute that decides the class list: JSX applies attributes in order,
 * so a later `className` or a later spread wins. Attributes are exactly
 * `JSXAttribute | JSXSpreadAttribute`, so this is complete over the grammar.
 *
 * @returns {{spread: true} | {value: object|null} | null}
 */
export function lastClassSetter(openingElement) {
    let last = null;
    for (const one of openingElement.attributes) {
        if (one.type === 'JSXSpreadAttribute') last = { spread: true };
        else if (one.name?.name === 'className' || one.name?.name === 'class') last = { value: one.value };
    }
    return last;
}

/**
 * One template chunk, padded so an interpolation cannot lend it a word
 * boundary it does not have: in `` `ds-native-table${x}` `` the token runs into
 * the hole, and one branch renders `ds-native-table-broken`.
 */
const paddedQuasi = (text, openAtStart, openAtEnd) => `${openAtStart ? 'x' : ' '}${text}${openAtEnd ? 'x' : ' '}`;

/**
 * True only when EVERY path through `node` yields text satisfying `matches`.
 * The accepted forms are the ones whose meaning is unambiguous: a string, a
 * template chunk, a conditional or `||` / `??` with both sides certain.
 * `&&` can yield nothing; a call, an array, concatenation or a bare name cannot
 * be proved, so each is false.
 */
export function certainlyText(node, matches) {
    if (!node) return false;
    switch (node.type) {
        case 'Literal':
            return typeof node.value === 'string' && matches(node.value);
        case 'JSXExpressionContainer':
            return certainlyText(node.expression, matches);
        case 'TemplateLiteral':
            return node.quasis.some((quasi, index) => matches(paddedQuasi(
                quasi.value.cooked ?? quasi.value.raw, index > 0, index < node.quasis.length - 1,
            )));
        case 'ConditionalExpression':
            return certainlyText(node.consequent, matches) && certainlyText(node.alternate, matches);
        case 'LogicalExpression':
            return node.operator !== '&&'
                && certainlyText(node.left, matches) && certainlyText(node.right, matches);
        default:
            return false;
    }
}

/** Every string and template chunk anywhere inside `node`: the text a class expression can yield. */
export function stringsIn(node, visitorKeys, out = []) {
    if (!node || typeof node.type !== 'string') return out;
    if (node.type === 'Literal' && typeof node.value === 'string') out.push(node.value);
    if (node.type === 'TemplateElement') out.push(node.value.cooked ?? node.value.raw);
    for (const key of visitorKeys[node.type] ?? []) {
        for (const child of [node[key]].flat()) stringsIn(child, visitorKeys, out);
    }
    return out;
}

/**
 * The initialiser of `name` when the file binds that name exactly once — one
 * `const`/`let`/`var` declarator with an initialiser, never written again — or
 * `null`. A second binding of the name anywhere in the file (a parameter, an
 * import, a catch clause, a function) refuses it, as an assignment to it does:
 * a class list that cannot be proved is not judged.
 */
export function uniqueInitialiser(sourceCode, name) {
    const { scopeManager } = sourceCode;
    const variables = scopeManager.scopes.flatMap((scope) => scope.variables)
        .filter((variable) => variable.name === name && variable.defs.length > 0);
    if (variables.length !== 1 || variables[0].defs.length !== 1) return null;
    const [variable] = variables;
    const [definition] = variable.defs;
    if (definition.type !== 'Variable' || definition.node.id.type !== 'Identifier' || !definition.node.init) return null;
    if (variable.references.some((reference) => reference.isWrite() && !reference.init)) return null;
    if (scopeManager.globalScope.through.some((reference) => reference.identifier.name === name && reference.isWrite())) {
        return null;
    }
    return definition.node.init;
}
