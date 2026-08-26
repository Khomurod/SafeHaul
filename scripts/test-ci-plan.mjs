#!/usr/bin/env node
/**
 * Tests for the CI plan and the fail-closed release-validation gate.
 *
 * Plain assertions, no external runner, matching `scripts/test-deploy-incremental.mjs`
 * and `scripts/test-release-promotion.mjs`. Exit 0 = all pass.
 *
 * These cover the ways a "skip work we already did" optimisation could turn into
 * a hole in the release gate. Every one of them is a way unvalidated code could
 * reach Testing and then be promoted to app.safehaul.io:
 *
 *   A. path selection — the right lanes for a change, in both directions;
 *   B. conservative fallback — unknown paths, unreadable diffs, shared code,
 *      configuration, workflows, security rules and the PDF/application
 *      architecture all force the full suite;
 *   C. provenance — an attestation only counts when it came from a successful
 *      run of this repository's own pull-request workflow against this exact
 *      source tree;
 *   D. the gate — a skipped lane with no justification, a failed lane, a
 *      cancelled run, a broken planner, and workflow/lane drift are all
 *      refusals;
 *   E. wiring — the lanes, the workflow jobs, the attestation steps and the
 *      promotion gate's required-check list all agree with each other;
 *   F. the incremental deploy base — a failed deploy must widen the next
 *      window, not silently drop the functions it changed.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import { createRequire } from 'node:module';
import {
    ALWAYS_REQUIRED_JOBS,
    LANES,
    LANE_NAMES,
    attestationName,
    diffRange,
    isUsableAttestation,
    lanesForPath,
    readAttestations,
    selectLanes,
} from './ci-plan.mjs';
import { evaluateValidation } from './verify-release-validation.mjs';
import { chooseDeployBase, readLastDeployedSha } from './resolve-deploy-base.mjs';
import { REQUIRED_DEPLOY_JOBS, evaluateDeployResults } from './verify-shipped.mjs';
import {
    SHIP_GRACE_MS, judgeCallables, judgeChannel, judgeMainShipped,
} from './check-release-health.mjs';

const require = createRequire(import.meta.url);
const { REQUIRED_RELEASE_CHECKS } = require('../functions/releaseManagement/eligibility.js');

const here = dirname(fileURLToPath(import.meta.url));
const workflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');

let failures = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

const TREE = 'f'.repeat(40);
const REPO_ID = 4321;

/** The lanes `selectLanes` turned on, as a sorted list. */
const chosen = (files) => {
    const { lanes } = selectLanes({ changedFiles: files });
    return LANE_NAMES.filter((lane) => lanes[lane]).sort();
};
const ALL = [...LANE_NAMES].sort();

/* ========================================================================== */
console.log('\nA. Path selection');
/* ========================================================================== */

assert('A1. a Cloud Functions change runs only the functions lane',
    JSON.stringify(chosen(['functions/leads/onLead.js'])) === JSON.stringify(['functions']),
    JSON.stringify(chosen(['functions/leads/onLead.js'])));

assert('A2. a feature-only frontend change skips the backend and rules lanes',
    JSON.stringify(chosen(['src/features/campaigns/CampaignCard.jsx']))
        === JSON.stringify(['frontend_build', 'frontend_e2e', 'frontend_unit', 'storybook'].sort()),
    JSON.stringify(chosen(['src/features/campaigns/CampaignCard.jsx'])));

assert('A3. an e2e spec change runs only the browser lane',
    JSON.stringify(chosen(['e2e/login.spec.cjs'])) === JSON.stringify(['frontend_e2e']));

assert('A4. a documentation-only change runs no test lane',
    chosen(['docs/RUNBOOK.md', 'README.md', 'CLAUDE.md', '.claude/settings.json']).length === 0,
    JSON.stringify(chosen(['docs/RUNBOOK.md', 'README.md'])));

// The marketing site has no build step, so "static content is not tested" is an
// easy assumption to make — and this assertion used to encode it. It let a
// landing-only commit select no lanes at all: CI was green while `main` served a
// homepage claiming MVR checks the product does not run, capturing no lead, and
// failing `npm run lint`. The two landing suites in `src/tests/` run in the
// `frontend_unit` lane, so that is the lane a landing change needs.
assert('A5. a marketing-site change runs the lane that holds the landing tests',
    JSON.stringify(chosen(['landing/index.html'])) === JSON.stringify(['frontend_unit']),
    JSON.stringify(chosen(['landing/index.html'])));

assert('A5b. a marketing-site change still skips the backend, rules and browser lanes',
    ['functions', 'rules', 'frontend_e2e', 'frontend_build', 'storybook']
        .every((lane) => !chosen(['landing/assets/css/styles.css']).includes(lane)),
    JSON.stringify(chosen(['landing/assets/css/styles.css'])));

assert('A6. a mixed frontend + backend change runs both sides',
    JSON.stringify(chosen(['src/features/auth/Login.jsx', 'functions/auth/claims.js']))
        === JSON.stringify(['frontend_build', 'frontend_e2e', 'frontend_unit', 'functions', 'storybook'].sort()),
    JSON.stringify(chosen(['src/features/auth/Login.jsx', 'functions/auth/claims.js'])));

/* ========================================================================== */
console.log('\nB. Conservative fallback to the full suite');
/* ========================================================================== */

const forcesFull = [
    ['a dependency lockfile', 'package-lock.json'],
    ['the frontend manifest', 'package.json'],
    ['the functions lockfile', 'functions/package-lock.json'],
    ['build configuration', 'vite.config.js'],
    ['test-runner configuration', 'vitest.config.js'],
    ['Playwright configuration', 'playwright.config.cjs'],
    ['lint configuration', 'eslint.config.js'],
    ['Firebase project configuration', 'firebase.json'],
    ['Firestore security rules', 'src/firestore.rules'],
    ['Storage security rules', 'src/storage.rules'],
    ['Firestore indexes', 'firestore.indexes.json'],
    ['a CI workflow', '.github/workflows/main.yml'],
    ['a release script', 'scripts/record-release.mjs'],
    ['the CI planner itself', 'scripts/ci-plan.mjs'],
    ['shared UI', 'src/shared/components/form/InputField.jsx'],
    ['the design system', 'src/design-system/Button.jsx'],
    ['a shared hook', 'src/hooks/useCompany.js'],
    ['shared library code', 'src/lib/applicationWrite.js'],
    ['the app shell', 'src/app/routes.jsx'],
    ['the test setup', 'src/tests/setup.js'],
    ['the app entry point', 'src/main.jsx'],
    ['the shared application/PDF architecture', 'src/features/applications/services/applicationPdfService.js'],
    ['anything PDF-named', 'src/features/signing/pdfOverlay.js'],
    ['the PDF worker asset', 'public/pdf.worker.min.mjs'],
    ['an unrecognised top-level file', 'Dockerfile'],
    ['an unrecognised directory', 'terraform/main.tf'],
];

for (const [label, path] of forcesFull) {
    const { full, lanes } = selectLanes({ changedFiles: [path] });
    assert(`B. ${label} (${path}) forces the full suite`,
        full === true && LANE_NAMES.every((lane) => lanes[lane]),
        `full=${full} lanes=${JSON.stringify(lanes)}`);
}

