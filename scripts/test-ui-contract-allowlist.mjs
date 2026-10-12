#!/usr/bin/env node
/**
 * Tests for the UI-contract allowlist itself: its shape, its key format, and how
 * a fixed violation lowers it.
 *
 * Run with `npm run test:ui-contract`. Exit 0 = all pass. Plain assertions, no
 * external runner; each names the mutation that turns it red.
 */

import { readFileSync } from 'node:fs';

import { ALLOWLIST_VERSION, allowlistShapeProblems, normaliseAllowlist } from './ui-contract/allowlist.mjs';
import { allowlistPath } from './ui-contract/paths.mjs';
import { serialise, settleShrinkage, shrink } from './ui-contract/update.mjs';
import { reportShrinkable } from './ui-contract/report.mjs';

let failures = 0;
function assert(name, condition, detail = '') {
    if (condition) {
        console.log(`  ok   ${name}`);
        return;
    }
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const REASON = 'roadmap §5 — the generated 49 CFR §391.23 export, rasterised without tokens.';
const entry = (counts, rules = Object.keys(counts)) => ({
    ...counts,
    reasons: Object.fromEntries(rules.map((rule) => [rule, REASON])),
});

/* ========================================================================== */
console.log('\nB. A malformed allowlist is refused before anything is judged');

{
    /*
     * The verdicts compare counts, and a non-number compares false either way —
     * so a malformed entry would read as a ceiling nothing can reach. Mutation:
     * delete the `Number.isInteger` guard and B1/B2 both drop.
     */
    assert('B1. a count that is not a number is refused, not compared',
        allowlistShapeProblems({ 'a.jsx': { 'raw-table': 'unbounded' } }).length === 1);
    assert('B2. and so is a negative one',
        allowlistShapeProblems({ 'a.jsx': { 'raw-table': -1 } }).length === 1);
    assert('B3. a reasons block that is not a map of strings is refused',
        allowlistShapeProblems({ 'a.jsx': { reasons: { 'raw-table': 7 } } }).length === 1);
    assert('B3b. an entry that is not an object at all is refused',
        allowlistShapeProblems({ 'a.jsx': 12 }).length === 1);
    assert('B3c. and a sound entry produces nothing',
        allowlistShapeProblems({ 'a.jsx': entry({ 'raw-table': 2 }) }).length === 0);

    const checker = readFileSync(new URL('./check-ui-contract.mjs', import.meta.url), 'utf8');
    assert('B4. the checker refuses a malformed allowlist before any verdict',
        checker.indexOf('allowlistShapeProblems(allowlist.files)') !== -1
            && checker.indexOf('allowlistShapeProblems(allowlist.files)') < checker.indexOf('evaluate(measured, allowlist)'));
    // The allowlist is compared with no base commit (owner ruling, 2026-10-11),
    // so the check needs no flag, token or history.
    assert('B5. and compares the allowlist with no base commit',
        !/require-baseline|resolveValidatedBaseline|checkAllowlistDirection|execFileSync/.test(checker));
}

/* ========================================================================== */
console.log('\nS. A fixed violation lowers its entry: on disk locally, as a warning in CI');

{
    const measured = { 'a.jsx': { 'raw-hex-colour': 1 } };
    const allowlist = { $comment: 'c', version: ALLOWLIST_VERSION, files: { 'a.jsx': entry({ 'raw-hex-colour': 3 }) } };
    const stale = ['a.jsx → raw-hex-colour: 3 → 1'];
    const written = [];
    const write = (text) => written.push(text);

    assert('S1. in CI the entry is reported and nothing is written',
        settleShrinkage({ measured, allowlist, stale, env: { GITHUB_ACTIONS: 'true' }, write }) === 'warned'
            && written.length === 0);
    assert('S2. elsewhere the lowered allowlist is written',
        settleShrinkage({ measured, allowlist, stale, env: {}, write }) === 'written'
            && written.length === 1 && JSON.parse(written[0]).files['a.jsx']['raw-hex-colour'] === 1,
        written[0]);
    assert('S3. with nothing to lower, nothing is written, in or out of CI',
        settleShrinkage({ measured, allowlist, stale: [], env: {}, write }) === 'none' && written.length === 1);

    const lines = [];
    reportShrinkable(stale, { log: (line) => lines.push(line) });
    assert('S4. the CI warning is an annotation naming the entry and the fix',
        lines.length === 1 && lines[0].startsWith('::warning title=UI contract::a.jsx → raw-hex-colour: 3 → 1')
            && lines[0].includes('npm run check:ui-contract'),
        lines.join(' | '));
}

{
    /*
     * The written file must differ from the one on disk only where a count fell,
     * or every lowering would arrive with a reformatted file around it. Measured
     * here as the allowlist's own counts, so the test does not depend on the tree.
     */
    const onDisk = readFileSync(allowlistPath(), 'utf8');
    const document = JSON.parse(onDisk);
    const asMeasured = Object.fromEntries(Object.entries(document.files).map(([file, counts]) => [
        file, Object.fromEntries(Object.entries(counts).filter(([rule]) => rule !== 'reasons')),
    ]));
    assert('S5. lowering nothing writes the allowlist back byte for byte',
        serialise(document, shrink(asMeasured, document)) === onDisk);
}

/* ========================================================================== */
console.log('\nV. The allowlist version');

{
    assert('V1. a version-1 document is lifted to repo-relative keys',
        Object.keys(normaliseAllowlist({ files: { 'features/A.jsx': {} } }))[0]
            === 'src/features/A.jsx');
    assert('V2. a version-2 document is returned unchanged',
        Object.keys(normaliseAllowlist({ version: 2, files: { 'index.html': {} } }))[0]
            === 'index.html');
    // Mutation: drop the version check and normalising twice yields
    // `src/src/features/A.jsx`, which matches no file at all.
    assert('V3. normalising is idempotent through the version field',
        Object.keys(normaliseAllowlist({
            version: ALLOWLIST_VERSION,
            files: normaliseAllowlist({ files: { 'features/A.jsx': {} } }),
        }))[0] === 'src/features/A.jsx');
    assert('V4. a future version is left alone rather than re-prefixed',
        Object.keys(normaliseAllowlist({ version: 99, files: { 'index.html': {} } }))[0]
            === 'index.html');
}

console.log(failures === 0
    ? '\nAll UI-contract allowlist checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
