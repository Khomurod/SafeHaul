/**
 * `ds/use-primitive` — markup the design system already builds, written by
 * hand at a call site.
 *
 * Each check is scoped to what its primitive actually replaces — the scopes
 * the UI-contract checker settled by measuring candidate rules on the tree:
 *
 * - a styled control is a raw `<button>`, `<a>`, `<input>`, `<select>` or
 *   `<textarea>` whose class list carries padding, a background, a border, a
 *   radius, a type size or a height, arbitrary values included (`p-[13px]`) —
 *   a bare one (a tab, a cell trigger) is
 *   fine. A class list held in a variable counts only when the file binds the
 *   name once, to text that styles on every path; `className={props.className}`
 *   is a pass-through and is never judged;
 * - a toggle is a raw `<button>` or `<a>` with `aria-pressed`, a current item a
 *   raw `<button>` with `aria-current` (a `<li aria-current="step">` read rather
 *   than operated has no primitive), a disclosure a raw `<button aria-expanded>`
 *   INSIDE a lowercase heading — menu, combobox and drawer triggers wear
 *   `aria-expanded` too and are not this;
 * - a tab strip is `role="tablist"`, a file picker `<input type="file">`, a new
 *   tab `target="_blank"` — each in any case, on any branch and through a
 *   name bound once (`type={uploading ? 'file' : 'text'}`), and as markup in a
 *   string — an overlay a class list holding `fixed` and
 *   `inset-0` on some path, wherever its strings are split
 *   (`clsx('fixed', 'inset-0')`, `'fixed ' + 'inset-0'`, an array joined, the
 *   keys of `clsx({ fixed: open, 'inset-0': open })`);
 * - and nine primitives throw on a label that is not a string, so a JSX
 *   `label` on one is a crash the moment that branch renders.
 *
 * An attribute counts whether it is written on the element or in an object
 * the element spreads (`<input {...{ type: 'file' }} />`, `{...picker}`), and
 * as JSX applies it: a later setter overwrites an earlier one.
 *
 * A component (`<Button aria-pressed>`) is never judged: what it does with a
 * prop is its own contract. `skip` turns checks off for a scope (the design
 * system is the toggle and the current item; a story demonstrates markup), and
 * `exceptions` for a file, with its reason.
 */

import {
    CHECKS, exceptedChecks, locate, optionsSchema,
} from './context.mjs';
import {
    attributeValues, certainlyText, elementName, lastClassSetter, memberValue, stringsIn, uniqueInitialiser, valuesYielded,
} from './jsx.mjs';

/** The app's type scale, `theme.fontSize` (`scripts/test-lint-rules.mjs` §O keeps the two the same). */
const TYPE_SCALE = 'ds-(?:xs|sm|body(?:-lg)?|heading-(?:sm|md|lg|xl)|control-mobile)|voe-(?:xs|sm|lg|xl|2xl|4xl)';

/**
 * Classes that decide a control's geometry or colour rather than its layout,
 * each read from the start of a class: a type size from the scale counts, a
 * text colour (`text-ds-border`) does not.
 */
export const STYLING_SIGNAL = new RegExp('(?<![\\w-])(?:(?:p|px|py|pt|pb|pl|pr|ps|pe)-(?:\\d|ds-|\\[)|bg-|border(?:-|\\b)|rounded'
    + `|text-(?:xs|sm|base|lg|xl|\\[|(?:${TYPE_SCALE})(?![\\w-]))|(?:h|size)-(?:\\d|\\[)|min-h-)`);

const STYLED_CONTROL = {
    button: 'hand-styled-button',
    a: 'hand-styled-anchor',
    input: 'hand-styled-field',
    select: 'hand-styled-field',
    textarea: 'hand-styled-field',
};

/** The primitives whose `label` must be a non-empty string; anything else throws. */
export const THROWS_ON_NON_STRING_LABEL = new Set([
    'FormField', 'FieldDisplay', 'Checkbox', 'Radio', 'Switch',
    'IconButton', 'IconButtonLink', 'FileInput', 'ProgressBar',
]);