assert('B27. one cross-cutting file among many harmless ones still forces the full suite',
    selectLanes({ changedFiles: ['docs/a.md', 'package-lock.json', 'landing/i.html'] }).full === true);

assert('B28. an undeterminable change set forces the full suite',
    selectLanes({ changedFiles: null }).full === true
        && selectLanes({ changedFiles: undefined }).full === true);

assert('B29. an empty change set forces the full suite rather than skipping everything',
    selectLanes({ changedFiles: [] }).full === true,
    'an empty diff means the diff was wrong, not that nothing needs testing');

assert('B30. an unclassifiable path is cross-cutting, not harmless',
    lanesForPath('') === null && lanesForPath(undefined) === null);

/* -- the diff range, which is where "could not be determined" comes from ---- */

assert('B31. a pull request diffs against its base',
    diffRange({ eventName: 'pull_request', event: { pull_request: { base: { sha: 'abc' } } } })
        ?.base === 'abc');

assert('B32. a pull request with no base sha has no usable range',
    diffRange({ eventName: 'pull_request', event: {} }) === null);

assert('B33. a push diffs against its previous head',
    diffRange({ eventName: 'push', event: { before: 'def' } })?.base === 'def');

assert('B34. a push with no previous head (new branch / force push) has no usable range',
    diffRange({ eventName: 'push', event: { before: '0'.repeat(40) } }) === null
        && diffRange({ eventName: 'push', event: {} }) === null);

assert('B35. a manual dispatch has no change set, so it runs everything',
    diffRange({ eventName: 'workflow_dispatch', event: {} }) === null);

/* ========================================================================== */
console.log('\nC. Provenance — what counts as proof');
/* ========================================================================== */

const name = attestationName(TREE, 'frontend_e2e');
const goodArtifact = {
    name,
    expired: false,
    workflow_run: { id: 77, repository_id: REPO_ID, head_repository_id: REPO_ID },
};
const goodRun = { status: 'completed', conclusion: 'success', event: 'pull_request' };

assert('C1. accepts an attestation from a successful pull-request run of this repo',
    isUsableAttestation(goodArtifact, goodRun, { name, repositoryId: REPO_ID }).ok === true,
    JSON.stringify(isUsableAttestation(goodArtifact, goodRun, { name, repositoryId: REPO_ID })));

const rejects = [
    ['an expired artifact', { ...goodArtifact, expired: true }, goodRun],
    ['a different artifact name', { ...goodArtifact, name: `${name}-x` }, goodRun],
    ['another repository', { ...goodArtifact, workflow_run: { ...goodArtifact.workflow_run, repository_id: 999 } }, goodRun],
    ['a fork', { ...goodArtifact, workflow_run: { ...goodArtifact.workflow_run, head_repository_id: 999 } }, goodRun],
    ['an unreadable run', goodArtifact, null],
    ['a still-running run', goodArtifact, { ...goodRun, status: 'in_progress', conclusion: null }],
    ['a failed run', goodArtifact, { ...goodRun, conclusion: 'failure' }],
    ['a cancelled run', goodArtifact, { ...goodRun, conclusion: 'cancelled' }],
    ['a run that was never a pull request', goodArtifact, { ...goodRun, event: 'workflow_dispatch' }],
];

for (const [label, artifact, run] of rejects) {
    assert(`C. rejects ${label}`,
        isUsableAttestation(artifact, run, { name, repositoryId: REPO_ID }).ok === false);
}

// The tree hash is the identity. An attestation for a different tree is simply a
// different artifact name and can never be found by a lookup for this one.
assert('C11. an attestation is bound to one exact source tree',
    attestationName('a'.repeat(40), 'rules') !== attestationName('b'.repeat(40), 'rules'));

{
    // A lookup that 404s, times out or returns junk must leave the lane unproven.
    const attested = await readAttestations({
        treeSha: TREE,
        lanes: ['frontend_e2e', 'rules'],
        repositoryId: REPO_ID,
        api: async () => { throw new Error('502 Bad Gateway'); },
    });
    assert('C12. an attestation lookup that errors leaves every lane unproven',
        attested.frontend_e2e === false && attested.rules === false,
        JSON.stringify(attested));
}

{
    // Defence in depth: if the API ever stops honouring the `name` filter and
    // hands back everything, the local name check must still reject.
    const attested = await readAttestations({
        treeSha: TREE,
        lanes: ['rules'],
        repositoryId: REPO_ID,
        api: async (path) => (path.startsWith('/actions/artifacts')
            ? { artifacts: [{ ...goodArtifact, name: attestationName('0'.repeat(40), 'rules') }] }
            : goodRun),
    });
    assert('C13. an unfiltered artifact list cannot smuggle in a foreign tree',
        attested.rules === false, JSON.stringify(attested));
}

{
    const attested = await readAttestations({
        treeSha: TREE,
        lanes: ['rules'],
        repositoryId: REPO_ID,
        api: async (path) => (path.startsWith('/actions/artifacts')
            ? { artifacts: [{ ...goodArtifact, name: attestationName(TREE, 'rules') }] }
            : goodRun),
    });
    assert('C14. a matching, successful attestation is accepted', attested.rules === true);
}

/* ========================================================================== */
console.log('\nD. The fail-closed gate');
/* ========================================================================== */

const allJobs = (result) => {
    const jobs = Object.fromEntries(ALWAYS_REQUIRED_JOBS.map((job) => [job, 'success']));
    for (const lane of LANE_NAMES) for (const job of LANES[lane].jobs) jobs[job] = result;
    return jobs;
};
const plan = (make) => Object.fromEntries(LANE_NAMES.map((lane) => [lane, make(lane)]));

const everythingRan = {
    planResult: 'success',
    jobResults: allJobs('success'),
    lanePlan: plan(() => ({ selected: true, attested: false })),
};

assert('D1. a run in which every lane executed and passed is complete',
    evaluateValidation(everythingRan).ok === true,
    JSON.stringify(evaluateValidation(everythingRan).problems));

assert('D2. a lane that was skipped because it is irrelevant is complete',
    evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'test-functions': 'skipped' },
        lanePlan: { ...plan(() => ({ selected: true, attested: false })), functions: { selected: false, attested: false } },
    }).ok === true);

assert('D3. a lane that was skipped because it is already proven is complete',
    evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('skipped'), ...Object.fromEntries(ALWAYS_REQUIRED_JOBS.map((j) => [j, 'success'])) },
        lanePlan: plan(() => ({ selected: true, attested: true })),
    }).ok === true,
    JSON.stringify(evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('skipped'), ...Object.fromEntries(ALWAYS_REQUIRED_JOBS.map((j) => [j, 'success'])) },
        lanePlan: plan(() => ({ selected: true, attested: true })),
    }).problems));

/* -- THE loophole this file exists to close -------------------------------- */
{
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'frontend-e2e': 'skipped' },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert('D4. a RELEVANT lane skipped with no proof is a refusal, not a pass',
        verdict.ok === false
            && verdict.lanes.some((l) => l.lane === 'frontend_e2e' && l.verdict === 'unjustified skip'),
        JSON.stringify(verdict.lanes.find((l) => l.lane === 'frontend_e2e')));
}

