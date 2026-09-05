/**
 * Counting a file's violations.
 *
 * The tag-scanning helpers exist because a regex over raw source cannot tell a
 * `<button>` from a `<button>` wearing hand-written padding, and the difference
 * is the entire point of the styled-control rules.
 */

import { hoistedStyledElements } from './bindings.mjs';
import {
    CSS_RULES, RULES, STYLED_CONTROL_RULES, STYLING_SIGNAL,
} from './rules.mjs';
import { stripBlockComments, stripComments, stripHtmlComments } from './source-text.mjs';

export function openTagAttributes(code, name) {
    const out = [];
    const start = new RegExp(`<(?:${name})(?=[\\s/>])`, 'g');
    for (const match of code.matchAll(start)) {
        let i = match.index + match[0].length;
        let depth = 0;
        let quote = '';
        while (i < code.length) {
            const ch = code[i];
            if (quote) {
                if (ch === '\\') { i += 2; continue; }
                if (ch === quote) quote = '';
                i += 1;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i += 1; continue; }
            if (ch === '{') { depth += 1; i += 1; continue; }
            if (ch === '}') { depth -= 1; i += 1; continue; }
            if (ch === '>' && depth === 0) break;
            i += 1;
        }
        out.push(code.slice(match.index + match[0].length, i));
    }
    return out;
}

/**
 * @param {string} code
 * @param {{element: string}} rule
 * @param {string[]} [hoisted] tag names whose class list is held in a variable
 *   (`./bindings.mjs`) — the same controls, spelled the one way a text scan
 *   cannot read. Passed in rather than computed here so one parse serves all
 *   three styled-control rules.
 */
export function countStyledControls(code, rule, hoisted = []) {
    const inline = openTagAttributes(code, rule.element).filter(
        (attributes) => /className\s*=/.test(attributes) && STYLING_SIGNAL.test(attributes),
    ).length;
    const isTarget = new RegExp(`^(?:${rule.element})$`);
    return inline + hoisted.filter((tag) => isTarget.test(tag)).length;
}

