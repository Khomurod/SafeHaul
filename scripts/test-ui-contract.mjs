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

import { COUNTERS, REMEDIES, countViolations } from './ui-contract/counting.mjs';
import { CSS_RULE_NAMES, RULES, STYLED_CONTROL_RULES } from './ui-contract/rules.mjs';
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

// S4d. Mutation: give a rule `pattern: null` without adding a COUNTER, or add a
// COUNTER for a rule that already has a pattern. Either way one of them is dead.
const patternless = RULES.filter((rule) => rule.pattern === null).map((rule) => rule.name);
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