for (const bad of ['failure', 'cancelled', 'timed_out']) {
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'rules-emulator': bad },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert(`D5. a lane that concluded "${bad}" is a refusal even when attested`,
        verdict.ok === false);

    const stillRefused = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'rules-emulator': bad },
        lanePlan: plan(() => ({ selected: true, attested: true })),
    });
    assert(`D5b. an attestation cannot rescue a lane that concluded "${bad}"`,
        stillRefused.ok === false);
}

{
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'frontend-quality': undefined },
        lanePlan: plan(() => ({ selected: true, attested: false })),
    });
    assert('D6. a required job missing from the results entirely is a refusal',
        verdict.ok === false
            && verdict.lanes.some((l) => l.lane === 'frontend_unit' && l.verdict === 'indeterminate'),
        'a deleted or renamed job must not read as "nothing failed"');
}

assert('D7. a planner that did not succeed refuses the whole release',
    evaluateValidation({ ...everythingRan, planResult: 'failure' }).ok === false
        && evaluateValidation({ ...everythingRan, planResult: 'skipped' }).ok === false
        && evaluateValidation({ ...everythingRan, planResult: 'cancelled' }).ok === false
        && evaluateValidation({ ...everythingRan, planResult: undefined }).ok === false);

assert('D8. a planner that succeeded but reported nothing refuses the release',
    evaluateValidation({ planResult: 'success', jobResults: allJobs('success'), lanePlan: null }).ok === false
        && evaluateValidation({ planResult: 'success', jobResults: allJobs('success'), lanePlan: 'nonsense' }).ok === false);

assert('D9. a lane the planner never reported on refuses the release',
    evaluateValidation({
        planResult: 'success',
        jobResults: allJobs('success'),
        lanePlan: Object.fromEntries(
            LANE_NAMES.filter((lane) => lane !== 'rules').map((lane) => [lane, { selected: true, attested: false }]),
        ),
    }).ok === false,
    'a lane dropped from the plan must not disappear from the verdict');

assert('D10. an unknown lane in the plan refuses the release',
    evaluateValidation({
        ...everythingRan,
        lanePlan: { ...everythingRan.lanePlan, smuggled_lane: { selected: false, attested: true } },
    }).ok === false);

for (const job of ALWAYS_REQUIRED_JOBS) {
    assert(`D11. ${job} must run on every release`,
        evaluateValidation({
            ...everythingRan,
            jobResults: { ...allJobs('success'), [job]: 'skipped' },
        }).ok === false);
}

for (const malformed of [
    { selected: 'false', attested: 'true' },
    { selected: 'true', attested: 'false' },
    { selected: undefined, attested: undefined },
    { selected: 1, attested: 0 },
    {},
]) {
    const verdict = evaluateValidation({
        planResult: 'success',
        jobResults: { ...allJobs('success'), 'test-functions': 'skipped' },
        lanePlan: { ...plan(() => ({ selected: true, attested: false })), functions: malformed },
    });
    assert(`D12. a SKIPPED lane whose decision is ${JSON.stringify(malformed)} is a refusal`,
        verdict.ok === false
            && verdict.lanes.some((l) => l.lane === 'functions' && l.verdict === 'undecided'),
        'a stray pair of quotes around a workflow output must not read as "not relevant"');
}

assert('D13. a lane that ran green needs no decision from the planner',
    evaluateValidation({
        planResult: 'success',
        jobResults: allJobs('success'),
        lanePlan: { ...plan(() => ({ selected: true, attested: false })), functions: { selected: 'oops' } },
    }).ok === true,
    'a malformed decision must not fail a lane that demonstrably passed in this run');

/* ========================================================================== */
console.log('\nE. Wiring — workflow, lanes and the promotion gate agree');
/* ========================================================================== */

const GATE_JOB_NAME = 'Verify the release is fully validated';

for (const lane of LANE_NAMES) {
    for (const job of LANES[lane].jobs) {
        assert(`E1. lane ${lane} names a real job (${job})`,
            new RegExp(`^\\s{2}${job}:\\s*$`, 'm').test(workflow));
    }
}

for (const job of ALWAYS_REQUIRED_JOBS) {
    assert(`E2. ${job} exists in the workflow`,
        new RegExp(`^\\s{2}${job}:\\s*$`, 'm').test(workflow));
}

// Every lane must have somewhere to publish its proof. Without this, adding a
// lane would silently make it un-provable and every merge would re-run it —
// which is safe, but slow and confusing.
for (const lane of LANE_NAMES) {
    assert(`E3. lane ${lane} has an attestation step in the workflow`,
        workflow.includes(`-${lane}`) && new RegExp(`validated-\\$\\{\\{[^}]*\\}\\}-${lane}`).test(workflow),
        `no "validated-<tree>-${lane}" upload found`);
}

// The gate must receive the plan as the one json value the planner emitted.
// Reassembling it per-lane in YAML fails open — a missing output reads as "that
// lane was not relevant" and gets accepted with no proof. See `ci-plan.mjs`.
{
    const gate = workflow.slice(workflow.indexOf('\n  release-validation:'));
    const gateEnd = gate.indexOf('\n  deploy-testing:');
    const gateBlock = gateEnd === -1 ? gate : gate.slice(0, gateEnd);

    assert('E3b. the gate reads the lane plan from a single planner output',
        /LANE_PLAN:\s*\$\{\{\s*needs\.plan\.outputs\.lane_plan\s*\}\}\s*$/m.test(gateBlock),
        'LANE_PLAN must be exactly ${{ needs.plan.outputs.lane_plan }}');

    assert('E3c. the gate does not rebuild the lane plan from per-lane outputs',
        !/needs\.plan\.outputs\.(lane|attested)_(frontend|storybook|functions|rules)/.test(gateBlock),
        'per-lane plan outputs must not be reassembled into json in the workflow');
}

// And the planner must actually emit it, for every lane.
{
    const planner = readFileSync(resolvePath(here, './ci-plan.mjs'), 'utf8');
    assert('E3d. the planner emits a lane_plan output',
        /lane_plan:\s*JSON\.stringify\(lanePlan\)/.test(planner));
}

assert('E4. the promotion gate requires the release-validation check',
    REQUIRED_RELEASE_CHECKS.includes(GATE_JOB_NAME),
    `REQUIRED_RELEASE_CHECKS = ${JSON.stringify(REQUIRED_RELEASE_CHECKS)}`);

assert('E5. the release-validation job exists and always reports',
    new RegExp(`^\\s{4}name:\\s*${GATE_JOB_NAME}\\s*$`, 'm').test(workflow)
        && /release-validation:[\s\S]{0,600}?if:\s*always\(\)/.test(workflow),
    'the gate must run even when upstream jobs fail, or a failure would read as "no verdict"');

