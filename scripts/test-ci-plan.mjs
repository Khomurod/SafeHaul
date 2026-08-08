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

import { readFileSync } from 'node:fs';
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

assert('A5. the static marketing site needs no test lane',
    chosen(['landing/index.html']).length === 0,
    JSON.stringify(chosen(['landing/index.html'])));

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
for (const deployJob of ['deploy-testing', 'deploy-functions']) {
    const block = workflow.slice(workflow.indexOf(`\n  ${deployJob}:`));
    const header = block.slice(0, block.indexOf('\n    steps:'));
    const condition = header.slice(header.indexOf('\n    if:'), header.indexOf('\n    concurrency:') + 1
        || undefined);

    assert(`E6. ${deployJob} cannot start unless the gate passed`,
        header.includes('- release-validation')
            && condition.includes("needs.release-validation.result == 'success'"),
        'deployment must depend on the validation verdict, explicitly');

    assert(`E6b. ${deployJob} opts out of the inherited skip`,
        /!\s*cancelled\(\)/.test(condition),
        'without !cancelled() a run whose lanes were all proven deploys nothing');
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

console.log(failures === 0 ? '\nAll CI plan and gate checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
