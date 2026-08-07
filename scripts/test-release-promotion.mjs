#!/usr/bin/env node
/**
 * Test harness for the production-promotion gate.
 *
 * No external test runner; plain assertions, matching
 * scripts/test-deploy-incremental.mjs. Exit 0 = all pass, 1 = failures logged.
 *
 * These are the release system's FAILURE modes, and they matter more than the
 * happy path: every one of them is a way the wrong code could reach
 * app.safehaul.io. They are asserted here rather than discovered in production.
 *
 * Scenarios covered:
 *   1. A full, successfully-released Testing SHA resolves to its pinned version.
 *   2. A short SHA is refused (ambiguous — could match several commits).
 *   3. A branch name is refused (not a release identity).
 *   4. A SHA with no Testing deployment is refused — this is the "newer untested
 *      commit on main" case, and the one that must never succeed.
 *   5. A FAILED Testing deployment is not promotable.
 *   6. A Testing deployment with no pinned Hosting version is not promotable.
 *   7. A commit whose checks later went red is not promotable.
 *   8. A repeat promotion of the live release reports already_live (idempotent,
 *      so a double-clicked button does not redeploy).
 *   9. Promoting an OLDER release while a newer one is live is allowed — that is
 *      rollback, and it must stay possible.
 *  10. The resolver reads pinned versions from the deployment payload, never
 *      from "whatever is currently live on Testing".
 *  11. A release whose backend rollout has not been confirmed (deployment still
 *      `in_progress`) is not promotable.
 *  12. QUEUED or IN-PROGRESS required checks refuse the promotion. "No completed
 *      failure yet" is not the same as "green".
 *  13. A required check that never ran at all refuses the promotion.
 *  14. Foreign deployment records sharing the `production` environment name (this
 *      repository has a long tail of Vercel-created ones) are ignored rather
 *      than mistaken for the live SafeHaul release.
 *  15. The required-check list matches the job names in main.yml, so a renamed
 *      job is caught in CI rather than at release time.
 *  16. `readReleaseStatus` reports blockers instead of throwing, and never marks
 *      an unfinished release eligible.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
    REQUIRED_RELEASE_CHECKS,
    resolveTestingRelease,
    IneligibleReleaseError,
} from './resolve-testing-release.mjs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { readReleaseStatus } = require('../functions/releaseManagement/eligibility.js');

const SHA_TESTED = 'a'.repeat(40);
const SHA_NEWER = 'b'.repeat(40);
const SHA_FAILED = 'c'.repeat(40);
const SHA_PREVIOUS = 'd'.repeat(40);

let failures = 0;

function assert(label, condition, detail) {
    if (condition) {
        console.log(`  ok   ${label}`);
        return;
    }
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
}

async function refuses(label, options) {
    try {
        await resolveTestingRelease(options);
        failures += 1;
        console.error(`  FAIL ${label} — expected a refusal, but it resolved`);
    } catch (error) {
        assert(
            label,
            error instanceof IneligibleReleaseError,
            `threw ${error.constructor.name}: ${error.message}`,
        );
    }
}

/** Every required check, completed and green. The default healthy commit. */
const allRequiredGreen = REQUIRED_RELEASE_CHECKS.map((name) => ({
    name,
    status: 'completed',
    conclusion: 'success',
}));

/**
 * Builds a fake GitHub REST surface. `deployments` is keyed by environment.
 * Anything not listed simply does not exist, which is what the real API returns.
 */
function fakeApi({ deployments = {}, statuses = {}, checkRuns = allRequiredGreen } = {}) {
    return async (path) => {
        const statusMatch = path.match(/^\/deployments\/(\d+)\/statuses/);
        if (statusMatch) {
            return (statuses[statusMatch[1]] || []).map((state) => ({ state }));
        }
        if (path.startsWith('/commits/')) {
            return { check_runs: checkRuns };
        }
        const envMatch = path.match(/environment=([a-z]+)/);
        const shaMatch = path.match(/sha=([0-9a-f]+)/);
        const pool = deployments[envMatch?.[1]] || [];
        return shaMatch ? pool.filter((d) => d.sha === shaMatch[1]) : pool;
    };
}