// Both deploy jobs, and therefore the release record and everything downstream
// of it, must sit behind the gate.
//
// The two clauses are a PAIR and neither may be dropped:
//
//   `!cancelled()` — a skip propagates down the WHOLE chain, and `always()` on
//   `release-validation` only un-skips that job, not its dependents. Without
//   this, a run where provenance proved every lane skips the deploy entirely
//   and main ships nothing. That happened on a60c6dc.
//
//   the explicit success check — `!cancelled()` also switches OFF the implicit
//   "all needs succeeded" rule, so this clause becomes the only thing stopping
//   a deploy after a FAILED gate.
//
// Dropping the first silently stops deployments; dropping the second silently
// permits an unvalidated one. Both are asserted.
// Applied to the WHOLE release chain rather than job by job, because this bug
// recurred three times: fixing `deploy-testing` alone left `deploy-functions`
// broken, and fixing both left `release-ready` broken one level further down.
// The taint keeps propagating past jobs that opted out, so every job below the
// gate needs the same pair.
//
// TWO CATEGORIES, and they need opposite rules:
//
//   GATED jobs must not run unless their dependencies succeeded. They do the
//   irreversible work — deploying, and declaring a release promotable.
//
//   REPORTER jobs must run EVEN WHEN their dependencies failed, because reporting
//   on that failure is their entire purpose. `verify-shipped` exists to say "the
//   deploy did not run"; a condition demanding a successful deploy would silence
//   it in exactly the case it was written for. Their checks live in their scripts,
//   where they are unit-tested, and are asserted separately below.
//
// Applying the gated rule to a reporter would silence the alarm; applying the
// reporter rule to a gated job would deploy after a failure. Hence two lists.
const RELEASE_CHAIN = ['deploy-testing', 'deploy-functions', 'release-ready'];
const REPORTER_JOBS = ['release-validation', 'verify-shipped'];

for (const jobId of RELEASE_CHAIN) {
    const block = workflow.slice(workflow.indexOf(`\n  ${jobId}:`));
    const header = block.slice(0, block.indexOf('\n    steps:'));
    // `needs:` entries are the `      - name` lines before the first key at
    // four-space indent that follows them.
    const needsBlock = header.slice(header.indexOf('\n    needs:'));
    const needs = [...needsBlock.matchAll(/^ {6}- ([a-z][a-z0-9-]*)$/gm)].map((m) => m[1]);

    assert(`E6. ${jobId} declares what it depends on`,
        needs.length > 0, 'expected a needs: list');

    assert(`E6b. ${jobId} opts out of the inherited skip`,
        /!\s*cancelled\(\)/.test(header),
        'without !cancelled() a run whose lanes were all proven skips this job, '
        + 'and main silently stops releasing');

    // `!cancelled()` disables the implicit "all needs succeeded" rule, so every
    // dependency has to be checked by hand. Missing one lets this job run after
    // that dependency FAILED.
    const unchecked = needs.filter((need) => !header.includes(`needs.${need}.result == 'success'`));
    assert(`E6c. ${jobId} checks every dependency explicitly`,
        unchecked.length === 0,
        `!cancelled() turns off the implicit success check, so these are unguarded: ${unchecked.join(', ')}`);
}

// Reporter jobs: the opposite rule. They must be able to run when their
// dependencies did not.
for (const jobId of REPORTER_JOBS) {
    const block = workflow.slice(workflow.indexOf(`\n  ${jobId}:`));
    const header = block.slice(0, block.indexOf('\n    steps:'));

    assert(`E6d. ${jobId} can still run when its dependencies failed`,
        /!\s*cancelled\(\)/.test(header) || /if:\s*always\(\)/.test(header),
        'a reporter that inherits the skip cannot report the thing it exists to report');

    assert(`E6e. ${jobId} does not gate itself on its dependencies succeeding`,
        !/needs\.(deploy-testing|deploy-functions|frontend-quality)\.result == 'success'/.test(header),
        'demanding a successful dependency would silence this job in exactly the case '
        + 'it was written for; the check belongs in its script, where it is unit-tested');
}

// E6f. Anything reachable by `workflow_dispatch` must be unsatisfiable off `main`.
//
// The `push` arm of these conditions was always pinned; the `workflow_dispatch`
// arm was pinned to nothing. A manual dispatch from a feature branch therefore
// deployed that branch to Testing and rolled out Cloud Functions that Production
// shares. It had never fired by accident only because a pull request cannot
// reach this path — `pull_request` matches neither arm — so nothing routine
// exercised it.
//
// This EVALUATES the condition instead of matching strings on it. The first
// version of this assertion checked that the header contained
// `github.ref == 'refs/heads/main'`, and a mutation test walked straight through
// it: the buggy form contains that exact string too, nested inside the push arm
// where it guards nothing. Substring checks cannot see structure. Substituting a
// hostile context and asking whether the job would run can.
//
// The job list is DERIVED from the workflow. A hardcoded list is how this file's
// other rules were learned the hard way — a new job with the same shape slips
// past a list, and the point of this rule is that the next one cannot.
//
// Deliberately NOT covered: `promote-production.yml`, which is dispatch-only with
// no branch guard. That is correct — it promotes an exact SHA resolved against
// the recorded Testing release rather than building whatever the ref points at,
// and rollback has to work from any ref. The rule is "a job that ships the
// current ref must be pinned to main", not "everything must be pinned".
{
    // Turn a GitHub `if:` expression into something JS can evaluate under a
    // supplied context. Only the operators these workflows actually use.
    const evaluateCondition = (expression, context) => {
        const js = expression
            .replace(/!\s*cancelled\(\)/g, String(!context.cancelled))
            .replace(/\bsuccess\(\)/g, 'true')
            .replace(/\balways\(\)/g, 'true')
            .replace(/github\.event_name/g, JSON.stringify(context.event_name))
            .replace(/github\.ref_name/g, JSON.stringify(context.ref.replace('refs/heads/', '')))
            .replace(/github\.ref/g, JSON.stringify(context.ref))
            .replace(/github\.repository/g, JSON.stringify(context.repository))
            .replace(/needs\.[a-z0-9-]+\.result/g, '"success"')
            .replace(/inputs\.[a-z_]+/g, '""')
            .replace(/'/g, '"');
        // eslint-disable-next-line no-new-func
        return Boolean(new Function(`return (${js});`)());
    };

    const dispatchJobs = [...workflow.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)]
        .map((match) => {
            const rest = workflow.slice(match.index + 1);
            const nextJob = rest.search(/^ {2}[a-z][a-z0-9-]*:$/m);
            const block = nextJob === -1 ? rest : rest.slice(0, nextJob);
            const stepsAt = block.indexOf('\n    steps:');
            const header = stepsAt === -1 ? block : block.slice(0, stepsAt);
            // `if: >-` folded scalar: the indented lines under it, joined.
            const ifAt = header.indexOf('\n    if: >-');
            if (ifAt === -1) return null;
            const lines = header.slice(ifAt).split('\n').slice(2);
            const body = [];
            for (const line of lines) {
                if (!/^ {6}\S/.test(line)) break;
                body.push(line.trim());
            }
            return { id: match[1], condition: body.join(' ') };
        })
        .filter((job) => job && job.condition.includes("github.event_name == 'workflow_dispatch'"));

    // If the scan finds nothing, the parser broke — that is not a clean result.
    assert('E6f. the dispatch-reachable job scan found jobs to check',
        dispatchJobs.length > 0,
        'no job mentions workflow_dispatch; the job-block parser is probably broken');

    const base = { cancelled: false, repository: 'Khomurod/SafeHaul' };

    const shippable = dispatchJobs.filter((job) => evaluateCondition(job.condition, {
        ...base, event_name: 'workflow_dispatch', ref: 'refs/heads/some-feature-branch',
    })).map((job) => job.id);

    assert('E6f. no dispatch-reachable job can run off main',
        shippable.length === 0,
        `these would run — and ship — from a dispatch on any branch: ${shippable.join(', ')}`);

    // And the fix must not have simply switched manual dispatch off: the
    // intended path, a dispatch on main, still has to reach these jobs.
    const brokenOnMain = dispatchJobs.filter((job) => !evaluateCondition(job.condition, {
        ...base, event_name: 'workflow_dispatch', ref: 'refs/heads/main',
    })).map((job) => job.id);

    assert('E6f. a dispatch on main still reaches them',
        brokenOnMain.length === 0,
        `pinning went too far — these can no longer be dispatched at all: ${brokenOnMain.join(', ')}`);

    // The set above is derived, so it cannot notice a job that drops out of it.
    // Removing `workflow_dispatch` from a deploy job would silently remove the
    // ability to re-run a deploy by hand — the same shape of failure as the
    // inherited-skip bug this file was written for, where nothing is red and
    // nothing ships. `RELEASE_CHAIN` is the list of jobs that must stay
    // manually runnable.
    const dispatchable = new Set(dispatchJobs.map((job) => job.id));
    const unreachable = RELEASE_CHAIN.filter((jobId) => !dispatchable.has(jobId));

    assert('E6g. the release chain can still be re-run by hand',
        unreachable.length === 0,
        `these no longer respond to workflow_dispatch at all: ${unreachable.join(', ')}`);
}

