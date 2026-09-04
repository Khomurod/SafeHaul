#!/usr/bin/env node
/**
 * Tests for the UI-contract allowlist's git baseline.
 *
 * Run with `npm run test:ui-contract`. Exit 0 = all pass.
 *
 * ## The two bypasses this exists to keep closed
 *
 * Reproduced by a 2026-09-04 audit, both from inside an ordinary pull request:
 *
 *   1. add three raw palette classes to `VOEDocument.jsx`, run
 *      `check:ui-contract -- --update`, and the check reports "239 known
 *      violations, none new" — `--update` rewrote the ceiling to match;
 *   2. add a brand-new file with five violations plus one allowlist entry whose
 *      reason is a twenty-character sentence naming nothing, and it passes.
 *
 * Neither is a bug in a rule, and no rule-level test could have caught either.
 * Both are the *inventory* being writable by the change it is measuring — the
 * lesson `scripts/secret-scan.mjs` and `scripts/source-size-baseline.mjs` were
 * each built on. §G drives both against real throwaway repositories, because the
 * pure comparison in §B cannot catch a wrong ref: the size guard's first version
 * asked for `HEAD^{commit}`, which peels HEAD to a commit rather than naming its
 * parent, so every push compared the inventory against itself and could never
 * fail.
 *
 * ## And one deadlock, reproduced before it was fixed
 *
 * The first version of the justification rule refused a pure RENAME six ways
 * with no route forward: every entry became "a file this change adds", while
 * leaving the entry under the old path failed as stale and deleting it failed as
 * an uncovered violation. §G12/§G13 pin the fix — git's own rename and copy
 * attribution — and §G14 pins that it cannot launder a violation the move
 * introduced.
 *
 * Plain assertions, no external runner, matching `scripts/test-source-size.mjs`
 * and `scripts/test-source-size-baseline.mjs`. Each assertion names the mutation
 * that turns it red.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
    allowlistShapeProblems, compareAllowlist, growthJustifiedByBase,
} from './ui-contract/direction.mjs';
import { ALLOWLIST_PATH, checkAllowlistDirection, measureAt } from './ui-contract/baseline.mjs';
import { additions } from './ui-contract/update.mjs';

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
console.log('\nB. The comparison itself, on fixtures');

{
    /*
     * The NaN lesson, inherited whole from the size backlog: every rule compares
     * with `>`, a non-number coerces to NaN, and every comparison against NaN is
     * false — so a malformed entry would exempt its file from the ceiling AND
     * from the may-not-grow rule, silently. Mutation: delete the
     * `Number.isInteger` guard and B1/B2 both drop.
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
}

{
    const before = { 'a.jsx': { 'raw-palette-class': 5, 'raw-table': 1 } };

    // B4. Mutation: compare with `>=` and a same-count re-record becomes growth,
    // which would fail every PR that touches nothing.
    assert('B4. an unchanged inventory is not growth',
        compareAllowlist(before, before).growth.length === 0);

    // B5. Mutation: report reductions as growth and the campaign cannot proceed.
    assert('B5. a smaller count, a dropped rule and a dropped file are not growth',
        compareAllowlist(before, { 'a.jsx': { 'raw-palette-class': 4 } }).growth.length === 0
        && compareAllowlist(before, {}).growth.length === 0);

    const raised = compareAllowlist(before, { 'a.jsx': { 'raw-palette-class': 6, 'raw-table': 1 } });
    assert('B6. a raised count is growth, and says what it was',
        raised.growth.length === 1 && raised.growth[0].previous === 5 && raised.growth[0].count === 6,
        JSON.stringify(raised.growth));

    const added = compareAllowlist(before, { ...before, 'b.jsx': { 'raw-table': 1 } });
    assert('B6b. a new file is growth, with no previous count',
        added.growth.length === 1 && added.growth[0].previous === null,
        JSON.stringify(added.growth));

    const newRule = compareAllowlist(before, { 'a.jsx': { 'raw-palette-class': 5, 'sub-12px-type': 1 } });
    assert('B6c. a new RULE on an existing file is growth too',
        newRule.growth.some((g) => g.rule === 'sub-12px-type'),
        'mutation: key the comparison on the file alone and this drops');

    // `reasons` is metadata, not a rule. Mutation: stop skipping it and every
    // annotated entry reports growth on a rule called "reasons".
    assert('B6d. the reasons block is never mistaken for a rule',
        compareAllowlist({ 'a.jsx': { 'raw-table': 1 } },
            { 'a.jsx': entry({ 'raw-table': 1 }) }).growth.length === 0);
}

{
    const growth = [{ file: 'a.jsx', rule: 'raw-palette-class', count: 6, previous: 5 }];
    const ref = 'abcdef1234567890';

    assert('B7. growth beyond what the base carried is refused',
        growthJustifiedByBase(growth, { 'a.jsx': { 'raw-palette-class': 5 } }, ref).length === 1);

    /*
     * B8 is the rule-widening case, and it is why the base's CONTENT is measured
     * rather than its recorded counts. A slice that widens `raw-hex-colour` to
     * SVG attributes legitimately records violations that have been in the tree
     * for months; comparing against the base's numbers alone would refuse it, and
     * the guard would become impossible to improve.
     */
    assert('B8. growth the base already carried is allowed',
        growthJustifiedByBase(growth, { 'a.jsx': { 'raw-palette-class': 9 } }, ref).length === 0);

    // B9 is bypass 2 in one line: a file the change created can never carry an
    // entry, whatever its reason says. Mutation: default a missing file to `{}`
    // and this drops to zero problems.
    const invented = [{ file: 'new.jsx', rule: 'raw-palette-class', count: 5, previous: null }];
    assert('B9. an entry for a file absent at the base is refused as a new exemption',
        /does not exist at/.test(growthJustifiedByBase(invented, {}, ref)[0] || ''));

    assert('B9b. a file present at the base but clean carries a ceiling of zero',
        growthJustifiedByBase(invented, { 'new.jsx': {} }, ref).length === 1,
        'absent and clean must not fail the same way, but both must fail');
}

