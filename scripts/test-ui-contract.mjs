#!/usr/bin/env node
/**
 * Tests for the UI-contract guard itself.
 *
 * Run with `npm run test:ui-contract`. Exit 0 = all pass.
 *
 * ## Why this file exists
 *
 * A 2026-09-04 audit found that **nothing tested the guard's own coverage**. The
 * only test in the tree (`src/tests/uiContract.ratchet.test.js`) imported two
 * pure functions and proved each rule can fire on a fixture. Nothing asserted
 * what the walker reaches, which rules exist, which files are exempt by path, or
 * that the native-table parser still refuses the four bypasses it was hardened
 * against. Measured consequence: dropping `css` from the extension regex takes
 * the scan from 554 files to 528 — still above the only floor there was — and
 * silently stops reading 26 stylesheets. A guard can go blind and read as clean.
 *
 * That is the same failure mode `scripts/test-source-size.mjs` was written for,
 * and this file is deliberately its sibling: same plain-assertion shape, same
 * "can it stop looking without anyone noticing" question. Each assertion below
 * names the mutation that turns it red, so a future reader can check the test is
 * still worth its line.
 *
 * ## This file asks whether the DECISIONS are right
 *
 * Three siblings ask the other questions, and `npm run test:ui-contract` chains
 * all four:
 *
 * | file                            | asks                                       |
 * |---------------------------------|--------------------------------------------|
 * | this one                        | are the decisions right?                   |
 * | `test-ui-contract-scope.mjs`    | is it still LOOKING at the whole tree?     |
 * | `test-ui-contract-baseline.mjs` | can the inventory be edited by the branch? |
 * | `test-ui-contract-ci.mjs`       | does CI run it, and can that be skipped?   |
 *
 * The scope half was split out on 2026-09-04 when the coverage pins landed;
 * "which files does it read" and "what does it conclude" are different subjects
 * with different mutations, and one file doing both was heading past 400 lines.
 */

import { HOISTED_CLASS_NAME } from './ui-contract/bindings.mjs';
import { COUNTERS, REMEDIES, countViolations } from './ui-contract/counting.mjs';
import {
    CSS_RULES, CSS_RULE_NAMES, JSX_RULE_NAMES, RULES, STYLED_CONTROL_RULES,
} from './ui-contract/rules.mjs';
import {
    CONTRACT_EXEMPT_RULES, HTML_RULE_NAMES, STORY_RULE_NAMES, rulesFor,
} from './ui-contract/source-text.mjs';
import { MIN_REASON_LENGTH, evaluate } from './ui-contract/verdict.mjs';
import { regenerate, serialise } from './ui-contract/update.mjs';
import { untetheredTables } from './ui-contract/tether.mjs';

let failures = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

/* ========================================================================== */
console.log('\nS. The rule set is complete and every rule can be acted on');

const ruleNames = [...RULES.map((rule) => rule.name), ...CSS_RULE_NAMES,
    ...STYLED_CONTROL_RULES.map((rule) => rule.name)];
const uniqueRuleNames = [...new Set(ruleNames)];

// S4a. Mutation: delete a rule from RULES and this drops.
assert('S4a. every rule name is unique',
    ruleNames.length === uniqueRuleNames.length,
    `${ruleNames.length} names, ${uniqueRuleNames.length} unique`);

// S4b. Mutation: add a rule without a remedy. A refusal that cannot say what to
// do next gets worked around rather than fixed.
const withoutRemedy = uniqueRuleNames.filter((name) => typeof REMEDIES[name] !== 'string'
    || REMEDIES[name].trim().length === 0);
assert('S4b. every rule has a remedy', withoutRemedy.length === 0, withoutRemedy.join(', '));

// S4c. Mutation: add a REMEDIES key for a rule that no longer exists — a remedy
// nothing can print is a remedy nobody maintains.
const orphanRemedies = Object.keys(REMEDIES).filter((name) => !uniqueRuleNames.includes(name));
assert('S4c. no remedy names a rule that does not exist',
    orphanRemedies.length === 0, orphanRemedies.join(', '));