// `verify-shipped` is what turns "CI is green" into "it is actually live", so the
// promotion gate has to require it by name.
assert('E7a. the promotion gate requires proof the release shipped',
    REQUIRED_RELEASE_CHECKS.includes('Confirm the release actually shipped'),
    `REQUIRED_RELEASE_CHECKS = ${JSON.stringify(REQUIRED_RELEASE_CHECKS)}`);

// And it has to read the live site, not just trust the deploy job's exit code.
{
    const block = workflow.slice(workflow.indexOf('\n  verify-shipped:'));
    const job = block.slice(0, block.indexOf('\n  release-ready:'));
    assert('E7b. verify-shipped reads the deployed release back off the live site',
        job.includes('scripts/verify-live-release.mjs')
            && job.includes('https://truckerapp-system.web.app'),
        'a successful firebase exit code is not evidence the CDN is serving the new bundle');
    assert('E7c. verify-shipped checks that the deploy jobs actually ran',
        job.includes('scripts/verify-shipped.mjs'));
}

assert('E7. every required release check names a real job',
    REQUIRED_RELEASE_CHECKS.every((check) => {
        const escaped = check.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`^\\s{4}name:\\s*['"]?${escaped}['"]?\\s*$`, 'm').test(workflow)
            || new RegExp(`^\\s{2}${escaped}:\\s*$`, 'm').test(workflow);
    }),
    'a renamed job would make every promotion refuse');

/* ========================================================================== */
console.log('\nF. Incremental deploy base');
/* ========================================================================== */

// The window the Cloud Functions deploy measures "changed" against. Using the
// previous PUSH silently orphans a failed deploy's work — see
// `scripts/resolve-deploy-base.mjs` for the incident this prevents.

const SHA_DEPLOYED = '1'.repeat(40);
const SHA_PREV_PUSH = '2'.repeat(40);
const ancestorOf = (...shas) => (sha) => shas.includes(sha);

{
    const decision = chooseDeployBase({
        lastDeployedSha: SHA_DEPLOYED,
        pushBefore: SHA_PREV_PUSH,
        isAncestor: ancestorOf(SHA_DEPLOYED, SHA_PREV_PUSH),
    });
    assert('F1. prefers the last release confirmed deployed over the previous push',
        decision.base === SHA_DEPLOYED && decision.source === 'last-successful-deploy',
        JSON.stringify(decision));
}

// THE regression test: replay the incident.
//
// A commit ships a new function. Its deploy fails. A later commit lands and
// deploys fine. Measuring from the previous push would start AFTER the failed
// commit and never deploy its function. Measuring from the last CONFIRMED
// deploy keeps it inside the window.
{
    const lastConfirmed = SHA_DEPLOYED;   // deployed fine
    const failedDeploy = '3'.repeat(40);  // added the function; deploy died
    const decision = chooseDeployBase({
        lastDeployedSha: lastConfirmed,
        pushBefore: failedDeploy,
        isAncestor: ancestorOf(lastConfirmed, failedDeploy),
    });
    assert('F2. a failed deploy WIDENS the next window instead of dropping it',
        decision.base === lastConfirmed,
        'the commit whose deploy failed must stay inside the next diff range');
}

{
    const decision = chooseDeployBase({
        lastDeployedSha: null,
        pushBefore: SHA_PREV_PUSH,
        isAncestor: ancestorOf(SHA_PREV_PUSH),
    });
    assert('F3. with no confirmed release, falls back to the previous push',
        decision.base === SHA_PREV_PUSH && decision.source === 'push-before',
        JSON.stringify(decision));
}

{
    // A force push, a rewritten history, or re-running an older workflow. A base
    // that is not behind HEAD produces a meaningless diff.
    const decision = chooseDeployBase({
        lastDeployedSha: SHA_DEPLOYED,
        pushBefore: SHA_PREV_PUSH,
        isAncestor: ancestorOf(SHA_PREV_PUSH),
    });
    assert('F4. a recorded sha that is not an ancestor of HEAD is not used',
        decision.base === SHA_PREV_PUSH && decision.source === 'push-before',
        JSON.stringify(decision));
}

for (const [label, pushBefore] of [
    ['all-zero (a new branch)', '0'.repeat(40)],
    ['absent', null],
    ['a short sha', SHA_PREV_PUSH.slice(0, 7)],
]) {
    const decision = chooseDeployBase({
        lastDeployedSha: null,
        pushBefore,
        isAncestor: () => true,
    });
    assert(`F5. no range when the previous push is ${label}`,
        decision.base === null && decision.source === 'none',
        JSON.stringify(decision));
}

{
    const decision = chooseDeployBase({
        lastDeployedSha: null, pushBefore: null, isAncestor: () => true,
    });
    assert('F6. reports no base rather than inventing one',
        decision.base === null,
        'the deploy planner must be the one that decides what "no range" means');
}

/* -- reading the confirmed release ----------------------------------------- */

const deploymentApi = (deployments, statuses) => async (path) => {
    const match = path.match(/^\/deployments\/(\d+)\/statuses/);
    if (match) return (statuses[match[1]] || []).map((state) => ({ state }));
    return deployments;
};

{
    const sha = await readLastDeployedSha(deploymentApi(
        [
            { id: 3, sha: 'c'.repeat(40), payload: { appVersionId: 'v3' } },
            { id: 2, sha: 'b'.repeat(40), payload: { appVersionId: 'v2' } },
        ],
        { 3: ['in_progress'], 2: ['success'] },
    ));
    assert('F7. skips a release whose backend rollout was never confirmed',
        sha === 'b'.repeat(40),
        `got ${sha} — an in_progress record is not a deployed one`);
}