/* ========================================================================== */
console.log('\nU. `--update` may only shrink');

{
    const allowlist = { $comment: 'x', files: { 'a.jsx': entry({ 'raw-palette-class': 5 }) } };

    // U1 is bypass 1: the flag rewrote every number it found, so the inventory it
    // maintained was whatever the branch's source happened to contain.
    const grown = additions({ 'a.jsx': { 'raw-palette-class': 8 } }, allowlist);
    assert('U1. a regeneration that raises a ceiling is reported, not written',
        grown.growth.length === 1 && grown.growth[0].count === 8,
        JSON.stringify(grown.growth));

    const shrunk = additions({ 'a.jsx': { 'raw-palette-class': 2 } }, allowlist);
    assert('U2. a regeneration that only shrinks is clean',
        shrunk.growth.length === 0 && shrunk.files['a.jsx']['raw-palette-class'] === 2);

    assert('U3. and the reason survives the shrinkage',
        shrunk.files['a.jsx'].reasons['raw-palette-class'] === REASON,
        'mutation: drop the reasons carry-forward and every --update strips the file bare');

    const retired = additions({}, allowlist);
    assert('U4. a rule that no longer fires loses its entry and its reason',
        Object.keys(retired.files).length === 0 && retired.growth.length === 0);

    assert('U5. a malformed on-disk allowlist is refused before anything is compared',
        additions({ 'a.jsx': { 'raw-palette-class': 1 } },
            { files: { 'a.jsx': { 'raw-palette-class': 'lots' } } }).problems.length > 0);
}

/* ========================================================================== */
console.log('\nR. A run with no baseline');

{
    const noRef = () => ({ ref: null, source: 'HEAD~1', error: 'no parent commit' });
    const required = checkAllowlistDirection({ current: {}, requireBaseline: true, resolveRef: noRef });
    assert('R1. a run told to prove the inventory did not grow refuses when it cannot',
        required.problems.length === 1,
        'CI passes --require-baseline, so there is no skip path where tampering matters');

    const optional = checkAllowlistDirection({ current: {}, requireBaseline: false, resolveRef: noRef });
    assert('R2. and one that was not told to prove it says the comparison was skipped',
        optional.problems.length === 0 && /skipped/.test(optional.describe),
        'a fresh or shallow clone must still be able to run the checker locally');

    const unreadable = checkAllowlistDirection({
        current: {},
        requireBaseline: true,
        resolveRef: () => ({ ref: 'a'.repeat(40), source: 'HEAD~1', error: null }),
        readAt: () => ({ files: null, absent: false, error: 'not JSON' }),
    });
    assert('R3. an unreadable allowlist at the base is a refusal, not an empty one',
        unreadable.problems.length === 1,
        'mutation: return `{files: {}}` on a parse failure and every entry passes unjudged');
}

/* ========================================================================== */
console.log('\nG. Against real repositories');

