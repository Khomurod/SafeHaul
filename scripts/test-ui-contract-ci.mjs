#!/usr/bin/env node
/**
 * Is the UI contract actually enforced, and can it be got around?
 *
 * The sibling of `scripts/test-source-size-ci.mjs`, and a different subject from
 * `test-ui-contract.mjs` (which asks whether the checker measures correctly) and
 * `test-ui-contract-allowlist.mjs` (which asks how the inventory is read and
 * lowered). These ask whether CI runs it and whether the job it runs in can be
 * skipped.
 *
 * Every assertion here is over the WIRING — `main.yml`, `package.json`,
 * `ci-plan.mjs` — because each of those is a way for a guard that looks present
 * to do nothing. The check runs in `callable-contract`, which no tree-hash proof
 * can skip, so a change that edits only the allowlist still meets it.
 *
 * Run by `npm run test:ui-contract`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALWAYS_REQUIRED_JOBS } from './ci-plan.mjs';

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
console.log('\nW. The UI contract is enforced in CI, and cannot go blind');
/* ========================================================================== */
{
    const workflow = readFileSync(resolvePath(repoRoot, '.github/workflows/main.yml'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolvePath(repoRoot, 'package.json'), 'utf8'));

    const CHECK_STEP = 'UI contract ratchet';
    const TEST_STEP = 'Verify the UI-contract guard';

    const jobBlock = (jobId) => {
        const start = workflow.indexOf(`\n  ${jobId}:\n`);
        if (start < 0) return null;
        const rest = workflow.slice(start + 1);
        const next = rest.search(/\n {2}[A-Za-z0-9_-]+:\n/);
        return next < 0 ? rest : rest.slice(0, next);
    };
    const jobIds = [...workflow.matchAll(/\n {2}([a-z][a-z0-9-]*):\n/g)].map((match) => match[1]);
    const carriers = jobIds.filter((job) => (jobBlock(job) || '').includes(`- name: ${CHECK_STEP}`));

    /*
     * W1 is the whole point of the move. A guard in a skippable lane makes a
     * claim only about the runs that happened to include it, and `plan` skips
     * `frontend_unit` whenever the frontend tree hash is already proven — so a
     * change that edits ONLY the allowlist could skip the check that reads it.
     */
    assert('W1. exactly one job runs the UI contract check',
        carriers.length === 1, carriers.join(', ') || 'no job runs it');
    assert('W2. and that job can never be skipped',
        carriers.length === 1 && ALWAYS_REQUIRED_JOBS.includes(carriers[0]),
        carriers.length === 1
            ? `${carriers[0]} is not in ALWAYS_REQUIRED_JOBS`
            : `cannot say: ${carriers.length} jobs run it`);

    const jobBody = jobBlock(carriers[0]) || '';
    const stepIn = (name) => {
        const start = jobBody.indexOf(`- name: ${name}`);
        if (start < 0) return null;
        const rest = jobBody.slice(start + 1);
        const next = rest.indexOf('\n      - name:');
        return next < 0 ? rest : rest.slice(0, next);
    };

    /*
     * W3: the guard's own tests must run BEFORE the check, not after. A guard can
     * go blind silently — narrowing the walker's extension set drops 26
     * stylesheets while still clearing its floor — so a green check means nothing
     * until the checker has been shown to still be able to fail. Running the
     * tests afterwards reports the blindness only once the blind run has already
     * passed.
     */
    assert('W3. the guard\'s own tests run in the same job',
        jobBody.includes(`- name: ${TEST_STEP}`), `${carriers[0]} runs the check but not the tests`);
    assert('W4. and they run BEFORE the check, not after it',
        jobBody.indexOf(`- name: ${TEST_STEP}`) < jobBody.indexOf(`- name: ${CHECK_STEP}`),
        'a checker proven after it passed proves nothing about the run that passed');

    assert('W5. both are real npm scripts',
        typeof pkg.scripts['check:ui-contract'] === 'string'
        && typeof pkg.scripts['test:ui-contract'] === 'string');

    /*
     * W6: the chain is a place a link goes missing quietly. The list comes off
     * DISK rather than being written out here — a hand-written list is the same
     * hazard one level up, where splitting a suite and forgetting to chain the
     * half that moved leaves this assertion passing over a file nobody runs.
     */
    const suites = readdirSync(resolvePath(repoRoot, 'scripts'))
        .filter((file) => /^test-ui-contract(-[a-z]+)?\.mjs$/.test(file));
    assert('W6. the test script still runs every suite the guard has',
        suites.length >= 3 && suites.every((file) => pkg.scripts['test:ui-contract'].includes(file)),
        `${suites.join(', ')} vs ${pkg.scripts['test:ui-contract']}`);

    /*
     * W7: the check compares with no base commit (owner ruling, 2026-10-11), so
     * it needs no flag, token or history; and it refuses a malformed allowlist
     * before it judges anything with it.
     */
    const checkStep = stepIn(CHECK_STEP) || '';
    const checker = readFileSync(resolvePath(here, 'check-ui-contract.mjs'), 'utf8');
    assert('W7. CI runs the check plainly',
        /name: UI contract ratchet\n\s+run: npm run check:ui-contract\n/.test(checkStep) && !/env:/.test(checkStep),
        checkStep.split('\n').slice(0, 3).join(' | '));
    assert('W8. and the check reads no base commit',
        !/require-baseline|resolveValidatedBaseline|checkAllowlistDirection|execFileSync/.test(checker));
    assert('W8b. a malformed allowlist is refused before any verdict',
        checker.indexOf('allowlistShapeProblems(allowlist.files)') !== -1
            && checker.indexOf('allowlistShapeProblems(allowlist.files)') < checker.indexOf('evaluate(measured, allowlist)'));

    /*
     * W9: the native-table rule parses with `@babel/parser`, so this job — which
     * ran with no install for its whole life — needs one. Without it the check
     * throws on every run, which is a loud failure rather than a silent one, but
     * it is still a broken required job.
     */
    assert('W9. the job installs dependencies, because the table rule parses',
        /- name: Install Dependencies\n\s+run: npm ci/.test(jobBody),
        '@babel/parser is not a Node builtin');

    /*
     * W13: the two clauses that would make the step advisory. `continue-on-error`
     * turns a refusal into a note nobody reads, and a job-level `if:` is how a
     * gate gets conditioned away one event at a time.
     */
    assert('W13. neither step is advisory',
        !/continue-on-error/.test(checkStep) && !/continue-on-error/.test(stepIn(TEST_STEP) || ''),
        'a gate that cannot fail the run is documentation');
    assert('W14. and the job carries no `if:` that could condition it away',
        !/^\s{4}if:/m.test(jobBody), carriers[0]);
}

console.log(failures === 0
    ? '\nAll UI-contract CI checks passed.'
    : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