{
    const sha = await readLastDeployedSha(deploymentApi(
        [
            { id: 9, sha: 'd'.repeat(40), payload: {} },            // foreign (Vercel)
            { id: 8, sha: 'e'.repeat(40), payload: { appVersionId: 'v8' } },
        ],
        { 9: ['success'], 8: ['success'] },
    ));
    assert('F8. ignores foreign deployment records sharing the environment',
        sha === 'e'.repeat(40), `got ${sha}`);
}

{
    const sha = await readLastDeployedSha(deploymentApi([], {}));
    assert('F9. reports nothing when no release was ever confirmed', sha === null);
}

/* -- and the workflow has to actually use it ------------------------------- */
{
    const deploy = workflow.slice(workflow.indexOf('\n  deploy-functions:'));
    const resolveAt = deploy.indexOf('scripts/resolve-deploy-base.mjs');
    const deployAt = deploy.indexOf('scripts/deploy-functions-incremental.mjs');

    assert('F10. deploy-functions resolves the base before deploying',
        resolveAt !== -1 && deployAt !== -1 && resolveAt < deployAt,
        'the base must be resolved before the planner reads DEPLOY_GIT_BASE');

    assert('F11. deploy-functions may read the deployment records',
        /deployments:\s*read/.test(deploy.slice(0, deploy.indexOf('\n    steps:'))),
        'without deployments: read the base resolver silently falls back');
}

/* ========================================================================== */
console.log('\nG. Proof that a release actually shipped');
/* ========================================================================== */

// Replays a60c6dc: every lane proven, gate green, and all three deploy jobs
// silently skipped. The run reported success and nothing reached users.
{
    const verdict = evaluateDeployResults({
        'deploy-testing': 'skipped',
        'deploy-functions': 'skipped',
    });
    assert('G1. deploys that were SKIPPED are not a shipped release',
        verdict.ok === false && verdict.problems.length === 2,
        JSON.stringify(verdict.problems));
    assert('G1b. and it says so in words an operator can act on',
        verdict.problems.every((p) => /never deployed|did not deploy/.test(p)),
        JSON.stringify(verdict.problems));
}

assert('G2. both deploys succeeding is a shipped release',
    evaluateDeployResults({
        'deploy-testing': 'success', 'deploy-functions': 'success',
    }).ok === true);

for (const bad of ['failure', 'cancelled', undefined, '', 'something-new']) {
    for (const job of Object.keys(REQUIRED_DEPLOY_JOBS)) {
        const verdict = evaluateDeployResults({
            'deploy-testing': 'success', 'deploy-functions': 'success', [job]: bad,
        });
        assert(`G3. ${job} = ${JSON.stringify(bad)} is not a shipped release`,
            verdict.ok === false);
    }
}

assert('G4. a missing results object is a refusal, not a pass',
    evaluateDeployResults(undefined).ok === false
        && evaluateDeployResults(null).ok === false
        && evaluateDeployResults({}).ok === false,
    'absent evidence must never read as evidence of shipping');

/* ========================================================================== */
console.log('\nH. Release health monitoring');
/* ========================================================================== */

// Replays the surveyHistoricalReconstruction incident: a callable the app calls
// that simply is not in Cloud. It survived several green runs.
{
    const { problems, missing } = judgeCallables([
        { name: 'getReleaseStatus', status: 204 },
        { name: 'surveyHistoricalReconstruction', status: 404 },
    ]);
    assert('H1. a callable the app calls that returns 404 is reported',
        problems.length === 1 && missing.includes('surveyHistoricalReconstruction'),
        JSON.stringify({ problems, missing }));
}

assert('H2. callables that exist raise nothing',
    judgeCallables([{ name: 'a', status: 204 }, { name: 'b', status: 204 }]).problems.length === 0);

// A monitor that cries wolf gets muted, and a muted monitor protects nothing.
{
    const { problems, unchecked } = judgeCallables([
        { name: 'a', status: 204 }, { name: 'b', status: null },
    ]);
    assert('H3. an unreachable callable is reported but does NOT raise an alarm',
        problems.length === 0 && unchecked.includes('b'),
        'a timeout is not evidence a function is missing');
}

assert('H4. a channel serving something other than its recorded release is reported',
    judgeChannel('Testing', 'a'.repeat(40), 'b'.repeat(40)).problems.length === 1);

assert('H5. a channel serving exactly its recorded release is fine',
    judgeChannel('Testing', 'a'.repeat(40), 'a'.repeat(40)).problems.length === 0);

assert('H6. a channel that cannot say what it serves is reported',
    judgeChannel('Testing', 'a'.repeat(40), null).problems.length === 1);

assert('H7. a channel with no recorded release yet raises nothing',
    judgeChannel('Production', null, null).problems.length === 0,
    'a brand new channel is not a fault');

// "main merged but never deployed" — with a grace period so a merge in progress
// never trips it.
{
    const head = { sha: 'c'.repeat(40), committedAtMs: 1_000_000_000_000 };
    const long = head.committedAtMs + SHIP_GRACE_MS + 60_000;
    const short = head.committedAtMs + 60_000;

    assert('H8. a commit that has sat unreleased for hours is reported',
        judgeMainShipped(head, [], long).problems.length === 1);
    assert('H9. a commit merged moments ago is not',
        judgeMainShipped(head, [], short).problems.length === 0,
        'a deploy still in flight must not raise an alarm');
    assert('H10. a commit with a confirmed release is fine at any age',
        judgeMainShipped(head, [head.sha], long).problems.length === 0);
}

/* ========================================================================== */
console.log('\nI. Workflow wiring');
/* ========================================================================== */

// Cheap structural checks over EVERY workflow file, not just main.yml. These are
// the mistakes that produce a condition which quietly evaluates to nothing rather
// than an error: a dependency that does not exist, or a job referenced in a
// condition that was never declared as a dependency.
//
// Text-parsed on purpose: a yaml parser is only present here transitively, so
// depending on one would be one lockfile change away from breaking.
{
    /**
     * Job blocks from one workflow file.
     *
     * Scoped to the `jobs:` section, because the keys under `on:` sit at the same
     * indent and would otherwise be read as jobs named `push` and `schedule` —
     * which this check reported the first time it ran.
     */
    const parseJobs = (text) => {
        const jobsAt = text.search(/^jobs:$/m);
        if (jobsAt === -1) return [];
        const section = text.slice(jobsAt);
        const matches = [...section.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];

        return matches.map((match, index) => {
            const end = index + 1 < matches.length ? matches[index + 1].index : section.length;
            const block = section.slice(match.index, end);
            const stepsAt = block.indexOf('\n    steps:');
            const header = stepsAt === -1 ? block : block.slice(0, stepsAt);

            // All three forms YAML allows: a block list, an inline list, and a
            // bare scalar. The lane jobs use the scalar form (`needs: plan`),
            // which this check missed on its first run.
            const needs = [...header.matchAll(/^ {6}- ([a-z][a-z0-9-]*)$/gm)].map((m) => m[1]);
            const inline = header.match(/^ {4}needs:\s*\[([^\]]*)\]/m);
            if (inline) needs.push(...inline[1].split(',').map((s) => s.trim()).filter(Boolean));
            const scalar = header.match(/^ {4}needs:\s*([a-z][a-z0-9-]*)\s*$/m);
            if (scalar) needs.push(scalar[1]);

            return { id: match[1], block, header, needs };
        });
    };

    const workflowDir = resolvePath(here, '../.github/workflows');
    const files = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));

    assert('I0. there are workflow files to check', files.length >= 3, `found ${files.length}`);

    for (const file of files) {
        const jobs = parseJobs(readFileSync(resolvePath(workflowDir, file), 'utf8'));
        const jobIds = jobs.map((job) => job.id);

        assert(`I1. ${file}: parsed at least one job`, jobs.length > 0);

        assert(`I1b. ${file}: job ids are unique`,
            new Set(jobIds).size === jobIds.length,
            `duplicates: ${jobIds.filter((id, i) => jobIds.indexOf(id) !== i).join(', ')}`);

        for (const { id, block, header, needs } of jobs) {
            const unknown = needs.filter((need) => !jobIds.includes(need));
            assert(`I2. ${file}/${id}: every dependency names a real job`,
                unknown.length === 0, `unknown: ${unknown.join(', ')}`);

            // THE one that matters: a job referenced in a condition but never
            // depended on always reads as empty, so the condition silently
            // evaluates to false and the job never runs — no error, no warning.
            const referenced = [...block.matchAll(/needs\.([a-z][a-z0-9-]*)\./g)].map((m) => m[1]);
            const undeclared = [...new Set(referenced)].filter((ref) => !needs.includes(ref));
            assert(`I3. ${file}/${id}: every job it references is one it depends on`,
                undeclared.length === 0,
                `referenced but not in needs: ${undeclared.join(', ')} — these always read as empty`);

            assert(`I4. ${file}/${id}: declares where it runs`,
                /^ {4}runs-on:/m.test(header), 'missing runs-on');
        }
    }
}