/** A throwaway repo laid out like this one: `src/` plus the allowlist. */
function repo(label) {
    const dir = mkdtempSync(join(tmpdir(), `safehaul-ui-${label}-`));
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'tests@safehaul.invalid');
    git('config', 'user.name', 'SafeHaul tests');
    git('config', 'commit.gpgsign', 'false');
    const write = (path, text) => {
        mkdirSync(dirname(resolve(dir, path)), { recursive: true });
        writeFileSync(resolve(dir, path), text);
    };
    const allowlist = (files) => write(ALLOWLIST_PATH, `${JSON.stringify({ files }, null, 2)}\n`);
    const commit = (message) => { git('add', '-A'); git('commit', '-q', '-m', message); };
    const check = (files, options = {}) => checkAllowlistDirection({
        current: files, requireBaseline: true, env: {}, cwd: dir, ...options,
    });
    return {
        dir, git, write, allowlist, commit, check,
        done: () => rmSync(dir, { recursive: true, force: true }),
    };
}

/** `n` raw palette classes in one element, which is `n` violations. */
const palette = (n) => `export const X = () => (\n  <div className="${
    Array.from({ length: n }, (_, i) => `bg-blue-${(i % 9) + 1}00`).join(' ')}" />\n);\n`;

{
    // G1–G3: bypass 1 through real git — the recorded ceiling raised by hand to
    // cover violations the change itself wrote.
    const r = repo('raise');
    r.write('src/a.jsx', palette(5));
    r.allowlist({ 'a.jsx': entry({ 'raw-palette-class': 5 }) });
    r.commit('base');
    r.write('src/a.jsx', palette(8));
    r.allowlist({ 'a.jsx': entry({ 'raw-palette-class': 8 }) });
    r.commit('grow it and cover it');

    const grown = r.check({ 'a.jsx': entry({ 'raw-palette-class': 8 }) });
    assert('G1. a ceiling raised to cover new code is caught through git',
        grown.problems.some((p) => /carries only 5/.test(p)),
        `${grown.describe} — ${grown.problems.join('; ') || 'nothing reported'}`);
    assert('G2. and the baseline it used was the PARENT, not the head itself',
        /HEAD~1/.test(grown.describe) && !grown.describe.includes(r.git('rev-parse', 'HEAD').slice(0, 8)),
        grown.describe);
    assert('G3. the same machinery passes an inventory that only shrank',
        r.check({ 'a.jsx': entry({ 'raw-palette-class': 4 }) }).problems.length === 0);
    r.done();
}

{
    // G4–G5: bypass 2 — a new file, five violations, one plausible sentence.
    const r = repo('invent');
    r.write('src/a.jsx', palette(5));
    r.allowlist({ 'a.jsx': entry({ 'raw-palette-class': 5 }) });
    r.commit('base');
    r.write('src/invented.jsx', palette(5));
    r.commit('add a file and exempt it');

    const invented = r.check({
        'a.jsx': entry({ 'raw-palette-class': 5 }),
        'invented.jsx': entry({ 'raw-palette-class': 5 }),
    });
    assert('G4. a new file cannot carry an entry, however well it is worded',
        invented.problems.some((p) => /invented\.jsx does not exist at/.test(p)),
        invented.problems.join('; ') || 'nothing reported');
    assert('G5. and the reason being long enough changes nothing',
        invented.problems.length === 1,
        'MIN_REASON_LENGTH answers "is it written down"; only git answers "was it already there"');
    r.done();
}

{
    /*
     * G6–G7: the rule-widening case must still be possible, or the guard can
     * never be improved. The base's own content is measured with TODAY's rules,
     * so violations that were always there can be recorded when a rule starts
     * seeing them.
     */
    const r = repo('widen');
    r.write('src/a.jsx', palette(5));
    r.allowlist({});
    r.commit('base: the rule does not see this file yet');
    // The file does not change — the RULE does, which is the whole point. Only
    // the guard's own source moves, so the commit touches something else.
    r.write('src/unrelated.jsx', 'export const Y = () => null;\n');
    r.commit('widen the rule');

    assert('G6. an entry for violations the base already carried is allowed',
        r.check({ 'a.jsx': entry({ 'raw-palette-class': 5 }) }).problems.length === 0);
    assert('G7. but not for one more than it carried',
        r.check({ 'a.jsx': entry({ 'raw-palette-class': 6 }) }).problems.length === 1);
    r.done();
}

