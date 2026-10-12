#!/usr/bin/env node
/**
 * Is the source-size standard actually enforced, and can it be got around?
 *
 * Split out of `scripts/test-source-size.mjs` on 2026-08-27 when that file
 * crossed 400 lines. It is a different subject from the rest of that suite: those
 * cases ask whether the checker measures correctly, these ask whether CI runs it
 * and whether the job it runs in can be skipped.
 *
 * Every assertion here is over the WIRING — `main.yml`, `package.json`,
 * `ci-plan.mjs` — because each of them was, at some point in this PR, a way for a
 * guard that looked present to do nothing.
 *
 * Run by `npm run test:source-size`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { ALWAYS_REQUIRED_JOBS } from './ci-plan.mjs';
import { HARD_LIMIT, WARN_LIMIT } from './source-size.mjs';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolvePath(here, '..');

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
console.log('\nG. The standard is enforced in CI, and cannot go blind');
/* ========================================================================== */
{
    const workflow = readFileSync(resolvePath(repoRoot, '.github/workflows/main.yml'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolvePath(repoRoot, 'package.json'), 'utf8'));
    const checker = readFileSync(resolvePath(here, 'source-size.mjs'), 'utf8');

    /*
     * An audit on 2026-08-26 counted 68 handwritten files over 500 physical
     * lines, none of it decided — it accumulated because nothing ever said no.
     * These pin the saying-no.
     */
    assert('G1. the size check runs in CI',
        /npm run check:source-size/.test(workflow),
        'a standard CI does not run is a suggestion');
    assert('G2. and so do the guard\'s own tests',
        /npm run test:source-size/.test(workflow),
        'a checker that has stopped looking reports a shorter list, which reads as progress');
    /*
     * Both steps live in `callable-contract`, which ALWAYS_REQUIRED_JOBS lists —
     * so no tree-hash proof can skip them. A size standard CI is allowed to skip
     * is not a standard.
     *
     * Asserted on the imported VALUE rather than by grepping `ci-plan.mjs`, which
     * is what the first version did: a regex over one file's text stops meaning
     * anything the moment the constant is split into another module, and it would
     * have failed silently-green in the direction that matters. Where the value
     * lives is that module's business; that it contains this job is ours.
     */
    const afterHeading = workflow.slice(workflow.indexOf('\n  callable-contract:') + 1);
    const nextJob = afterHeading.search(/\n {2}[a-z][a-z0-9-]*:\n/);
    const jobBody = nextJob === -1 ? afterHeading : afterHeading.slice(0, nextJob);
    assert('G3. both live in a job that can never be skipped',
        /Check source sizes/.test(jobBody)
        && /Verify the source-size guard/.test(jobBody)
        && ALWAYS_REQUIRED_JOBS.includes('callable-contract'),
        'a tree-hash proof must not be able to skip the size gate')
    assert('G4. both are real npm scripts',
        typeof pkg.scripts['check:source-size'] === 'string'
        && typeof pkg.scripts['test:source-size'] === 'string');
    /*
     * `test:source-size` chains several suites now, and a chain is a place a link
     * goes missing quietly: dropping one leaves the command green while part of
     * the guard's own tests stop running.
     *
     * The list comes off DISK rather than being written out here, because a
     * hand-written list is the same hazard one level up — splitting a suite and
     * forgetting to chain the half that moved would leave this assertion passing
     * over a file nobody runs. That is the lesson `REQUIRED_ROOTS` records in
     * `scripts/source-size.mjs`, applied to the guard's own tests.
     */
    const suites = readdirSync(resolvePath(repoRoot, 'scripts'))
        .filter((file) => /^test-source-size(-[a-z]+)?\.mjs$/.test(file));
    assert('G4b. and the test script still runs every suite the guard has',
        suites.length >= 2 && suites.every((file) => pkg.scripts['test:source-size'].includes(file)),
        `${suites.join(', ')} vs ${pkg.scripts['test:source-size']}`);
    /*
     * Asserted on the imported VALUES, not by grepping the checker's text — the
     * same correction G3 needed, and for the same reason: the regex broke the
     * moment the constants moved to `source-size-scope.mjs`, and a text search
     * that finds nothing reports "the limit is wrong" when the limit is fine.
     * Reading them through `source-size.mjs` also pins the re-export, so the
     * split cannot quietly drop a published name.
     */
    assert('G5. the limits are the agreed ones (owner ruling, 2026-10-11)',
        HARD_LIMIT === 700 && WARN_LIMIT === 500,
        `changing a limit is a decision, not a refactor (saw ${WARN_LIMIT}/${HARD_LIMIT})`);
    assert('G6. the scan reads git, so moving a file cannot hide it',
        /ls-files/.test(checker) && !/readdirSync/.test(checker),
        'a directory walk can be steered by a path pattern; the tracked set cannot');
    /*
     * Tests are the one category without a limit. Anything else exempt would be
     * an allowlist, and the checker carries none: no backlog file, no per-file
     * ceiling, so there is nothing a branch could edit to let itself through.
     */
    const scope = readFileSync(resolvePath(here, 'source-size-scope.mjs'), 'utf8');
    assert('G7. nothing but a test is exempt, and no list can make it so',
        !/backlog/i.test(checker) && !/EXCEPTIONS|maxLines/.test(checker + scope),
        'an exemption list in the branch under test is an allowlist');
    assert('G8. and CI runs it plainly',
        /run: npm run check:source-size\n/.test(jobBody),
        'the check needs no base commit and no flag');
}

console.log(failures === 0
  ? '\nAll source-size CI checks passed.'
  : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
