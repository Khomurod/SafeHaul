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
 *   1. A full, successfully-deployed Testing SHA resolves to its pinned version.
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
 */

import { resolveTestingRelease, IneligibleReleaseError } from './resolve-testing-release.mjs';

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

/**
 * Builds a fake GitHub REST surface. `deployments` is keyed by environment.
 * Anything not listed simply does not exist, which is what the real API returns.
 */
function fakeApi({ deployments = {}, statuses = {}, checkRuns = [] } = {}) {
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
        checkRuns: [{ name: 'frontend-quality', status: 'completed', conclusion: 'failure' }],
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
                { name: 'typecheck', status: 'completed', conclusion: 'skipped' },
                { name: 'e2e-a11y', status: 'completed', conclusion: 'neutral' },
                { name: 'frontend-quality', status: 'completed', conclusion: 'success' },
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
                production: [{ id: 900, sha: SHA_TESTED, payload: {} }],
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
                production: [{ id: 901, sha: SHA_TESTED, payload: {} }],
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

console.log(failures === 0 ? '\nAll promotion-gate checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
