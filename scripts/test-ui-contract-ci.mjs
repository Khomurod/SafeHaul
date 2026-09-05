#!/usr/bin/env node
/**
 * Is the UI contract actually enforced, and can it be got around?
 *
 * The sibling of `scripts/test-source-size-ci.mjs`, and a different subject from
 * `test-ui-contract.mjs` (which asks whether the checker measures correctly) and
 * `test-ui-contract-baseline.mjs` (which asks whether the inventory can be
 * edited). These ask whether CI runs it, whether the job it runs in can be
 * skipped, and whether the baseline it compares against can be chosen by the
 * change under test.
 *
 * Every assertion here is over the WIRING — `main.yml`, `package.json`,
 * `ci-plan.mjs` — because each of those is a way for a guard that looks present
 * to do nothing. The check spent its whole life in `frontend-quality`, a lane
 * `plan` can skip on a tree-hash proof; that was survivable while it only read
 * the working tree, and stopped being survivable the moment it started making a
 * claim about history.
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
     * W7: without the flag the guard SKIPS the comparison when it cannot find a
     * base, which is the right default for a contributor's shallow clone and
     * exactly wrong in the place tampering is the concern. A flag CI does not
     * pass is decorative.
     */
    const checkStep = stepIn(CHECK_STEP) || '';
    assert('W7. CI proves the allowlist did not grow, rather than trusting it',
        /check:ui-contract -- --require-baseline/.test(checkStep),
        'without the flag a run that cannot find a base passes instead of refusing');

    assert('W8. and that job has the history the proof needs',
        /- uses: actions\/checkout@v5\n\s+with:\n\s+fetch-depth: 0/.test(jobBody),
        'a depth-1 checkout has no previous allowlist to compare against');

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
     * W10: the base is asked of GitHub, never taken from the event's `before` —
     * that is the previous push's tip, and after a push that FAILED this check it
     * IS the failure, so the next push measures from it and the tampered
     * inventory looks unchanged. Asserted on the ENV VALUES rather than the step
     * text, so a comment mentioning `before` cannot satisfy it.
     */
    const envValues = [...checkStep.matchAll(/^\s+([A-Z_]+): (.*)$/gm)]
        .reduce((all, [, key, value]) => ({ ...all, [key]: value }), {});
    assert('W10. the base comes from the event or from GitHub, never from `before`',
        /github\.event\.pull_request\.base\.sha/.test(envValues.GITHUB_PR_BASE_SHA || '')
        && !Object.values(envValues).some((value) => /github\.event\.before/.test(value)),
        JSON.stringify(envValues));
    assert('W11. and it can ask, because the job carries a token and checks: read',
        /secrets\.GITHUB_TOKEN/.test(envValues.GITHUB_TOKEN || '')
        && /permissions:\n\s+contents: read\n(\s+#.*\n)*\s+checks: read/.test(jobBody),
        'without checks:read the lookup returns nothing and every push refuses');

    /*
     * W12: one override, shared with the size guard. Two env vars meaning "the
     * baseline" would be two places an operator can get it wrong, and the second
     * one would be the one nobody documents.
     */
    assert('W12. the manual-run override is the one the size guard already has',
        /github\.event\.inputs\.source_size_base/.test(envValues.SOURCE_SIZE_BASE || '')
        && !/UI_CONTRACT_BASE/.test(workflow),
        'the refusal names SOURCE_SIZE_BASE; a second variable would be a second bypass');
    const dispatchInput = workflow.slice(
        workflow.indexOf('      source_size_base:'), workflow.indexOf("        default: ''"),
    );
    assert('W12b. and the dispatch dialog says it feeds this guard too',
        /UI.contract/i.test(dispatchInput),
        'an operator setting it for one guard must know it moves the other');

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