/*
 * S4d. Mutation: give a rule `pattern: null` without adding a COUNTER, or add a
 * COUNTER for a rule that already has a pattern. Either way one of them is dead.
 *
 * Scoped across BOTH tables, which is a correction: it read only `RULES`, and
 * `css-apply-off-contract` is a counter-backed rule in `CSS_RULES` — so the
 * assertion failed the moment one arrived, claiming a counter had no rule. The
 * claim is about every rule the guard has; taking its scope from one of the two
 * tables was the same mistake this file records one level up.
 */
const patternless = [...RULES, ...CSS_RULES].filter((rule) => rule.pattern === null)
    .map((rule) => rule.name);
const counterNames = Object.keys(COUNTERS);
assert('S4d. patternless rules and COUNTERS are the same set',
    patternless.length === counterNames.length
    && patternless.every((name) => counterNames.includes(name)),
    `patternless [${patternless}] vs counters [${counterNames}]`);

/* ========================================================================== */
console.log('\nV. The verdict functions, driven on fixtures');

const reason = 'a documented exception naming the roadmap row';
const withReason = (rule, count) => ({ [rule]: count, reasons: { [rule]: reason } });

// V1. Mutation: flip `count > permitted` to `>=` and this stops firing.
assert('V1. a violation above the permitted count is a problem',
    evaluate({ 'a.jsx': { 'raw-hex-colour': 2 } },
        { files: { 'a.jsx': withReason('raw-hex-colour', 1) } }).problems.length === 1);

assert('V2. a violation at the permitted count is tolerated, and counted',
    (() => {
        const v = evaluate({ 'a.jsx': { 'raw-hex-colour': 1 } },
            { files: { 'a.jsx': withReason('raw-hex-colour', 1) } });
        return v.problems.length === 0 && v.toleratedTotal === 1;
    })());

// V3. Mutation: drop the shrinkage check and the allowlist can quietly describe
// a tree that no longer exists, permitting a later regression back up.
assert('V3. a violation below the permitted count is stale',
    evaluate({ 'a.jsx': { 'raw-hex-colour': 0 } },
        { files: { 'a.jsx': withReason('raw-hex-colour', 1) } }).stale.length === 1);

assert('V4. a file that lost its violations entirely is stale',
    evaluate({}, { files: { 'a.jsx': withReason('raw-hex-colour', 1) } }).stale.length === 1);

// V5. Mutation: lower MIN_REASON_LENGTH to 0 and an empty string buys an entry.
assert('V5. an entry with no reason is unexplained',
    evaluate({ 'a.jsx': { 'raw-hex-colour': 1 } },
        { files: { 'a.jsx': { 'raw-hex-colour': 1 } } }).unexplained.length === 1);

assert('V6. an entry with a too-short reason is unexplained',
    evaluate({ 'a.jsx': { 'raw-hex-colour': 1 } },
        { files: { 'a.jsx': { 'raw-hex-colour': 1, reasons: { 'raw-hex-colour': 'because' } } } })
        .unexplained.length === 1
    && MIN_REASON_LENGTH === 20);

// V7. Mutation: forget to skip the `reasons` key and it is treated as a rule
// needing a reason of its own — an infinite regress that fails every entry.
assert('V7. `reasons` is not itself a rule',
    evaluate({ 'a.jsx': { 'raw-hex-colour': 1 } },
        { files: { 'a.jsx': withReason('raw-hex-colour', 1) } }).unexplained.length === 0);

/* ========================================================================== */
console.log('\nU. Regeneration records shrinkage without inventing reasons');

// U1. Mutation: carry `reasons` wholesale and a retired exception lingers as
// cover for a future one.
{
    const { files } = regenerate(
        { 'a.jsx': { 'raw-hex-colour': 1 } },
        { files: { 'a.jsx': { 'raw-hex-colour': 3, 'raw-table': 1, reasons: { 'raw-hex-colour': reason, 'raw-table': reason } } } },
    );
    assert('U1a. a surviving rule keeps its reason', files['a.jsx'].reasons?.['raw-hex-colour'] === reason);
    assert('U1b. a retired rule loses its reason', files['a.jsx'].reasons?.['raw-table'] === undefined);
    assert('U1c. the count is recomputed from the tree', files['a.jsx']['raw-hex-colour'] === 1);
}

