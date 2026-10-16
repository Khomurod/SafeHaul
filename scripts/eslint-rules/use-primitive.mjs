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
 *   `inset-0`;
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
const holdsOverlay = (text) => {
    const classes = new Set(text.split(/\s+/).map(bareClass));
    return classes.has('fixed') && classes.has('inset-0');
};

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
                if (holdsOverlay(node.value)) report(node, 'hand-built-overlay');
            },
            TemplateLiteral(node) {
                const text = node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(' ');
                node.quasis.forEach((quasi) => readText(quasi, quasi.value.cooked ?? quasi.value.raw));
                if (holdsOverlay(text)) report(node, 'hand-built-overlay');
            },
        };
    },
};