/*
 * J. Playwright project selection: the scripts and the workflow are one contract.
 *
 * Learned on 2026-08-25, in CI, twice in one afternoon.
 *
 * `--project` ACCUMULATES on the Playwright command line. `main.yml` runs
 * `npm run test:e2e -- --project=chromium`, so any `--project` baked into the
 * script UNIONS with chromium rather than being narrowed by it. Naming the five
 * functional projects in `test:e2e` — a reasonable-looking way to keep the
 * visual lane out of a bare run — therefore put firefox, webkit and both mobile
 * lanes into every chromium shard. The runner installs only Chromium, so 113
 * tests failed with `browserType.launch: Executable doesn't exist`, on all four
 * shards, through all three retries.
 *
 * The visual lane is kept out by living in its own config instead, which no
 * caller can accidentally widen. These checks pin both halves of that.
 */
{
    const pkg = JSON.parse(readFileSync(resolvePath(here, '../package.json'), 'utf8'));
    const scripts = pkg.scripts || {};
    const workflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');

    assert('J1. test:e2e bakes in no --project',
        !/--project/.test(scripts['test:e2e'] || ''),
        `test:e2e = ${JSON.stringify(scripts['test:e2e'])} — a caller's --project would union with it, not replace it`);

    assert('J2. every workflow use of test:e2e names its project',
        [...workflow.matchAll(/npm run test:e2e\b[^\n]*/g)].every((m) => m[0].includes('--project=')),
        'a run without --project would execute every configured project');

    // The reason J1 is safe: the functional config carries no visual project, so
    // a bare `playwright test` cannot reach the lane that needs storybook-static.
    const functional = readFileSync(resolvePath(here, '../playwright.config.cjs'), 'utf8');
    assert('J3. the functional config declares no visual project',
        !/name:\s*'visual'/.test(functional),
        'a visual project here runs on a bare `playwright test`, which needs storybook-static');

    const visual = readFileSync(resolvePath(here, '../playwright.visual.config.cjs'), 'utf8');
    assert('J4. the visual config declares the visual project',
        /name:\s*'visual'/.test(visual));

    // And the scripts that drive it must ask for that config by name, or they
    // silently run the functional projects instead.
    for (const name of ['test:visual', 'test:visual:update']) {
        assert(`J5. ${name} names the visual config`,
            (scripts[name] || '').includes('--config=playwright.visual.config.cjs'),
            `${name} = ${JSON.stringify(scripts[name])}`);
    }
}