// U2. Mutation: invent a reason for a new file. `--update` writing an
// explanation would defeat the point of requiring one.
{
    const { files } = regenerate({ 'new.jsx': { 'raw-hex-colour': 1 } }, { files: {} });
    assert('U2. a newly measured file gets no reason', files['new.jsx'].reasons === undefined);
}

// U3. The on-disk shape is stable: two keys, two-space indent, trailing newline.
{
    const text = serialise({ $comment: 'c' }, { 'a.jsx': { 'raw-hex-colour': 1 } });
    assert('U3. serialised form is stable',
        text.endsWith('\n') && text.includes('\n  "files"') && JSON.parse(text).$comment === 'c');
}

/* ========================================================================== */
console.log('\nT. The native-table contract is armed by the allowlist, not satisfied by it');

const tableEntry = (count) => ({ files: { 'x.jsx': { 'raw-table': count, reasons: { 'raw-table': reason } } } });

// T1. The bypasses this rule was hardened against, over four review rounds.
const offContract = [
    ['a bare identifier', '<table className={cls} />'],
    ['a logical AND', "<table className={on && 'ds-native-table'} />"],
    ['a function call', '<table className={pick()} />'],
    ['a glued template quasi', '<table className={`ds-native-table${x}`} />'],
    ['a lookalike token', '<table className="ds-native-table-broken" />'],
    ['a data-testid decoy', '<table data-testid="ds-native-table" className="p-2" />'],
    ['a spread after className', '<table className="ds-native-table" {...rest} />'],
];
for (const [label, source] of offContract) {
    assert(`T1. refuses ${label}`,
        untetheredTables(tableEntry(1), () => source).length === 1, source);
}

// T2. And the forms that genuinely are on contract, so the rule does not fire on
// correct markup — a brittle check gets switched off, which is worse than none.
const onContract = [
    ['a string literal', '<table className="ds-native-table p-2" />'],
    ['a ternary with both sides tethered', "<table className={a ? 'ds-native-table x' : 'ds-native-table y'} />"],
    ['a template with a space before the hole', '<table className={`ds-native-table ${x}`} />'],
    ['a spread before className', '<table {...rest} className="ds-native-table" />'],
];
for (const [label, source] of onContract) {
    assert(`T2. accepts ${label}`,
        untetheredTables(tableEntry(1), () => source).length === 0, source);
}

// T3. Mutation: swallow the parse error and fall back to a text match — which is
// how all four bypasses above would come back.
assert('T3. a parse failure is a failure, not a fallback',
    untetheredTables(tableEntry(1), () => '<table className={').length === 1);

// T4. Mutation: exempt a file by name here instead of by the design-system
// prefix. The entry ARMS the check; there must be no per-file escape.
assert('T4. an allowlist entry arms the check rather than exempting the file',
    untetheredTables(tableEntry(99), () => '<table className={cls} />').length === 1);

/*
 * T6. `DataTable` is the display-table contract and does not consume the native
 * one, so it is exempt — and the exemption is matched as a PATH SEGMENT rather
 * than a prefix. It read `startsWith('design-system/')` until allowlist v2 moved
 * the keys to repo-relative, at which point `src/design-system/…` stopped
 * matching and `DataTable.jsx` was reported as an untethered table. It failed
 * closed, which is survivable, but a hardcoded prefix a key-format change can
 * invalidate is the defect either way. Both spellings are pinned so the next
 * format change cannot reintroduce it.
 */
for (const key of ['design-system/components/data-table/DataTable.jsx',
    'src/design-system/components/data-table/DataTable.jsx']) {
    assert(`T6. the design-system exemption holds for ${key.split('/')[0]}-relative keys`,
        untetheredTables(
            { files: { [key]: { 'raw-table': 1, reasons: { 'raw-table': reason } } } },
            () => { throw new Error('should not be read'); },
        ).length === 0);
}

// ...and it is an exemption for the design system, not for any path that
// happens to contain the words. Mutation: match on `includes` and this drops.
assert('T6b. a feature file merely mentioning the phrase is still checked',
    untetheredTables(
        { files: { 'src/features/notes/design-system-notes.jsx': { 'raw-table': 1, reasons: { 'raw-table': reason } } } },
        () => '<table className={cls} />',
    ).length === 1);

