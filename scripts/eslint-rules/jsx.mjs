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

/** How many values one expression may yield before the rest are dropped; a guard, not a limit any code reaches. */
const MAX_VALUES = 16;
const isText = (value) => typeof value === 'string' || typeof value === 'number';
const asNumber = (value) => (typeof value === 'number' ? value
    : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN);

/** `a <operator> b` as JavaScript computes it, for the operators a style is worked out with; undefined for any other. */
function folded(operator, a, b) {
    if (operator === '+') {
        if (typeof a === 'number' && typeof b === 'number') return a + b;
        return isText(a) && isText(b) ? `${a}${b}` : undefined;
    }
    const [x, y] = [asNumber(a), asNumber(b)];
    if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
    return { '-': x - y, '*': x * y, '/': x / y, '%': x % y }[operator];
}

/** A property's key as text: `fontSize`, `'aria-pressed'`, `['role']`; null when computed. */
export function propertyKey(property) {
    if (property.computed) return staticString(property.key);
    if (property.key.type === 'Identifier') return property.key.name;
    return typeof property.key.value === 'string' ? property.key.value : null;
}

/**
 * Every value an expression can evaluate to, through a conditional's
 * branches and a logical's operands: `dark ? '#fff' : '#000'` yields both.
 * Arithmetic and concatenation of known values are worked out (`6 + 4`,
 * `'#' + 'fff'`, `` `${10}px` ``); a template with an unknown hole yields its
 * fixed text. With `through` — `{ sourceCode, follows(name) }` — a name the
 * file binds once is followed to its value, and a constant object's property
 * too (`SIZES.note`), where `follows` allows that name; anything else
 * computed yields nothing.
 */
export function valuesYielded(node, through = null, depth = 0) {
    if (depth > 8) return [];
    const next = (child) => valuesYielded(child, through, depth + 1);
    const bound = (name) => (through && through.follows(name) ? uniqueInitialiser(through.sourceCode, name) : null);
    switch (node?.type) {
        case 'Literal':
            return [node.value];
        case 'UnaryExpression':
            return node.operator === '-' || node.operator === '+'
                ? next(node.argument).map((value) => (node.operator === '-' ? -asNumber(value) : asNumber(value)))
                    .filter((value) => !Number.isNaN(value))
                : [];
        case 'BinaryExpression': {
            const values = next(node.left).flatMap((a) => next(node.right).map((b) => folded(node.operator, a, b)));
            return values.filter((value) => value !== undefined).slice(0, MAX_VALUES);
        }
        case 'TemplateLiteral': {
            const quasi = (index) => node.quasis[index].value.cooked ?? node.quasis[index].value.raw;
            const holes = node.expressions.map((expression) => next(expression).filter(isText));
            if (holes.some((values) => values.length === 0)) return [node.quasis.map((_, index) => quasi(index)).join(' ')];
            return holes.reduce((texts, values, index) => texts.flatMap((text) => values
                .map((value) => `${text}${value}${quasi(index + 1)}`)).slice(0, MAX_VALUES), [quasi(0)]);
        }
        case 'JSXExpressionContainer':
            return next(node.expression);
        case 'ConditionalExpression':
            return [...next(node.consequent), ...next(node.alternate)];
        case 'LogicalExpression':
            return [...next(node.left), ...next(node.right)];
        case 'Identifier': {
            const value = bound(node.name);
            return value ? next(value) : [];
        }
        case 'MemberExpression': {
            const key = node.computed ? staticString(node.property) : node.property.name;
            const object = node.object.type === 'Identifier' && key !== null && through?.follows(key) ? bound(node.object.name) : null;
            const property = object?.type === 'ObjectExpression'
                ? object.properties.find((one) => one.type === 'Property' && propertyKey(one) === key) : null;
            return property ? next(property.value) : [];
        }
        default:
            return [];
    }
}

/**
 * What an object spread does to the attribute `name`: the values it can set,
 * and whether it sets one on every path (`always`), which overwrites what came
 * before. A literal object, either branch of one (`{...(on ? { role: 'tablist' } : {})}`),
 * a spread inside it and an object the file binds once to a name
 * (`{...picker}`) are read; anything else may set nothing.
 */
export function spreadSetting(node, name, sourceCode, depth = 0) {
    const none = { values: [], always: false };
    if (!node || depth > 8) return none;
    const next = (child) => spreadSetting(child, name, sourceCode, depth + 1);
    switch (node.type) {
        case 'ObjectExpression':
            return node.properties.reduce((setting, property) => {
                if (property.type !== 'SpreadElement') {
                    return propertyKey(property) === name ? { values: [property.value], always: true } : setting;
                }
                const inner = next(property.argument);
                return inner.always ? inner : { values: [...setting.values, ...inner.values], always: setting.always };
            }, none);
        case 'ConditionalExpression': {
            const [yes, no] = [next(node.consequent), next(node.alternate)];
            return { values: [...yes.values, ...no.values], always: yes.always && no.always };
        }
        case 'LogicalExpression':
            return { values: [...next(node.left).values, ...next(node.right).values], always: false };
        case 'Identifier': {
            const value = uniqueInitialiser(sourceCode, node.name);
            return value ? next(value) : none;
        }
        default:
            return none;
    }
}

/**
 * Every value the attribute `name` can end up with on an opening element.
 * JSX applies attributes in order, so a later setter overwrites an earlier
 * one: a written attribute always does, a spread only where it sets the name
 * on every path (`spreadSetting`). Each is a value node, `null` for a bare
 * attribute.
 */
export function attributeValues(openingElement, name, sourceCode) {
    return openingElement.attributes.reduce((values, one) => {
        if (one.type !== 'JSXSpreadAttribute') return one.name?.name === name ? [one.value] : values;
        const setting = spreadSetting(one.argument, name, sourceCode);
        return setting.always ? setting.values : [...values, ...setting.values];
    }, []);
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
