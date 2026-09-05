#!/usr/bin/env node
/**
 * Is the icon contract actually enforced, and can it be got around?
 *
 * The sibling of `scripts/test-ui-contract-ci.mjs` and
 * `scripts/test-source-size-ci.mjs`, and a different subject from
 * `test-icon-contract.mjs` (which asks whether the checker measures correctly).
 * These ask whether CI runs it, whether the job it runs in can be skipped, and
 * whether the baseline it compares against can be chosen by the change under
 * test.
 *
 * Every assertion here is over the WIRING — `main.yml`, `package.json`,
 * `ci-plan.mjs` — because each of those is a way for a guard that looks present
 * to do nothing. Written the same way for the same reason: this repository has
 * now had three separate guards whose real weakness was where they ran rather
 * than what they measured.
 *
 * Run by `npm run test:icon-contract`.
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
console.log('\nX. The icon contract is enforced in CI, and cannot go blind');
/* ========================================================================== */
{
    const workflow = readFileSync(resolvePath(repoRoot, '.github/workflows/main.yml'), 'utf8');
    const pkg = JSON.parse(readFileSync(resolvePath(repoRoot, 'package.json'), 'utf8'));

    const CHECK_STEP = 'Icon contract ratchet';
    const TEST_STEP = 'Verify the icon-contract guard';

    const jobBlock = (jobId) => {
        const start = workflow.indexOf(`\n  ${jobId}:\n`);
        if (start < 0) return null;
        const rest = workflow.slice(start + 1);
        const next = rest.search(/\n {2}[A-Za-z0-9_-]+:\n/);
        return next < 0 ? rest : rest.slice(0, next);
    };
    const jobIds = [...workflow.matchAll(/\n {2}([a-z][a-z0-9-]*):\n/g)].map((match) => match[1]);
    const carriers = jobIds.filter((job) => (jobBlock(job) || '').includes(`- name: ${CHECK_STEP}`));

    assert('X1. exactly one job runs the icon contract check',
        carriers.length === 1, carriers.join(', ') || 'no job runs it');

    /*
     * X2: a guard in a skippable lane makes a claim only about the runs that
     * happened to include it. The campaign's list can be edited by any change,
     * so a change that edits ONLY the backlog must never be able to skip the
     * check that reads it.
     */
    assert('X2. and that job can never be skipped',
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
     * X3/X4: the guard's own tests must run BEFORE the check. A guard can go
     * blind silently — narrow the scan's extension set and it stops seeing the
     * files it was written for while still reporting a clean result — so a green
     * check means nothing until the checker has been shown to still be able to
     * fail. Running the tests afterwards reports the blindness only once the
     * blind run has already passed.
     */
    assert('X3. the guard\'s own tests run in the same job',
        jobBody.includes(`- name: ${TEST_STEP}`), `${carriers[0]} runs the check but not the tests`);
    assert('X4. and they run BEFORE the check, not after it',
        jobBody.indexOf(`- name: ${TEST_STEP}`) < jobBody.indexOf(`- name: ${CHECK_STEP}`),
        'a checker proven after it passed proves nothing about the run that passed');

    assert('X5. both are real npm scripts',
        typeof pkg.scripts['check:icon-contract'] === 'string'
        && typeof pkg.scripts['test:icon-contract'] === 'string');

    /*
     * X6: the chain is a place a link goes missing quietly. The list comes off
     * DISK rather than being written out here — a hand-written list is the same
     * hazard one level up, where splitting a suite and forgetting to chain the
     * half that moved leaves this assertion passing over a file nobody runs.
     */
    const suites = readdirSync(resolvePath(repoRoot, 'scripts'))
        .filter((file) => /^test-icon-contract(-[a-z]+)?\.mjs$/.test(file));
    assert('X6. the test script still runs every suite the guard has',
        suites.length >= 2 && suites.every((file) => pkg.scripts['test:icon-contract'].includes(file)),
        `${suites.join(', ')} vs ${pkg.scripts['test:icon-contract']}`);

    /*
     * X7: without the flag the guard SKIPS the comparison when it cannot find a
     * base, which is the right default for a contributor's shallow clone and
     * exactly wrong in the place tampering is the concern. A flag CI does not
     * pass is decorative.
     */
    const checkStep = stepIn(CHECK_STEP) || '';
    assert('X7. CI proves the backlog did not grow, rather than trusting it',
        /check:icon-contract -- --require-baseline/.test(checkStep),
        'without the flag a run that cannot find a base passes instead of refusing');

    assert('X8. and that job has the history the proof needs',
        /- uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0/.test(jobBody),
        'a depth-1 checkout has no previous backlog to compare against');

    /*
     * X9: the baseline lookup asks GitHub which ancestor carries a fully
     * validated release, so the job needs a token and the permission to read
     * check runs. Without either, every run reports "nothing validated" — which
     * `--require-baseline` turns into a refusal, so this fails loudly rather
     * than silently, but it fails on every run.
     */
    assert('X9. the check can ask GitHub what has been validated',
        /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/.test(checkStep),
        'no token means no validated ancestor, which means every run refuses');
    assert('X10. and the job is allowed to read check runs',
        /checks:\s*read/.test(jobBody), 'the lookup needs `checks: read`');

    /*
     * X11: one baseline question, one answer. Sharing `SOURCE_SIZE_BASE` with
     * the other two campaigns is deliberate — a second variable is a second
     * thing for an operator to get wrong in the same dispatch dialog, and they
     * are asking the same history the same question.
     */
    assert('X11. the override is the shared one, not a new variable',
        /SOURCE_SIZE_BASE:\s*\$\{\{\s*github\.event\.inputs\.source_size_base/.test(checkStep)
        && !/ICON_CONTRACT_BASE/.test(workflow),
        'a second override is a second place to get the same answer wrong');

    /*
     * X12: a pull request measures against what it was proposed against, which
     * is a definition rather than an inference. `github.event.before` is
     * deliberately absent everywhere — after a push whose check FAILED, `before`
     * IS that failure, so measuring from it steps over exactly what was refused.
     */
    assert('X12. a pull request is measured against its own base',
        /GITHUB_PR_BASE_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha/.test(checkStep));
    assert('X13. and nothing is anchored at a push\'s own `before`',
        !/github\.event\.before/.test(checkStep),
        'a failed push\'s tip is the one commit that must not be a baseline');

    /*
     * X14: an `if:` or a `continue-on-error` turns a refusal into a note. Both
     * have to be absent from the two steps themselves — the job-level rule is
     * X2's business.
     */
    const testStep = stepIn(TEST_STEP) || '';
    assert('X14. neither step can be conditioned away or made advisory',
        !/\n\s+if:/.test(checkStep) && !/\n\s+if:/.test(testStep)
        && !/continue-on-error/.test(checkStep) && !/continue-on-error/.test(testStep));
}

console.log(failures === 0
    ? '\nAll icon-contract CI wiring checks passed.'
    : `\n${failures} icon-contract CI wiring check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