assert('T5. a file with no raw-table entry is not parsed at all',
    untetheredTables({ files: { 'x.jsx': withReason('raw-hex-colour', 1) } },
        () => { throw new Error('should not be read'); }).length === 0);

/* ========================================================================== */
console.log('\nH. A class list held in a variable reaches the parser, and only there');

/*
 * `bindings.mjs` is the second rule that needs a parser, and a parser is the one
 * thing in this guard that can be handed input it cannot read. `src/tests/
 * uiContract.ratchet.test.js` proves what the rule counts; what is pinned here
 * is the boundary — which files are parsed at all.
 *
 * TWO layers keep a non-module out of the parser, and they are pinned
 * separately because either one alone looks sufficient and is not:
 *
 *   1. the rule set. `STYLED_CONTROL_RULES` are asked for by the full JSX set
 *      and the story set only, so a stylesheet or an HTML document never
 *      reaches the parser however its text reads.
 *   2. the pre-filter. Within the JSX set, a file with no
 *      `className={identifier}` is not parsed either — which is what keeps the
 *      whole-tree scan at a third of a second.
 *
 * H1 and H2 were written as an ordinary stylesheet and an ordinary HTML page
 * first, and BOTH passed with layer 1 deleted: neither text contains the shape,
 * so layer 2 was answering. A test that passes with the code it tests removed
 * is not a test, so each source below carries the shape inside a string — the
 * real way a stylesheet acquires one is a `content:` value — which leaves layer
 * 1 as the only thing standing between the parser and a file it cannot read.
 */
/*
 * Counted through a `try`, because the way layer 1 fails is a thrown
 * `SyntaxError` rather than a wrong number — and a suite that dies on the first
 * one reports "the process exited 1" where it could name the check.
 */
const countedOrThrew = (...args) => {
    try { return countViolations(...args); } catch (error) { return { threw: error.name }; }
};

assert('H1. a stylesheet is never handed to the JSX parser',
    Object.keys(countedOrThrew(
        String.raw`.x::after { content: "className={c}"; color: var(--ds-color-content); }`,
        CSS_RULE_NAMES,
    )).length === 0);

assert('H2. an HTML document is never handed to the JSX parser',
    countedOrThrew(
        '<!doctype html>\n<body class="bg-gray-50" data-hint="className={c}"></body>',
        HTML_RULE_NAMES, { html: true },
    )['raw-palette-class'] === 1);

// H3. The story set DOES include the styled-control rules, so a story is parsed.
// A hoisted class list in the catalog teaches the bypass by example.
assert('H3. a story is parsed, because the catalog is taught from',
    countViolations('const c = "p-ds-3 border rounded-ds-md";\n<input className={c} />',
        STORY_RULE_NAMES)['hand-styled-field'] === 1);

/*
 * H4. Mutation: catch the parse error and return `[]`. That is the same fallback
 * T3 refuses for tables, and it is worse here — a file that fails to parse is a
 * file whose every hoisted class list is invisible, silently.
 */
let parseFailureSurfaced = false;
try {
    countViolations('const c = "p-ds-3 border";\n<input className={c} ');
} catch { parseFailureSurfaced = true; }
assert('H4. a parse failure is a failure, not a fallback', parseFailureSurfaced);

/*
 * H5. ...and the parse is paid for only where there is something to find. The
 * pre-filter is what keeps the whole-tree scan at a third of a second, so a file
 * with no `className={identifier}` must survive being unparseable.
 */
assert('H5. a file without the shape is not parsed, so bad syntax there is harmless',
    countedOrThrew('<input className="border rounded-ds-md px-ds-3" /> ) } ]')['hand-styled-field'] === 1);

assert('H6. the pre-filter matches the shape the rule reads, and not the inline one',
    HOISTED_CLASS_NAME.test('<input className={commonClasses} />')
    && !HOISTED_CLASS_NAME.test('<input className="border px-ds-3" />')
    && !HOISTED_CLASS_NAME.test('<input className={props.className} />'));

