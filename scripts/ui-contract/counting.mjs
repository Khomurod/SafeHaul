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

export const COUNTERS = {
    'css-apply-off-contract': countApplyOffContract,
    'raw-file-input': countFileInputs,
    'jsx-label-on-throwing-primitive': countJsxLabelsOnThrowingPrimitives,
    'hand-rolled-toggle': countHandRolledToggles,
    'hand-rolled-current': countHandRolledCurrent,
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
