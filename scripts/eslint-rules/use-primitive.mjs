/**
 * `ds/use-primitive` — markup the design system already builds, written by
 * hand at a call site.
 *
 * Each check is scoped to what its primitive actually replaces — the scopes
 * the UI-contract checker settled by measuring candidate rules on the tree:
 *
 * - a styled control is a raw `<button>`, `<a>`, `<input>`, `<select>` or
 *   `<textarea>` whose class list carries padding, a background, a border, a
 *   radius, a type size or a height — a bare one (a tab, a cell trigger) is
 *   fine. A class list held in a variable counts only when the file binds the
 *   name once, to text that styles on every path; `className={props.className}`
 *   is a pass-through and is never judged;
 * - a toggle is a raw `<button>` or `<a>` with `aria-pressed`, a current item a
 *   raw `<button>` with `aria-current` (a `<li aria-current="step">` read rather
 *   than operated has no primitive), a disclosure a raw `<button aria-expanded>`
 *   INSIDE a lowercase heading — menu, combobox and drawer triggers wear
 *   `aria-expanded` too and are not this;
 * - a tab strip is `role="tablist"`, a file picker `<input type="file">`, a new
 *   tab `target="_blank"`, an overlay a class list holding `fixed` and
 *   `inset-0` on some path, wherever its strings are split
 *   (`clsx('fixed', 'inset-0')`, `'fixed ' + 'inset-0'`, an array joined);
 * - and nine primitives throw on a label that is not a string, so a JSX
 *   `label` on one is a crash the moment that branch renders.
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
    attribute, certainlyText, elementName, lastClassSetter, staticString, stringsIn, uniqueInitialiser,
} from './jsx.mjs';

/** Classes that decide a control's geometry or colour rather than its layout. */
export const STYLING_SIGNAL = /\b(?:p|px|py|pt|pb|pl|pr)-(?:\d|ds-)|\bbg-|\bborder(?:-|\b)|\brounded|\btext-(?:xs|sm|base|lg|xl)|\bh-\d|\bmin-h-/;

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
const MARKUP_IN_TEXT = [
    ['hand-written-target-blank', /target=["']_blank["']/g],
    ['hand-rolled-tablist', /role=["']tablist["']/g],
];

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

/** May this attribute value yield JSX on some path? */
function mayBeJsx(node) {
    if (!node) return false;
    switch (node.type) {
        case 'JSXElement':
        case 'JSXFragment':
            return true;
        case 'JSXExpressionContainer':
            return mayBeJsx(node.expression);
        case 'ConditionalExpression':
            return mayBeJsx(node.consequent) || mayBeJsx(node.alternate);
        case 'LogicalExpression':
            return mayBeJsx(node.left) || mayBeJsx(node.right);
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
 * path. Each path's share of the two is a pair of bits, and an expression
 * yields the set of pairs its paths can: a few at most, so every combination
 * is cheap to follow.
 */
const FIXED = 1;
const INSET = 2;
const NOTHING = new Set([0]);
const overlayBits = (text) => text.split(/\s+/).map(bareClass)
    .reduce((bits, name) => bits | (name === 'fixed' ? FIXED : 0) | (name === 'inset-0' ? INSET : 0), 0);
const joined = (left, right) => new Set([...left].flatMap((a) => [...right].map((b) => a | b)));
const either = (left, right) => new Set([...left, ...right]);

/**
 * What each path through a class expression yields of the two. The strings
 * of a concatenation, a template, an array and a call's arguments (`clsx`,
 * `[…].join(' ')`) are joined; a conditional's branches are alternatives, and
 * `&&` may add nothing. A name is not followed: its string is judged where it
 * is written.
 */
function overlayPaths(node) {
    switch (node?.type) {
        case 'Literal':
            return new Set([typeof node.value === 'string' ? overlayBits(node.value) : 0]);
        case 'TemplateLiteral':
            return node.expressions.reduce((paths, expression) => joined(paths, overlayPaths(expression)),
                new Set([overlayBits(node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(' '))]));
        case 'BinaryExpression':
            return node.operator === '+' ? joined(overlayPaths(node.left), overlayPaths(node.right)) : NOTHING;
        case 'ArrayExpression':
            return node.elements.reduce((paths, element) => joined(paths, overlayPaths(element)), NOTHING);
        case 'SpreadElement':
        case 'JSXExpressionContainer':
            return overlayPaths(node.argument ?? node.expression);
        case 'CallExpression':
            return node.arguments.reduce((paths, argument) => joined(paths, overlayPaths(argument)),
                node.callee.type === 'MemberExpression' ? overlayPaths(node.callee.object) : NOTHING);
        case 'ConditionalExpression':
            return either(overlayPaths(node.consequent), overlayPaths(node.alternate));
        case 'LogicalExpression':
            return either(node.operator === '&&' ? NOTHING : overlayPaths(node.left), overlayPaths(node.right));
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
        case 'ArrayExpression':
        case 'SpreadElement':
        case 'LogicalExpression':
            return true;
        case 'ConditionalExpression':
            return child !== parent.test;
        case 'CallExpression':
            return parent.arguments.includes(child) || (parent.callee === child && child.type === 'MemberExpression');
        case 'MemberExpression':
            return parent.object === child && parent.parent?.type === 'CallExpression' && parent.parent.callee === parent;
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

        const styled = (node) => {
            const classAttributes = node.attributes.filter((one) => one.type === 'JSXAttribute'
                && (one.name?.name === 'className' || one.name?.name === 'class'));
            if (classAttributes.length === 0) return false;
            if (classAttributes.some((one) => stringsIn(one.value, sourceCode.visitorKeys)
                .some((text) => STYLING_SIGNAL.test(text)))) return true;
            const setter = lastClassSetter(node);
            const name = setter?.value?.type === 'JSXExpressionContainer' && setter.value.expression.type === 'Identifier'
                ? setter.value.expression.name : null;
            if (name === null) return false;
            return certainlyText(uniqueInitialiser(sourceCode, name), (text) => STYLING_SIGNAL.test(text));
        };

        // `target="_blank"` or `role="tablist"` in markup held as text.
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
            if (overlayPaths(root).has(FIXED | INSET)) report(root, 'hand-built-overlay');
        };

        return {
            JSXOpeningElement(node) {
                const element = elementName(node);
                if (element === null) return;
                const has = (name) => attribute(node, name) !== undefined;
                if (STYLED_CONTROL[element] && styled(node)) report(node, STYLED_CONTROL[element], { element });
                if (element === 'input' && staticString(attribute(node, 'type')?.value) === 'file') {
                    report(node, 'raw-file-input');
                }
                if ((element === 'button' || element === 'a') && has('aria-pressed')) {
                    report(node, 'hand-rolled-toggle', { element });
                }
                if (element === 'button' && has('aria-current')) report(node, 'hand-rolled-current');
                if (element === 'button' && has('aria-expanded') && insideHeading(node)) {
                    report(node, 'hand-rolled-disclosure');
                }
                if (THROWS_ON_NON_STRING_LABEL.has(element) && mayBeJsx(attribute(node, 'label')?.value)) {
                    report(node, 'jsx-label-on-throwing-primitive', { element });
                }
            },
            JSXAttribute(node) {
                const name = node.name?.name;
                if (name === 'role' && staticString(node.value) === 'tablist') report(node, 'hand-rolled-tablist');
                if (name === 'target' && staticString(node.value) === '_blank') report(node, 'hand-written-target-blank');
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