const HEADING = /^h[1-6]$/;
/* HTML reads attribute names and these values in any case, quoted or not. */
const MARKUP_IN_TEXT = [
    ['hand-written-target-blank', /(?<![\w-])target\s*=\s*(["']?)_blank\1(?![\w-])/gi],
    ['hand-rolled-tablist', /(?<![\w-])role\s*=\s*["']?(?:[\w-]+\s+)*tablist(?![\w-])/gi],
    ['raw-file-input', /<input\b[^>]*?(?<![\w-])type\s*=\s*["']?file(?![\w-])/gi],
];

/** Can this attribute's value be one that passes `test`, on some branch, through a name bound once, in any case? */
const mayBe = (value, test, through) => valuesYielded(value, through)
    .some((one) => typeof one === 'string' && test(one.toLowerCase()));
const isFile = (type) => type === 'file';
const isTablist = (role) => role.split(/\s+/).includes('tablist');
const isBlank = (target) => target === '_blank';

const MESSAGES = {
    'hand-styled-button': 'A hand-styled `<button>`. Use `Button` or `IconButton`; a `<button>` with no '
        + 'styling of its own (a tab, a cell trigger) is fine.',
    'hand-styled-field': 'A hand-styled `<{{element}}>`. Use `Input`, `Select`, `Textarea` or `FileInput` in a '
        + '`FormField`: a hand-styled control misses the shared control height.',
    'hand-styled-anchor': 'A hand-styled `<a>`. Use `Link`, `ButtonLink` or `IconButtonLink`.',
    'raw-file-input': 'A raw `<input type="file">`. Use `FileInput`: a real focusable input behind a label, '
        + 'with the keyboard path a hidden input behind a `<div onClick>` lacks.',
    'hand-rolled-tablist': 'A hand-rolled `role="tablist"`. Use `TabList` / `TabPanel`, which carry the roving '
        + '`tabIndex`, arrow/Home/End and the `aria-controls` pairing.',
    'hand-rolled-toggle': 'A raw `<{{element}} aria-pressed>`. Use `Chip`, `SegmentedControl`, or `Button` / '
        + '`IconButton` with `pressed`.',
    'hand-rolled-current': 'A raw `<button aria-current>`. Use `SelectableCard` with `current`, or '
        + '`SectionNavigation` for a rail.',
    'hand-rolled-disclosure': 'A `<button aria-expanded>` inside a heading is a disclosure. Use `Disclosure`.',
    'hand-written-target-blank': 'A hand-written `target="_blank"`. Pass `external` to `Link` / `ButtonLink` / '
        + '`IconButtonLink`: the only form that announces the new tab (WCAG 3.2.5) and sets `rel`.',
    'hand-built-overlay': 'A hand-built `fixed inset-0` overlay. Every overlay goes through `Modal` '
        + '(`@design-system/patterns`), which owns the backdrop, the focus trap and Escape.',
    'jsx-label-on-throwing-primitive': '`{{element}}` throws on a `label` that is not a string, so JSX here '
        + 'crashes the moment it renders. Pass the words as a string; put an icon beside the control.',
};

/** May this attribute value yield JSX on some path, through a name or a constant object's property? */
function mayBeJsx(node, sourceCode, depth = 0) {
    if (!node || depth > 8) return false;
    const next = (child) => mayBeJsx(child, sourceCode, depth + 1);
    switch (node.type) {
        case 'JSXElement':
        case 'JSXFragment':
            return true;
        case 'JSXExpressionContainer':
            return next(node.expression);
        case 'ConditionalExpression':
            return next(node.consequent) || next(node.alternate);
        case 'LogicalExpression':
            return next(node.left) || next(node.right);
        case 'Identifier':
            return next(uniqueInitialiser(sourceCode, node.name));
        case 'MemberExpression':
            return next(memberValue(node, sourceCode));
        default:
            return false;
    }
}

/** Is this element inside a lowercase heading's body (not its open tag)? */
function insideHeading(openingElement) {
    let child = openingElement.parent;
    for (let ancestor = child.parent; ancestor; child = ancestor, ancestor = ancestor.parent) {
        if (ancestor.type === 'JSXElement' && child !== ancestor.openingElement
            && HEADING.test(elementName(ancestor.openingElement) ?? '')) return true;
    }
    return false;
}

/** A class token, without its variants and `!`: `md:!fixed` is `fixed`. */
const bareClass = (token) => token.split(':').pop().replace(/^!/, '');

/*
 * A hand-built overlay is `fixed` and `inset-0` in one class list, on some
 * path. A path is the pair of bits its strings add and the conditions it
 * assumes: a string under `open &&` and one under `!open &&` are never on the
 * same path, as two keys of `clsx({ fixed: open, 'inset-0': !open })` are
 * not. An expression yields the few paths it can, so every combination is
 * cheap to follow; past `MAX_PATHS` the conditions are dropped, which can only
 * add paths.
 */
const FIXED = 1;
const INSET = 2;
const MAX_PATHS = 64;
const path = (bits, assumes = {}) => ({ bits, assumes });
const NOTHING = [path(0)];
const overlayBits = (text) => text.split(/\s+/).map(bareClass)
    .reduce((bits, name) => bits | (name === 'fixed' ? FIXED : 0) | (name === 'inset-0' ? INSET : 0), 0);
function distinct(paths) {
    const unique = [...new Map(paths.map((one) => [`${one.bits}|${Object.entries(one.assumes).sort().join()}`, one])).values()];
    return unique.length > MAX_PATHS ? [...new Set(unique.map((one) => one.bits))].map((bits) => path(bits)) : unique;
}
const agree = (a, b) => Object.entries(a.assumes).every(([atom, value]) => !(atom in b.assumes) || b.assumes[atom] === value);
const joined = (left, right) => distinct(left.flatMap((a) => right.filter((b) => agree(a, b))
    .map((b) => path(a.bits | b.bits, { ...a.assumes, ...b.assumes }))));
const either = (left, right) => distinct([...left, ...right]);

/** A condition as an atom of source text and the atom's value that makes it true: `!open` is `open` false. */
function conditionOf(node, text) {
    let value = true;
    let inner = node;
    while (inner?.type === 'UnaryExpression' && inner.operator === '!') {
        value = !value;
        inner = inner.argument;
    }
    return inner ? { atom: text(inner).replace(/\s+/g, ''), value } : null;
}

/** The paths on which `condition` is `truthy`, each assuming so. */
function assuming(paths, condition, truthy) {
    if (condition === null) return paths;
    const value = truthy === condition.value;
    return distinct(paths.filter((one) => !(condition.atom in one.assumes) || one.assumes[condition.atom] === value)
        .map((one) => path(one.bits, { ...one.assumes, [condition.atom]: value })));
}

/*
 * Only what certainly forms one class list is joined: a string, a
 * concatenation or a template; a class helper's arguments (`clsx`, `cn`…),
 * where an array's entries and a class map's keys join too; an array that
 * `.join()` flattens. A call that may choose between its arguments
 * (`selectClass('fixed', 'inset-0')`) or an array nothing joins is not a class
 * list, so its strings are judged one by one.
 */
const CLASS_HELPERS = new Set(['clsx', 'cn', 'cx', 'classNames', 'classnames', 'twMerge', 'twJoin']);
const isClassHelperCall = (node) => node?.type === 'CallExpression' && node.callee.type === 'Identifier'
    && CLASS_HELPERS.has(node.callee.name);
/** The array method a call makes — `join`, `filter` or `concat`, the ones a class list passes through — or null. */
const listMethod = (call) => {
    const callee = call?.type === 'CallExpression' ? call.callee : null;
    const name = callee?.type === 'MemberExpression' && !callee.computed ? callee.property.name : null;
    return ['join', 'filter', 'concat'].includes(name) ? name : null;
};

/**
 * How `node` is read as a list of class names: `'helper'` as a class helper's
 * argument, `'join'` as an array `.join()` flattens — directly or through an
 * array, a spread (into an object too), a branch, `.filter()` or `.concat()` —
 * or null when it is not a class list at all.
 */
function classListContext(node) {
    let child = node;
    let parent = node.parent;
    for (;;) {
        if (parent?.type === 'ArrayExpression' || parent?.type === 'SpreadElement' || parent?.type === 'LogicalExpression'
            || (parent?.type === 'ConditionalExpression' && child !== parent.test)
            || (parent?.type === 'ObjectExpression' && child.type === 'SpreadElement')) {
            child = parent;
            parent = parent.parent;
        } else if (parent?.type === 'MemberExpression' && parent.object === child && parent.parent?.callee === parent
            && listMethod(parent.parent)) {
            if (listMethod(parent.parent) === 'join') return 'join';
            child = parent.parent;
            parent = child.parent;
        } else if (listMethod(parent) === 'concat' && parent.arguments.includes(child)) {
            child = parent;
            parent = parent.parent;
        } else {
            return isClassHelperCall(parent) && parent.arguments.includes(child) ? 'helper' : null;
        }
    }
}

/** `.filter(Boolean)` or `.filter((name) => name)`: drops what is falsy, and so no class string. */
const keepsEveryClass = ([predicate, ...rest]) => rest.length === 0 && (
    (predicate?.type === 'Identifier' && predicate.name === 'Boolean')
    || (predicate?.type === 'ArrowFunctionExpression' && predicate.params.length === 1
        && predicate.params[0].type === 'Identifier' && predicate.body.type === 'Identifier'
        && predicate.body.name === predicate.params[0].name));

/** A class map's key as the class names it holds: `fixed`, `'inset-0'`, `` [`inset-0`] ``. */
const keyPaths = (property, text) => (!property.computed && property.key.type === 'Identifier'
    ? [path(overlayBits(property.key.name))]
    : overlayPaths(property.key, null, text));

/** A class map's entry: its key's classes where its value is truthy. */
function entryPaths(property, text) {
    const keys = keyPaths(property, text);
    if (property.value.type === 'Literal') return property.value.value ? keys : NOTHING;
    const condition = conditionOf(property.value, text);
    return either(assuming(NOTHING, condition, false), assuming(keys, condition, true));
}

/** A key the source spells out (`fixed`, `'inset-0'`, `` [`inset-0`] ``), or null. */
function spelledKey(property) {
    const { key } = property;
    if (!property.computed && key.type === 'Identifier') return key.name;
    if (key.type === 'Literal') return String(key.value);
    if (key.type === 'TemplateLiteral' && key.expressions.length === 0) return key.quasis[0].value.cooked;
    return null;
}

/** What spreading `node` adds: an object's entries; nothing for `null`, `undefined` or `false`. */
function spreadEntries(node) {
    if (node?.type === 'ObjectExpression') return node.properties;
    if ((node?.type === 'Literal' && !node.value) || (node?.type === 'Identifier' && node.name === 'undefined')) return [];
    return null;
}

/**
 * A class map as JavaScript leaves it, on each path: a later key replaces an
 * earlier one, an object spread into the map adds its entries in place, and a
 * spread a condition chooses (`...(open ? { … } : {})`, `...(open && { … })`)
 * is each of its branches. A spread the source does not spell out, or a key it
 * computes, may replace any key before it, so those are not read.
 */
function mapPaths(properties, text) {
    // Past `MAX_PATHS` branches the map is not read, which can only drop a finding.
    const add = (variant, entries) => entries.reduce((all, entry) => (all.length > MAX_PATHS
        ? all : all.flatMap((one) => place(one, entry))), [variant]);
    const branch = (variant, condition, truthy, entries) => add(
        { conditions: [...variant.conditions, [condition, truthy]], entries: new Map(variant.entries) }, entries);
    function place(variant, entry) {
        if (entry.type === 'Property') {
            const key = spelledKey(entry);
            if (key === null) return [{ ...variant, entries: new Map([[entry, entry]]) }];
            return [{ ...variant, entries: new Map(variant.entries).set(key, entry) }];
        }
        const spread = entry.argument;
        if (spreadEntries(spread)) return add(variant, spreadEntries(spread));
        const condition = conditionOf(spread.type === 'ConditionalExpression' ? spread.test : spread.left, text);
        if (spread.type === 'ConditionalExpression' && spreadEntries(spread.consequent) && spreadEntries(spread.alternate)) {
            return [...branch(variant, condition, true, spreadEntries(spread.consequent)),
                ...branch(variant, condition, false, spreadEntries(spread.alternate))];
        }
        if (spread.type === 'LogicalExpression' && spread.operator === '&&' && spreadEntries(spread.right)) {
            return [...branch(variant, condition, true, spreadEntries(spread.right)), ...branch(variant, condition, false, [])];
        }
        return [{ ...variant, entries: new Map() }];
    }
    const variants = add({ conditions: [], entries: new Map() }, properties);
    if (variants.length > MAX_PATHS) return NOTHING;
    return variants.reduce((all, variant) => either(all, variant.conditions.reduce(
        (paths, [condition, truthy]) => assuming(paths, condition, truthy),
        [...variant.entries.values()].reduce((paths, entry) => joined(paths, entryPaths(entry, text)), NOTHING))), []);
}

/**
 * What each path through a class expression yields of the two. The parts of a
 * class list are joined; a conditional's branches are alternatives, each
 * assuming its test, `&&` adds nothing when its left side is falsy, and each
 * key of a class map is added where its value is truthy. `list` is how the
 * expression is read (`classListContext`): an array joins only inside a class
 * list, and an object's keys only as a class helper's argument. `text` gives a
 * condition's source, so the same condition is one condition. A name is not
 * followed: its string is judged where it is written.
 */
function overlayPaths(node, list, text) {
    const paths = (child, childList = list) => overlayPaths(child, childList, text);
    switch (node?.type) {
        case 'Literal':
            return [path(typeof node.value === 'string' ? overlayBits(node.value) : 0)];
        case 'TemplateLiteral':
            return node.expressions.reduce((all, expression) => joined(all, paths(expression, null)),
                [path(overlayBits(node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(' ')))]);
        case 'BinaryExpression':
            return node.operator === '+' ? joined(paths(node.left, null), paths(node.right, null)) : NOTHING;
        case 'ArrayExpression':
            return list ? node.elements.reduce((all, element) => joined(all, paths(element)), NOTHING) : NOTHING;
        case 'ObjectExpression':
            return list === 'helper' ? mapPaths(node.properties, text) : NOTHING;
        case 'SpreadElement':
            return paths(node.argument);
        case 'JSXExpressionContainer':
            return paths(node.expression);
        case 'ConditionalExpression': {
            const test = conditionOf(node.test, text);
            return either(assuming(paths(node.consequent), test, true), assuming(paths(node.alternate), test, false));
        }
        case 'LogicalExpression': {
            // `a && b` is `b` where `a` is truthy; `a || b` is `a` there and `b` where it is falsy. `a ?? b`
            // is read as `a || b`: `b` where `a` is falsy is a few more paths than where it is nullish.
            const left = conditionOf(node.left, text);
            if (node.operator === '&&') return either(assuming(NOTHING, left, false), assuming(paths(node.right), left, true));
            return either(assuming(paths(node.left), left, true), assuming(paths(node.right), left, false));
        }
        case 'CallExpression': {
            if (isClassHelperCall(node)) {
                return node.arguments.reduce((all, argument) => joined(all, paths(argument, 'helper')), NOTHING);
            }
            const method = listMethod(node);
            if (method === 'join') return paths(node.callee.object, 'join');
            // Only a filter that keeps every class string (`Boolean`, `(name) => name`) is followed.
            if (method === 'filter') return keepsEveryClass(node.arguments) ? paths(node.callee.object) : NOTHING;
            if (method === 'concat') {
                return node.arguments.reduce((all, argument) => joined(all, paths(argument)), paths(node.callee.object));
            }
            return NOTHING;
        }
        default:
            return NOTHING;
    }
}

/** Does `parent` join `child` into the same class list? */
function joinsInto(parent, child) {
    switch (parent?.type) {
        case 'BinaryExpression':
            return parent.operator === '+';
        case 'TemplateLiteral':
        case 'LogicalExpression':
            return true;
        case 'ConditionalExpression':
            return child !== parent.test;
        case 'ArrayExpression':
        case 'SpreadElement':
            return classListContext(parent) !== null;
        case 'Property':
            return parent.key === child && parent.parent?.type === 'ObjectExpression'
                && classListContext(parent.parent) === 'helper';
        case 'ObjectExpression':
            return classListContext(parent) === 'helper';
        case 'CallExpression':
            return (parent.arguments.includes(child) && (isClassHelperCall(parent) || listMethod(parent) === 'concat'))
                || (parent.callee === child && listMethod(parent) !== null);
        case 'MemberExpression':
            return parent.object === child && parent.parent?.callee === parent && listMethod(parent.parent) !== null;
        default:
            return false;
    }
}

/** The whole class expression a string belongs to. */
function classExpression(node) {
    let root = node;
    while (joinsInto(root.parent, root)) root = root.parent;
    return root;
}

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Refuse markup the design system already builds, written by hand (roadmap §3, §5).' },
        schema: optionsSchema({ skip: { type: 'array', items: { enum: CHECKS['use-primitive'] }, uniqueItems: true } }),
        messages: MESSAGES,
    },
    create(context) {
        const [options = {}] = context.options;
        const off = new Set([...(options.skip ?? []), ...exceptedChecks(context)]);
        const { sourceCode } = context;
        const report = (node, check, data = {}, loc = undefined) => {
            if (!off.has(check)) context.report({ node, loc, messageId: check, data });
        };

        // A name the file binds once is followed: `type={TYPE}`, `{...picker}`.
        const through = { sourceCode, follows: () => true };
        const styled = (node) => {
            const classValues = [...attributeValues(node, 'className', sourceCode), ...attributeValues(node, 'class', sourceCode)];
            if (classValues.length === 0) return false;
            if (classValues.some((value) => stringsIn(value, sourceCode.visitorKeys)
                .some((text) => STYLING_SIGNAL.test(text)))) return true;
            const setter = lastClassSetter(node);
            const name = setter?.value?.type === 'JSXExpressionContainer' && setter.value.expression.type === 'Identifier'
                ? setter.value.expression.name : null;
            if (name === null) return false;
            return certainlyText(uniqueInitialiser(sourceCode, name), (text) => STYLING_SIGNAL.test(text));
        };

        // `target="_blank"`, `role="tablist"` or `<input type="file">` in markup held as text.
        const readText = (node, text) => {
            for (const [check, pattern] of MARKUP_IN_TEXT) {
                let from = 0;
                for (const match of text.matchAll(pattern)) {
                    const place = locate(sourceCode, node, match[0], from);
                    from = place.next;
                    report(node, check, {}, place.loc);
                }
            }
        };

        // Each class expression once, however many strings it is built from.
        const judged = new Set();
        const overlay = (node) => {
            const root = classExpression(node);
            if (judged.has(root)) return;
            judged.add(root);
            const text = (node) => sourceCode.getText(node);
            if (overlayPaths(root, null, text).some((one) => one.bits === (FIXED | INSET))) report(root, 'hand-built-overlay');
        };

        return {
            JSXOpeningElement(node) {
                // What each attribute ends up as, written on the element or in an object it spreads.
                const values = (name) => attributeValues(node, name, sourceCode);
                if (values('role').some((value) => mayBe(value, isTablist, through))) report(node, 'hand-rolled-tablist');
                if (values('target').some((value) => mayBe(value, isBlank, through))) {
                    report(node, 'hand-written-target-blank');
                }
                const element = elementName(node);
                if (element === null) return;
                const has = (name) => values(name).length > 0;
                if (STYLED_CONTROL[element] && styled(node)) report(node, STYLED_CONTROL[element], { element });
                if (element === 'input' && values('type').some((value) => mayBe(value, isFile, through))) {
                    report(node, 'raw-file-input');
                }
                if ((element === 'button' || element === 'a') && has('aria-pressed')) {
                    report(node, 'hand-rolled-toggle', { element });
                }
                if (element === 'button' && has('aria-current')) report(node, 'hand-rolled-current');
                if (element === 'button' && has('aria-expanded') && insideHeading(node)) {
                    report(node, 'hand-rolled-disclosure');
                }
                if (THROWS_ON_NON_STRING_LABEL.has(element) && values('label').some((value) => mayBeJsx(value, sourceCode))) {
                    report(node, 'jsx-label-on-throwing-primitive', { element });
                }
            },
            Literal(node) {
                if (typeof node.value !== 'string') return;
                readText(node, node.value);
                overlay(node);
            },
            TemplateLiteral(node) {
                node.quasis.forEach((quasi) => readText(quasi, quasi.value.cooked ?? quasi.value.raw));
                overlay(node);
            },
        };
    },
};