/* ========================================================================== */
console.log('\nP. The hand-rolled toggle');

const toggles = (code) => countViolations(code)['hand-rolled-toggle'] ?? 0;

// P1. The shape the rule exists for.
assert('P1. a raw <button aria-pressed> is one violation',
    toggles('<button type="button" aria-pressed={on}>Hired</button>') === 1);

/*
 * P2. The whole difficulty of this rule in one assertion. Nineteen live call
 * sites pass `aria-pressed` straight through to `Button` or `IconButton`, and
 * they are correct — the state is being handed to the contract. The wrong shape
 * differs by ONE CAPITAL LETTER, which a regex over the attribute cannot see, so
 * the counter reads the element name off the open tag instead.
 * Mutation: make `openTagAttributes`'s start pattern case-insensitive and this
 * goes to 2.
 */
assert('P2. a component carrying aria-pressed is silent',
    toggles('<Button aria-pressed={on}>SMS</Button><IconButton aria-pressed={on} label="x"/>') === 0);

/*
 * P3. `<button[^>]*aria-pressed` stops at the first `>`, including the one in
 * `=>`, so prop ORDER would decide whether a toggle is visible. That defect is
 * recorded twice already in `counting.mjs`; this is the third rule it would
 * have hit.
 */
assert('P3. an arrow function before the attribute does not hide it',
    toggles('<button onClick={() => go()} aria-pressed={on}>x</button>') === 1);

// P4. Anchors count — `aria-pressed` on a link is invalid ARIA. Elements whose
// name merely STARTS with `a` do not: the tag reader requires `[\s/>]` after it.
assert('P4. an anchor counts and an abbr does not',
    toggles('<a href="/x" aria-pressed={on}>x</a>') === 1
    && toggles('<abbr aria-pressed="true">x</abbr><article aria-pressed="true"/>') === 0);

// P5. The migration target has to be silent, or the rule refuses its own remedy.
assert('P5. Chip and ChipGroup are silent',
    toggles('<ChipGroup ariaLabel="Stage"><Chip pressed={on}>Hired</Chip></ChipGroup>') === 0);

/*
 * P6. The design system is exempt from this rule and NOTHING else.
 *
 * `SegmentedControl` IS the `role="group"` of `<button aria-pressed>` the rule
 * points people at, so the rule cannot fire on it. The exemption is a named list
 * rather than a path skip precisely so it cannot quietly widen: this asserts the
 * set difference is exactly one name, and that every other rule still reaches
 * inside `src/design-system/`.
 * Mutation: add a name that is not a rule, or drop a rule from the routing
 * without dropping it from the list, and these fail.
 */
const contractRules = rulesFor('src/design-system/components/segmented/SegmentedControl.jsx');
/*
 * Not "exactly N rules" — that assertion has to be edited every time the list
 * legitimately changes, and an assertion people edit routinely stops being read.
 * What must hold whatever the length is: the exempt names are a subset of the
 * real rules (so a typo cannot exempt nothing while looking like it exempts
 * something), and the difference between the full JSX set and what the design
 * system gets is EXACTLY that list and nothing more.
 */
assert('P6a. every exempt name is a real rule',
    CONTRACT_EXEMPT_RULES.every((name) => JSX_RULE_NAMES.includes(name)),
    CONTRACT_EXEMPT_RULES.filter((name) => !JSX_RULE_NAMES.includes(name)).join(', '));
assert('P6b. and the design system keeps every other JSX rule',
    JSX_RULE_NAMES.filter((name) => !contractRules.includes(name)).sort().join(',')
    === [...CONTRACT_EXEMPT_RULES].sort().join(','));
assert('P6c. so the primitive itself does not trip it',
    (countViolations('<button aria-pressed={on} className="ds-segmented__option"/>', contractRules)['hand-rolled-toggle'] ?? 0) === 0);

/*
 * P7. A story is held to it, by the same argument `raw-z-index` is: the catalog
 * is the design system's published example, and one hand-rolling a control is
 * teaching the shape rather than merely containing it. Stories are routed before
 * the contract-root branch, so the exemption must NOT reach them.
 *
 * Driven over `CONTRACT_EXEMPT_RULES` rather than over one name. The first
 * version named `hand-rolled-toggle` alone, and a mutation proved that: dropping
 * `hand-rolled-current` from the story set passed. An exemption and its catalog
 * counterpart are two halves of one decision, so the assertion has to be over
 * the set, not over a member of it.
 */