const goodTestingDeployment = {
    id: 101,
    sha: SHA_TESTED,
    created_at: '2026-08-07T11:00:49Z',
    payload: { appVersionId: 'ver-app-101', landingVersionId: 'ver-landing-101' },
};

const healthy = fakeApi({
    deployments: { testing: [goodTestingDeployment], production: [] },
    statuses: { 101: ['success'] },
});

console.log('Production promotion gate');

// 1 — happy path
{
    const result = await resolveTestingRelease({ candidateSha: SHA_TESTED, api: healthy });
    assert('1. resolves a tested SHA to its pinned Hosting version',
        result.appVersionId === 'ver-app-101' && result.landingVersionId === 'ver-landing-101',
        JSON.stringify(result));
    assert('1b. reports it is not already live', result.alreadyLive === false);
}

// 2, 3 — the candidate must be a real, unambiguous release identity
await refuses('2. refuses a short SHA', { candidateSha: SHA_TESTED.slice(0, 7), api: healthy });
await refuses('3. refuses a branch name', { candidateSha: 'main', api: healthy });

// 4 — THE important one: a newer commit on main that Testing never deployed
await refuses('4. refuses a commit with no Testing deployment (newer untested main)', {
    candidateSha: SHA_NEWER,
    api: healthy,
});

// 5 — a failed Testing deploy is not a release
await refuses('5. refuses a FAILED Testing deployment', {
    candidateSha: SHA_FAILED,
    api: fakeApi({
        deployments: { testing: [{ id: 202, sha: SHA_FAILED, payload: { appVersionId: 'v', landingVersionId: 'v' } }] },
        statuses: { 202: ['failure'] },
    }),
});

// 6 — incomplete release metadata cannot be promoted by ID
await refuses('6. refuses a Testing deployment with no pinned Hosting version', {
    candidateSha: SHA_TESTED,
    api: fakeApi({
        deployments: { testing: [{ id: 303, sha: SHA_TESTED, payload: {} }] },
        statuses: { 303: ['success'] },
    }),
});

// 7 — checks that went red after deployment
await refuses('7. refuses a commit whose checks are now red', {
    candidateSha: SHA_TESTED,
    api: fakeApi({
        deployments: { testing: [goodTestingDeployment], production: [] },
        statuses: { 101: ['success'] },
        checkRuns: [
            ...allRequiredGreen.filter((run) => run.name !== 'frontend-quality'),
            { name: 'frontend-quality', status: 'completed', conclusion: 'failure' },
        ],
    }),
});

// 7b — non-blocking lanes must not block a release
{
    const result = await resolveTestingRelease({
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [
                ...allRequiredGreen,
                { name: 'typecheck', status: 'completed', conclusion: 'skipped' },
                { name: 'e2e-a11y', status: 'completed', conclusion: 'neutral' },
            ],
        }),
    });
    assert('7b. tolerates skipped/neutral non-blocking checks', result.appVersionId === 'ver-app-101');
}

// 8 — double-click safety
{
    const result = await resolveTestingRelease({
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: {
                testing: [goodTestingDeployment],
                production: [{ id: 900, sha: SHA_TESTED, payload: { appVersionId: 'ver-app-101' } }],
            },
            statuses: { 101: ['success'], 900: ['success'] },
        }),
    });
    assert('8. repeat promotion of the live release is a no-op', result.alreadyLive === true);
}

// 9 — rollback: promoting an older, previously released SHA
{
    const result = await resolveTestingRelease({
        candidateSha: SHA_PREVIOUS,
        api: fakeApi({
            deployments: {
                testing: [
                    goodTestingDeployment,
                    {
                        id: 55,
                        sha: SHA_PREVIOUS,
                        payload: { appVersionId: 'ver-app-55', landingVersionId: 'ver-landing-55' },
                    },
                ],
                production: [{ id: 901, sha: SHA_TESTED, payload: { appVersionId: 'ver-app-101' } }],
            },
            statuses: { 101: ['success'], 55: ['success'], 901: ['success'] },
        }),
    });
    assert('9. an older tested release stays promotable (rollback)',
        result.appVersionId === 'ver-app-55' && result.alreadyLive === false,
        JSON.stringify(result));
}