/* ========================================================================== */
console.log('\nK. Guards that stay guards');
/* ==========================================================================
 * Every check in this group exists because the repository had a lane that
 * reported instead of enforcing, and nobody could tell.
 *
 * The visual lane ran with `continue-on-error: true` on the stated grounds that
 * pixel baselines are not portable across machines. The CI record said otherwise:
 * `20 failed / 132 passed` on every run, the twenty being every application
 * screen, because the application fetched its typeface from a third party that
 * the runner could not reach. The lane had never once been green, it uploaded a
 * 52MB diff artifact nobody opened, and its warning annotation fired every time.
 *
 * The accessibility lane ran with `continue-on-error: true` under a comment
 * saying to fold it into the blocking lane "once confirmed green in CI". It had
 * been green — 11/11 — for weeks.
 *
 * A lane that cannot fail teaches everyone to ignore it, which is worse than no
 * lane at all. These assert that neither can quietly go back.
 * ========================================================================== */
{
    const workflowRaw = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');
    /*
     * Comment lines go first. This pipeline documents at length what it used to do
     * wrong, so the very strings these assertions forbid appear in prose right
     * above the steps that no longer contain them — and a guard that fires on its
     * own explanation is a guard someone deletes.
     */
    const workflowText = workflowRaw
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');

    /** The `- name: … / …` step block a given step name introduces. */
    const stepBlock = (name) => {
        const start = workflowText.indexOf(`- name: ${name}`);
        if (start < 0) return null;
        const rest = workflowText.slice(start + 1);
        const next = rest.indexOf('\n      - name:');
        return next < 0 ? rest : rest.slice(0, next);
    };

    const visualStep = stepBlock('Visual regression (pixel baselines)');
    assert('K1. the visual-regression step exists', visualStep !== null,
        'renaming it would make the continue-on-error assertion below vacuous');
    assert('K1. the visual-regression step is blocking',
        visualStep !== null && !/continue-on-error:\s*true/.test(visualStep),
        'a pixel-baseline lane that cannot fail is a report, not a guard');

    assert('K2. no workflow step excludes the accessibility specs',
        !/--grep-invert[^\n]*@a11y/.test(workflowText),
        'the axe specs belong in the blocking lane, not behind a grep-invert');
    assert('K2b. no workflow step runs the accessibility specs with continue-on-error',
        !/@a11y[\s\S]{0,200}?continue-on-error:\s*true/.test(workflowText),
        'an accessibility gate nobody has to pass is a report, not a gate');

    /*
     * The application must not fetch its typeface at runtime. That is what broke
     * the visual lane for the whole of its existence, and it degrades the product
     * for anyone whose network cannot reach the CDN.
     */
    const appCss = readFileSync(resolvePath(here, '../src/index.css'), 'utf8');
    const catalogCss = readFileSync(resolvePath(here, '../.storybook/preview.css'), 'utf8');
    const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [label, css] of [['src/index.css', appCss], ['.storybook/preview.css', catalogCss]]) {
        assert(`K3. ${label} loads no remote stylesheet or font`,
            !/@import\s+url\(\s*['"]?https?:/.test(withoutComments(css)),
            'the typeface is served from src/design-system/fonts; a remote @import is what '
            + 'made every application baseline fail on the runner');
    }

    const fontDir = resolvePath(here, '../src/design-system/fonts');
    assert('K3b. the typeface is in the repository',
        existsSync(resolvePath(fontDir, 'InterVariable.woff2'))
        && existsSync(resolvePath(fontDir, 'InterVariable-Italic.woff2'))
        && existsSync(resolvePath(fontDir, 'LICENSE.txt')),
        'both faces plus the SIL OFL licence that permits redistributing them');
}

console.log('\nL. The secret scanner is scoped, pinned, and still mandatory');
{
    /*
     * Recorded 2026-08-26, after run #159.
     *
     * `gitleaks/gitleaks-action@v2` chose the scan range from the event and, on
     * `workflow_dispatch`, passed no range at all — so a manual verification of
     * an already-merged commit scanned all 256 commits, reported eight known
     * legacy values from 2025-12..2026-03, failed `secret-scan`, failed
     * `release-validation` and skipped both deploys.
     *
     * These assertions exist because that was invisible from inside this
     * repository: the range lived in someone else's JavaScript. They pin the
     * three properties that must not quietly come back — the range is ours, the
     * scanner is pinned, and the full sweep cannot gate a release.
     */
    const secretScanJob = workflow.slice(
        workflow.indexOf('  secret-scan:'),
        workflow.indexOf('  callable-contract:'),
    );
    assert('L1. secret-scan uses no third-party scanning action',
        !/^\s*(-\s*)?uses:\s*gitleaks\//m.test(secretScanJob),
        'the action decided the range from the event; on workflow_dispatch that meant all history');
    assert('L2. secret-scan runs this repository\'s own scanner',
        /run:\s*node scripts\/secret-scan\.mjs/.test(secretScanJob),
        'the range must be selected by scripts/secret-scan.mjs, which is tested');
    assert('L3. secret-scan still checks out full history',
        /fetch-depth:\s*0/.test(secretScanJob),
        'a merge needs both parents\' ancestry present to resolve base..head');
    assert('L4. secret-scan carries no `if:`, so it cannot be conditioned away',
        !/^\s{4}if:/m.test(secretScanJob),
        'it is in ALWAYS_REQUIRED_JOBS; an `if:` that evaluates false would read as "nothing failed"');
    assert('L5. secret-scan is still required on every release',
        ALWAYS_REQUIRED_JOBS.includes('secret-scan'),
        'release-validation demands success from it, never a skip');
    assert('L6. release-validation still refuses when secret-scan fails',
        evaluateValidation({
            planResult: 'success',
            jobResults: { ...allJobs('success'), 'secret-scan': 'failure' },
            lanePlan: plan(() => ({ selected: true, attested: false })),
        }).ok === false,
        'a scanner failure must never be interpretable as a pass');
    assert('L7. release-validation also refuses when secret-scan is merely skipped',
        evaluateValidation({
            planResult: 'success',
            jobResults: { ...allJobs('success'), 'secret-scan': 'skipped' },
            lanePlan: plan(() => ({ selected: true, attested: false })),
        }).ok === false,
        'the deploy jobs sit behind this verdict, so a missing scan is a refusal');

    const scanner = readFileSync(resolvePath(here, './secret-scan.mjs'), 'utf8');
    assert('L8. the gitleaks version is pinned to an exact release, not "latest"',
        /GITLEAKS_VERSION\s*=\s*'\d+\.\d+\.\d+'/.test(scanner)
        // Asserted on the download URL, not on the prose: the docblock explains
        // that the action resolved "latest", and that explanation must be allowed
        // to say so.
        && /releases\/download\/v\$\{GITLEAKS_VERSION\}/.test(scanner)
        && !/releases\/latest/.test(scanner),
        'the action resolved "latest" at run time, so the gate\'s scanner changed underneath it');
    assert('L9. and pinned by digest as well as by tag',
        /GITLEAKS_SHA256\s*=\s*'[0-9a-f]{64}'/.test(scanner),
        'a tag can be moved; the digest is what makes a security gate reproducible');
    assert('L10. the scanner scans both the commit range and the resulting tree',
        /mode:\s*'git'/.test(scanner) && /mode:\s*'dir'/.test(scanner),
        'the range catches add-then-delete; the tree catches what is present now');

    /*
     * The full-history sweep still exists — it just cannot block a deploy. If it
     * ever gains a push or pull_request trigger, or turns up in
     * release-validation's `needs`, the 2026-08-26 failure is back.
     */
    const auditPath = resolvePath(here, '../.github/workflows/secret-history-audit.yml');
    assert('L11. the deliberate full-history audit exists',
        existsSync(auditPath),
        'legacy findings must stay visible somewhere, or removing them from the gate hides them');
    if (existsSync(auditPath)) {
        const audit = readFileSync(auditPath, 'utf8');
        const triggers = audit.slice(audit.indexOf('\non:'), audit.indexOf('\njobs:'));
        assert('L12. the audit runs on a schedule and on demand only',
            /schedule:/.test(triggers) && /workflow_dispatch:/.test(triggers)
            && !/^\s*push:/m.test(triggers) && !/^\s*pull_request:/m.test(triggers),
            'a full-history sweep on push or pull_request is the failure this change removed');
        assert('L13. the audit scans all refs',
            /--all/.test(audit) || /'--all'/.test(readFileSync(resolvePath(here, './secret-history-audit.mjs'), 'utf8')),
            'a secret parked on an unmerged branch is still in the repository');
    }
    const validationJob = workflow.slice(workflow.indexOf('  release-validation:'));
    assert('L14. release-validation does not depend on the history audit',
        !/secret-history-audit/.test(validationJob),
        'the audit reports; it must never be able to block a release');

    /*
     * The manual/force-push baseline is "the newest ancestor whose own
     * secret-scan passed", which the scanner asks GitHub for by check NAME. A
     * rename would mean "nothing was ever validated" — a refusal, so it fails
     * closed, but for a reason nobody would guess from the message.
     */
    assert('L17. the scanner asks about the same check name the workflow declares',
        /^ {2}secret-scan:$/m.test(workflow)
        && /SECRET_SCAN_CHECK_NAME = 'secret-scan'/.test(scanner),
        'the job name in main.yml and SECRET_SCAN_CHECK_NAME must be the same string');
    assert('L18. and the job can read checks in order to ask',
        /checks:\s*read/.test(secretScanJob),
        'without checks:read the lookup returns nothing and every manual run refuses');
    assert('L19. an unusable baseline is never widened to a full scan',
        !/--all/.test(scanner),
        'the full sweep belongs to the audit workflow; this one refuses instead');

    const gitleaksConfig = readFileSync(resolvePath(here, '../.gitleaks.toml'), 'utf8');
    assert('L15. the default rule set is still extended, not replaced',
        /useDefault\s*=\s*true/.test(gitleaksConfig),
        'switching rules off is the widest exemption there is');
    assert('L16. no path is exempted from scanning',
        !/^\s*paths\s*=/m.test(gitleaksConfig),
        'a path exemption would ignore a real credential pasted into that file; '
        + 'the two `.env.example` entries were measured to be unnecessary and deleted');
}

console.log(failures === 0 ? '\nAll CI plan and gate checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