/** `<input type="file">`, wherever the attribute sits in the tag. */
export function countFileInputs(code) {
    return openTagAttributes(code, 'input').filter(
        (attributes) => /type\s*=\s*["']file["']/.test(attributes),
    ).length;
}

/**
 * A raw `<button>` or `<a>` carrying `aria-pressed`.
 *
 * Read off the open tag rather than matched with a regex, because that is the
 * only way to tell a lowercase element from a component: `<Button aria-pressed>`
 * is nineteen correct call sites and `<button aria-pressed>` is a second toggle
 * contract, and the two differ by one capital letter that a regex over the
 * attribute cannot see. `openTagAttributes` is case-sensitive and requires
 * `[\s/>]` after the name, so `<abbr>` and `<article>` are not `<a>`.
 */
export function countHandRolledToggles(code) {
    return ['button', 'a'].reduce(
        (total, element) => total + openTagAttributes(code, element)
            .filter((attributes) => /\baria-pressed\s*=/.test(attributes)).length,
        0,
    );
}

/**
 * A raw `<button>` carrying `aria-current`.
 *
 * Scoped to `<button>` deliberately, and NOT to every element with the
 * attribute. Measured on 2026-09-05: seven raw elements carry `aria-current`
 * across `src/`, and three are non-interactive progress displays — a `<li>` in
 * `BulkUploadLayout`'s step indicator, a `<span>` in `SendTemplateWizard`'s, and
 * the design system's own `SectionNavigation`. `aria-current="step"` on
 * something read rather than operated is correct markup with no primitive behind
 * it, so a rule firing on them would be demanding a component that does not
 * exist. That gap is recorded in roadmap section 5, which is where a missing
 * primitive belongs — a rule is the wrong instrument for "we have not built this
 * yet".
 */
export function countHandRolledCurrent(code) {
    return openTagAttributes(code, 'button')
        .filter((attributes) => /\baria-current\s*=/.test(attributes)).length;
}

/**
 * A hand-rolled avatar: a sized round disc whose content is a person's initial.
 *
 * ## Why the content and not just the shape
 *
 * The obvious rule — "a `rounded-ds-full` box with a fixed square size" — was
 * measured before it was written, and it matched **25 elements of which only 8
 * were avatars.** The other seventeen are four different things that happen to
 * be circles: a glyph in a disc (an empty-state medallion, which
 * `StatusMedallion` already owns), an unread-count badge, a numbered step
 * marker in a progress indicator, a radio dot and a selection indicator.
 *
 * A rule that cannot tell them apart would demand `Avatar` for all of them, and
 * `Avatar` is the wrong answer for every one — the same mistake
 * `hand-rolled-current` avoids by staying on `<button>`. So the rule reads what
 * the disc HOLDS. An avatar holds a person's initial, and in this tree that is
 * derived exactly three ways: an `initials` binding, `.charAt(0)`, or `name[0]`.
 * Measured against the live tree: 8 matched, 17 left alone, and after the
 * migration 0 and 17.
 */
const DISC_ROUND = /\brounded-ds-full\b/;
const DISC_CENTRED = /\bitems-center\b/;
const DISC_SIZED = /\b[hw]-\d+\b/;
const FROM_A_NAME = /\binitials?\b|\.charAt\(0\)|\bname\s*\[\s*0\s*\]/i;

export function countHandRolledAvatars(code) {
    let total = 0;
    for (const match of code.matchAll(/<(span|div)(?=[\s/>])/g)) {
        const rest = code.slice(match.index);
        const attributes = openTagAttributes(rest, match[1])[0] ?? '';
        if (!(DISC_ROUND.test(attributes) && DISC_CENTRED.test(attributes)
            && DISC_SIZED.test(attributes))) continue;
        /*
         * The body up to the first close tag. An avatar's child is a single
         * expression, so this never needs to balance nesting — and reading
         * further would start matching the NEXT element's content.
         */
        const open = rest.indexOf('>');
        const body = rest.slice(open + 1, open + 300).split('</')[0];
        if (FROM_A_NAME.test(body)) total += 1;
    }
    return total;
}

/**
 * The primitives that validate `label` and throw on anything but a non-empty
 * string. Kept beside the counter that reads them so the two cannot drift.
 */
export const THROWS_ON_NON_STRING_LABEL = [
    'FormField', 'FieldDisplay', 'Checkbox', 'Radio', 'Switch',
    'IconButton', 'IconButtonLink', 'FileInput', 'ProgressBar',
];

/**
 * A JSX `label={...}` on a primitive that throws unless the label is a string.
 *
 * A counter rather than a regex for the same reason `countFileInputs` is one, and
 * the reason bit twice here: this rule used
 * `<(?:FormField|...)\b[^>]*?\blabel=\{` until a review on 2026-08-25, and
 * `[^>]*?` stops at the first `>` — including the one in `=>`. So
 *
 *     <FormField label={<span>Date</span>} onClick={() => go()}>   -> caught
 *     <FormField onClick={() => go()} label={<span>Date</span>}>   -> INVISIBLE
 *
 * and prop ordering alone decided whether a rule guarding a **runtime crash**
 * could see it. Measured before the fix: 1 violation against 0 for the same
 * element written the ordinary React way.
 */
export function countJsxLabelsOnThrowingPrimitives(code) {
    let total = 0;
    for (const element of THROWS_ON_NON_STRING_LABEL) {
        total += openTagAttributes(code, element).filter(
            (attributes) => /\blabel\s*=\s*\{\s*[(<]/.test(attributes),
        ).length;
    }
    return total;
}

/**
 * Every violation inside an `@apply` class list.
 *
 * Runs the real class-list rules rather than restating them, so the two can
 * never drift: a rule added to `RULES` is enforced inside `@apply` the same day.
 * Only rules with a plain `pattern` participate — the counter-backed ones
 * (`raw-file-input`, the JSX-label rule) are about markup, and an `@apply` list
 * has none.
 */
export function countApplyOffContract(code) {
    let found = 0;
    for (const match of code.matchAll(/@apply\s+([^;{}]+);/g)) {
        const classList = match[1];
        for (const rule of RULES) {
            if (!rule.pattern) continue;
            found += (classList.match(rule.pattern) || []).length;
        }
    }
    return found;
}

/**
 * A hand-rolled disclosure: a `<button aria-expanded>` inside a heading.
 *
 * ## Why the heading and not the attribute
 *
 * The obvious rule — "a raw `<button aria-expanded>`" — was measured before it
 * was written, and it matched **two elements in the whole tree**: the one this
 * slice migrates, and a bottom app-bar tab that would then need a second
 * recorded reason to buy it off. Meanwhile the eleven live `aria-expanded`
 * sites are mostly not disclosures at all — four menu triggers, a combobox
 * (where the attribute sits on an `<input>`, not a button), a navigation group,
 * a drawer trigger, a filter toggle, a row expander. `Disclosure` replaces none
 * of those, and nine of them are already on `Button` or `IconButton`.
 *
 * The heading is what separates the one from the ten. A disclosure *section*
 * puts its trigger inside a heading so the section appears in the document
 * outline — that is the WAI-ARIA Authoring Practices shape, it is the shape
 * `Disclosure` renders, and a popup trigger never has it. So the rule reads for
 * it, and the other ten are left alone by their own structure rather than by an
 * exemption list. Measured against the live tree: 1 matched, 10 left alone, and
 * after the migration 0 and 10.
 *
 * `Disclosure` itself is silent here without any path exemption, because it
 * renders `<Heading>` — a capitalised binding for the level the caller chose —
 * and this reads lowercase `h1`–`h6` only. That is a property worth keeping if
 * the component is ever rewritten, and a test asserts it.
 */
const HEADING_TAG = /<(h[1-6])(?=[\s/>])/g;
const EXPANDED = /\baria-expanded\s*=/;

export function countHandRolledDisclosures(code) {
    let total = 0;
    for (const match of code.matchAll(HEADING_TAG)) {
        const tag = match[1];
        const rest = code.slice(match.index);
        /*
         * The brace-aware scanner rather than `indexOf('>')`: an open tag may
         * carry an arrow function, and stopping at the first `>` inside one is
         * the defect this module records twice already. Here it is load-bearing
         * for the NEXT line rather than for the offset — reading the true
         * attribute text is the only way to know the tag closed itself.
         */
        const attributes = openTagAttributes(rest, tag)[0];
        if (attributes === undefined) continue;
        /*
         * A self-closing heading holds nothing, and skipping it is not a
         * nicety: its region would otherwise run on to the NEXT heading's close
         * tag and count that heading's trigger a second time. Measured at 2 for
         * `<h3 />` above a real disclosure before this line existed.
         */
        if (attributes.trimEnd().endsWith('/')) continue;
        const bodyStart = match[0].length + attributes.length + 1;
        const close = rest.slice(bodyStart).search(new RegExp(`</${tag}\\s*>`));
        /* Opened and never closed: not a section, so there is no body to read. */
        if (close < 0) continue;
        total += openTagAttributes(rest.slice(bodyStart, bodyStart + close), 'button')
            .filter((one) => EXPANDED.test(one)).length;
    }
    return total;
}

export const COUNTERS = {
    'css-apply-off-contract': countApplyOffContract,
    'raw-file-input': countFileInputs,
    'jsx-label-on-throwing-primitive': countJsxLabelsOnThrowingPrimitives,
    'hand-rolled-toggle': countHandRolledToggles,
    'hand-rolled-current': countHandRolledCurrent,
    'hand-rolled-avatar': countHandRolledAvatars,
    'hand-rolled-disclosure': countHandRolledDisclosures,
};

/**
 * @param {string} source
 * @param {string[] | null} [only] Restrict to these rule names; `null` = all.
 */
export function countViolations(source, only = null, { html = false } = {}) {
    const isCss = Array.isArray(only) && only.length > 0
        && only.every((name) => name.startsWith('css-'));
    /*
     * Three comment syntaxes, three strippers. HTML is opt-in by flag rather
     * than inferred from the rule set, because the HTML rules are the same
     * class-list rules a story is held to — there is nothing in the NAMES to
     * tell the two apart.
     */
    const code = html ? stripHtmlComments(source)
        : isCss ? stripBlockComments(source) : stripComments(source);
    const counts = {};
    const wanted = (name) => only === null || only.includes(name);

    // `only === null` means "every JSX rule". The CSS rules are opt-in by name,
    // because a hex in a `style={{}}` object is `raw-hex-colour`'s business and
    // running both would double-count it.
    for (const rule of (only === null ? RULES : [...RULES, ...CSS_RULES])) {
        if (!wanted(rule.name)) continue;
        const counter = COUNTERS[rule.name];
        if (counter) {
            const found = counter(code);
            if (found) counts[rule.name] = found;
            continue;
        }
        const subject = rule.prepare ? rule.prepare(code) : code;
        const found = subject.match(rule.pattern);
        if (found?.length) counts[rule.name] = found.length;
    }
    /*
     * One parse for the three styled-control rules, and only when one of them is
     * actually wanted — a stylesheet or an HTML document is not a JSX module and
     * must never be handed to the parser.
     */
    const styledControlRules = STYLED_CONTROL_RULES.filter((rule) => wanted(rule.name));
    const hoisted = styledControlRules.length > 0 ? hoistedStyledElements(code) : [];
    for (const rule of styledControlRules) {
        const found = countStyledControls(code, rule, hoisted);
        if (found) counts[rule.name] = found;
    }
    return counts;
}

export const REMEDIES = Object.fromEntries(
    [...RULES, ...CSS_RULES, ...STYLED_CONTROL_RULES].map((rule) => [rule.name, rule.remedy]),
);