// 10 — the pin comes from the record, not from live Testing
{
    const result = await resolveTestingRelease({
        candidateSha: SHA_PREVIOUS,
        api: fakeApi({
            deployments: {
                testing: [
                    // Newest first, as the API returns them. Resolving SHA_PREVIOUS
                    // must NOT pick up the newer entry's version.
                    goodTestingDeployment,
                    {
                        id: 55,
                        sha: SHA_PREVIOUS,
                        payload: { appVersionId: 'ver-app-55', landingVersionId: 'ver-landing-55' },
                    },
                ],
                production: [],
            },
            statuses: { 101: ['success'], 55: ['success'] },
        }),
    });
    assert('10. pins the requested release, not the newest Testing release',
        result.appVersionId === 'ver-app-55',
        `got ${result.appVersionId}`);
}

// 11 — THE shared-backend case. The Testing frontend is deployed and every check
// is green, but `release-ready` has not run, so the shared Cloud Functions /
// rules / index rollout is unconfirmed. Not promotable.
await refuses('11. refuses a release whose backend rollout is unconfirmed (in_progress)', {
    candidateSha: SHA_TESTED,
    api: fakeApi({
        deployments: { testing: [goodTestingDeployment], production: [] },
        statuses: { 101: ['in_progress'] },
    }),
});

// 11b — and with no status at all, which is what a failed status POST leaves
await refuses('11b. refuses a release with no deployment status at all', {
    candidateSha: SHA_TESTED,
    api: fakeApi({
        deployments: { testing: [goodTestingDeployment], production: [] },
        statuses: {},
    }),
});

// 12 — queued / in-progress required checks are NOT "not yet failed"
for (const [label, status] of [['queued', 'queued'], ['in progress', 'in_progress']]) {
    await refuses(`12. refuses while a required check is ${label}`, {
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [
                ...allRequiredGreen.filter((run) => run.name !== 'Deploy Cloud Functions'),
                { name: 'Deploy Cloud Functions', status, conclusion: null },
            ],
        }),
    });
}

// 13 — a required check that never appeared at all
await refuses('13. refuses when a required check is missing entirely', {
    candidateSha: SHA_TESTED,
    api: fakeApi({
        deployments: { testing: [goodTestingDeployment], production: [] },
        statuses: { 101: ['success'] },
        checkRuns: allRequiredGreen.filter((run) => run.name !== 'rules-emulator'),
    }),
});

// 14 — foreign records in the shared `production` environment.
//
// This repository's Production environment is full of Vercel-created
// deployments with empty payloads and unrelated commit history. Treating the
// newest one as "the live SafeHaul release" would report a foreign SHA on the
// Release Management screen, and could make a real promotion look already-live.
{
    const result = await resolveTestingRelease({
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: {
                testing: [goodTestingDeployment],
                production: [
                    { id: 990, sha: SHA_TESTED, payload: {} },            // foreign (Vercel)
                    { id: 991, sha: SHA_NEWER, payload: {} },             // foreign (Vercel)
                    { id: 992, sha: SHA_PREVIOUS, payload: { appVersionId: 'ver-app-55' } },
                ],
            },
            statuses: { 101: ['success'], 990: ['success'], 991: ['success'], 992: ['success'] },
        }),
    });
    assert('14. ignores foreign deployments sharing the production environment',
        result.alreadyLive === false,
        'a Vercel record with a matching SHA was mistaken for the live release');
}