const storyRules = rulesFor('src/design-system/stories/Chip.stories.jsx');
assert('P7. every rule the design system is exempt from still binds its catalog',
    CONTRACT_EXEMPT_RULES.every(
        (name) => STORY_RULE_NAMES.includes(name) && storyRules.includes(name),
    ),
    CONTRACT_EXEMPT_RULES.filter((name) => !storyRules.includes(name)).join(', '));

/*
 * P8. `JSX_RULE_NAMES` is what the exemption subtracts FROM, so if it ever
 * covered less than `only === null` does, a design-system file would silently
 * skip the difference — a hole opened by a list drifting out of date rather than
 * by anybody deciding anything. Driven on a fixture that trips four different
 * rule kinds at once: a pattern rule, a counter rule, a styled-control rule and
 * a class-list rule.
 * Mutation: drop STYLED_CONTROL_RULES from JSX_RULE_NAMES and this fails.
 */
const everyKind = '<div className="bg-blue-500" style={{ color: \'#ff0000\' }} />'
    + '<button className="rounded-ds-md bg-ds-surface px-ds-3" aria-pressed={on}>x</button>'
    + '<input type="file" />';
assert('P8. the named JSX rule set covers exactly what `null` covers',
    JSON.stringify(countViolations(everyKind, JSX_RULE_NAMES))
    === JSON.stringify(countViolations(everyKind)));

const currents = (code) => countViolations(code)['hand-rolled-current'] ?? 0;

/*
 * P9. `hand-rolled-current` is `hand-rolled-toggle`'s sibling and asks a
 * different question, so the two must not answer for each other: a `pressed`
 * control is not a `current` one and counting it as both would double every
 * toggle in the tree.
 */
assert('P9. current and pressed are counted separately',
    currents('<button aria-current="page">3</button>') === 1
    && toggles('<button aria-current="page">3</button>') === 0
    && currents('<button aria-pressed={on}>x</button>') === 0);

/*
 * P10. Scoped to `<button>` on purpose, and this is the assertion that keeps it
 * honest. Three raw `aria-current` sites in the tree are non-interactive
 * progress displays — a `<li>` step indicator, a `<span>` step chip — which are
 * CORRECT markup with no primitive behind them. A rule firing there would be
 * demanding a component nobody has built; the roadmap gap table is where that
 * belongs.
 * Mutation: widen the counter to `li|span` and this fails.
 */
assert('P10. a non-interactive step indicator is not a hand-rolled control',
    currents('<li aria-current="step">2. Map</li><span aria-current="step">3. Send</span>') === 0);

assert('P11. a component carrying aria-current is silent',
    currents('<SelectableCard current /><SectionNavigation aria-current="page" />') === 0);

// P12. The migration target, and the design system's own rail that the remedy
// names — neither may trip the rule that points at them.
assert('P12. the design system is exempt from both state rules',
    CONTRACT_EXEMPT_RULES.length === 2
    && CONTRACT_EXEMPT_RULES.includes('hand-rolled-toggle')
    && CONTRACT_EXEMPT_RULES.includes('hand-rolled-current')
    && (countViolations('<button aria-current="page" />', contractRules)['hand-rolled-current'] ?? 0) === 0);

/* ========================================================================== */
console.log('\nX. The rule engine stands alone');

// The pure rule engine must stay importable from `src/` without the CLI, because
// that is what `src/tests/uiContract.ratchet.test.js` proves each rule on.
// `scripts/test-ui-contract-scope.mjs` §X1 pins the other half: that nothing
// under `src/` reaches the CLI entry or the git baseline, whose module scopes
// would run inside Vitest's `import.meta.url` rewrite.
assert('X2. the rule engine is importable without the CLI',
    countViolations('<div className="bg-blue-500" />')['raw-palette-class'] === 1);

/* ========================================================================== */
console.log(failures === 0
    ? '\nAll UI-contract decision checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