{
    // G8–G9: an override may not reach behind the inventory's own start, which is
    // the size guard's category error in this guard's shape.
    const r = repo('predates');
    r.write('src/a.jsx', palette(5));
    r.commit('before the allowlist existed');
    const before = r.git('rev-parse', 'HEAD');
    r.allowlist({ 'a.jsx': entry({ 'raw-palette-class': 5 }) });
    r.commit('introduce the allowlist');

    const overridden = r.check({ 'a.jsx': entry({ 'raw-palette-class': 5 }) }, {
        env: { SOURCE_SIZE_BASE: before },
        overrideValidated: () => true,
    });
    assert('G8. an override naming a commit that predates the allowlist is refused',
        overridden.problems.some((p) => /cannot reach behind its start/.test(p)),
        overridden.problems.join('; ') || 'nothing reported');

    // The same absent base reached WITHOUT an override is the bootstrap commit,
    // and it is judged entry by entry against the base's content instead.
    const bootstrap = r.check({ 'a.jsx': entry({ 'raw-palette-class': 5 }) });
    assert('G9. the same base reached automatically judges each entry instead',
        bootstrap.problems.length === 0, bootstrap.problems.join('; '));

    const inflated = r.check({ 'a.jsx': entry({ 'raw-palette-class': 9 }) });
    assert('G9b. and refuses one the bootstrap base did not carry',
        inflated.problems.length === 1, inflated.problems.join('; '));
    r.done();
}

{
    // G10–G11: the base is measured with the file's OWN rules, so a stylesheet
    // and a story are not held to the JSX set.
    const r = repo('rules');
    r.write('src/a.css', '.x { color: #ff0000; }\n');
    r.commit('base');
    r.write('src/a.css', '.x { color: #ff0000; }\n.y { display: block; }\n');
    r.commit('touch it');
    const css = measureAt(r.git('rev-parse', 'HEAD~1'), ['a.css'], { cwd: r.dir });
    assert('G10. a stylesheet at the base is measured with the CSS rules',
        css['a.css']['css-raw-colour'] === 1, JSON.stringify(css));

    const absent = measureAt(r.git('rev-parse', 'HEAD~1'), ['never-existed.jsx'], { cwd: r.dir });
    assert('G11. a file absent at the base is omitted, not recorded as clean',
        !('never-existed.jsx' in absent),
        'mutation: default it to `{}` and every invented file gets a ceiling of zero it can meet');
    r.done();
}

{
    /*
     * G12–G14: the deadlock. A pure rename adds not one violation, and the first
     * version refused it once per entry with no route forward — the entry under
     * the old path fails as stale, and deleting it fails as an uncovered
     * violation.
     */
    const r = repo('rename');
    r.write('src/old.jsx', palette(5));
    r.allowlist({ 'old.jsx': entry({ 'raw-palette-class': 5 }) });
    r.commit('base');
    r.git('mv', 'src/old.jsx', 'src/new.jsx');
    r.allowlist({ 'new.jsx': entry({ 'raw-palette-class': 5 }) });
    r.commit('rename it');

    assert('G12. a pure rename carries its entry to the new path',
        r.check({ 'new.jsx': entry({ 'raw-palette-class': 5 }) }).problems.length === 0,
        'mutation: drop -M from the diff and this deadlocks');

    const laundered = r.check({ 'new.jsx': entry({ 'raw-palette-class': 7 }) });
    assert('G13. but a rename cannot launder a violation the move introduced',
        laundered.problems.length === 1, laundered.problems.join('; '));
    r.done();
}

{
    // G14: a split — the shape this campaign actually produces, where a hundred
    // exempt classes move into a new path that still needs an entry.
    const r = repo('split');
    r.write('src/whole.jsx', palette(10));
    r.allowlist({ 'whole.jsx': entry({ 'raw-palette-class': 10 }) });
    r.commit('base');
    r.write('src/whole.jsx', palette(4));
    r.write('src/piece.jsx', palette(10));
    r.allowlist({
        'whole.jsx': entry({ 'raw-palette-class': 4 }),
        'piece.jsx': entry({ 'raw-palette-class': 6 }),
    });
    r.commit('split it');

    const split = r.check({
        'whole.jsx': entry({ 'raw-palette-class': 4 }),
        'piece.jsx': entry({ 'raw-palette-class': 6 }),
    });
    assert('G14. a split attributes the piece to the file it came from',
        split.problems.length === 0,
        `${split.describe} — ${split.problems.join('; ') || 'nothing reported'}`);
    r.done();
}

/* ========================================================================== */
console.log(failures === 0
    ? '\nAll UI-contract baseline checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