// 15 — the required-check list must match the workflow's real job names
{
    const here = dirname(fileURLToPath(import.meta.url));
    const workflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');
    const missing = REQUIRED_RELEASE_CHECKS.filter((name) => {
        // A job contributes its `name:` when set, otherwise its job id.
        const asJobName = new RegExp(`^\\s{4}name:\\s*['"]?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]?\\s*$`, 'm');
        const asJobId = new RegExp(`^\\s{2}${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'm');
        return !asJobName.test(workflow) && !asJobId.test(workflow);
    });
    assert('15. every required check names a real job in main.yml',
        missing.length === 0,
        `not found in main.yml: ${missing.join(', ')}`);
}

// 17 — a merge to main must NEVER be able to update the Production frontend.
//
// This is the load-bearing property of the whole two-channel architecture, and
// it is currently true only because nothing in main.yml names a production
// Hosting target. That is one careless copy-paste away from being false, and the
// failure would be silent: the pipeline would go green while every merge shipped
// straight to app.safehaul.io. So it is asserted rather than assumed.
{
    const here = dirname(fileURLToPath(import.meta.url));
    const mainWorkflow = readFileSync(resolvePath(here, '../.github/workflows/main.yml'), 'utf8');

    const forbidden = [
        'hosting:production',
        'safehaul-app-production',
        'landing-production',
        'safehaul-landing-production',
    ].filter((needle) => mainWorkflow.includes(needle));

    assert('17. main.yml cannot deploy the Production frontend',
        forbidden.length === 0,
        `main.yml references production Hosting: ${forbidden.join(', ')}`);

    // And the promotion workflow must stay manual-only — a `push:` trigger there
    // would reintroduce automatic production releases by the other door.
    const promoteWorkflow = readFileSync(resolvePath(here, '../.github/workflows/promote-production.yml'), 'utf8');
    const triggers = promoteWorkflow.slice(promoteWorkflow.indexOf('\non:'), promoteWorkflow.indexOf('\njobs:'));

    assert('17b. the promotion workflow is dispatch-only',
        triggers.includes('workflow_dispatch') && !/\n\s{2}(push|schedule|pull_request):/.test(triggers),
        `promote-production.yml triggers: ${triggers.replace(/\s+/g, ' ').slice(0, 200)}`);

    // 18 — a rotated release credential must actually reach runtime.
    //
    // A Functions deploy pins each bound secret to the version that existed at
    // deploy time, and the incremental planner only redeploys functions whose
    // source changed — which rotating a credential never does. Without these
    // three on the always-include list, a rotated GitHub App key would sit in
    // Secret Manager doing nothing, and the only symptom would be the Releases
    // screen quietly reporting that it is not connected.
    const alwaysInclude = mainWorkflow.match(/DEPLOY_FUNCTIONS_ALWAYS_INCLUDE:\s*(\S+)/)?.[1] || '';
    const releaseCallables = ['getReleaseStatus', 'promoteTestingToProduction', 'rollbackProductionRelease'];
    const notForced = releaseCallables.filter((name) => !alwaysInclude.split(',').includes(name));

    assert('18. the release callables redeploy on every main push',
        notForced.length === 0,
        `missing from DEPLOY_FUNCTIONS_ALWAYS_INCLUDE: ${notForced.join(', ')}`);
}

// 16 — the status view explains itself instead of throwing
{
    const status = await readReleaseStatus({
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['in_progress'] },
            checkRuns: [
                ...allRequiredGreen.filter((run) => run.name !== 'Deploy Cloud Functions'),
                { name: 'Deploy Cloud Functions', status: 'in_progress', conclusion: null },
            ],
        }),
    });
    assert('16. reports the current Testing release even when ineligible',
        status.testing?.sha === SHA_TESTED, JSON.stringify(status.testing));
    assert('16b. does not mark an unconfirmed release eligible',
        status.testing?.eligible === false);
    assert('16c. explains why, in more than one respect',
        status.testing?.blockers.length >= 2, JSON.stringify(status.testing?.blockers));
    assert('16d. reports no production release when none was recorded by this system',
        status.production === null);
}

// 16e — a fully healthy release reads as eligible, with no production yet
{
    const status = await readReleaseStatus({
        api: fakeApi({
            deployments: {
                testing: [goodTestingDeployment],
                production: [
                    { id: 992, sha: SHA_PREVIOUS, created_at: '2026-08-01T00:00:00Z', payload: { appVersionId: 'ver-app-55' } },
                    { id: 993, sha: SHA_NEWER, created_at: '2026-07-01T00:00:00Z', payload: { appVersionId: 'ver-app-44' } },
                ],
            },
            statuses: { 101: ['success'], 992: ['success'], 993: ['success'] },
        }),
    });
    assert('16e. a confirmed, green release is eligible', status.testing?.eligible === true,
        JSON.stringify(status.testing?.blockers));
    assert('16f. reports the current production release', status.production?.sha === SHA_PREVIOUS);
    assert('16g. reports the previous production release for rollback',
        status.previousProduction?.sha === SHA_NEWER);
}

console.log(failures === 0 ? '\nAll promotion-gate checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
