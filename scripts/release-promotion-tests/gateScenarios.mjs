/**
 * Promotion-gate scenarios 1–14, verbatim from `test-release-promotion.mjs` —
 * see that file's header for what each scenario protects.
 */
import {
    REQUIRED_RELEASE_CHECKS,
    resolveTestingRelease,
} from '../resolve-testing-release.mjs';
import { assert, refuses } from './harness.mjs';
import {
    GATE_CHECK,
    SHA_TESTED,
    SHA_NEWER,
    SHA_FAILED,
    SHA_PREVIOUS,
    allRequiredGreen,
    fakeApi,
    goodTestingDeployment,
    healthy,
    readReleaseStatus,
} from './fixtures.mjs';

export async function runGateScenarios() {
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
            ...allRequiredGreen.filter((run) => run.name !== GATE_CHECK),
            { name: GATE_CHECK, status: 'completed', conclusion: 'failure' },
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

// 7c — A SKIPPED REQUIRED CHECK IS NOT A PASSED CHECK.
//
// This is the property that had to hold before `main.yml` was allowed to skip
// anything. `skipped` used to be an accepted conclusion for required checks,
// which was harmless while every required job ran unconditionally — and would
// have become a hole the moment jobs started skipping. Each required check is
// tested individually so that adding one to the list without thinking about its
// skip behaviour cannot quietly widen the gate.
for (const requiredCheck of REQUIRED_RELEASE_CHECKS) {
    await refuses(`7c. refuses when required check "${requiredCheck}" was SKIPPED`, {
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [
                ...allRequiredGreen.filter((run) => run.name !== requiredCheck),
                { name: requiredCheck, status: 'completed', conclusion: 'skipped' },
            ],
        }),
    });
}

// 7d — and the explanation says so, rather than reporting a failure it did not have
{
    const status = await readReleaseStatus({
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [
                ...allRequiredGreen.filter((run) => run.name !== GATE_CHECK),
                { name: GATE_CHECK, status: 'completed', conclusion: 'skipped' },
            ],
        }),
    });
    assert('7d. a skipped required check is reported as "did not run", not as a failure',
        status.testing?.eligible === false
            && status.testing.blockers.some((b) => b.includes('Did not run for this release')),
        JSON.stringify(status.testing?.blockers));
}

// 7e — a required check with an odd conclusion is refused too. `neutral` is the
// interesting one: it is acceptable for a non-blocking baseline and must NOT be
// acceptable for a required check.
for (const conclusion of ['neutral', 'cancelled', 'timed_out', 'action_required', 'stale', null]) {
    await refuses(`7e. refuses a required check that concluded "${conclusion}"`, {
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [
                ...allRequiredGreen.filter((run) => run.name !== GATE_CHECK),
                { name: GATE_CHECK, status: 'completed', conclusion },
            ],
        }),
    });
}

// 7f — an individual test lane is no longer in the required set, but a RED one
// must still stop a promotion. This is the sweep over non-required checks, and it
// is what catches a re-run of one E2E shard going red after deployment.
for (const lane of ['frontend-quality', 'E2E shard 3 of 4 (Chromium)', 'rules-emulator', 'test-functions']) {
    await refuses(`7f. refuses when non-required lane "${lane}" is red`, {
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [...allRequiredGreen, { name: lane, status: 'completed', conclusion: 'failure' }],
        }),
    });
}

// 7g — a test lane SKIPPED because a pull request already validated this exact
// source tree must not block. That is the whole optimisation, and if this
// refused, every optimised release would be un-promotable.
{
    const result = await resolveTestingRelease({
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: [
                ...allRequiredGreen,
                { name: 'frontend-quality', status: 'completed', conclusion: 'skipped' },
                { name: 'E2E shard 1 of 4 (Chromium)', status: 'completed', conclusion: 'skipped' },
                { name: 'rules-emulator', status: 'completed', conclusion: 'skipped' },
                { name: 'test-functions', status: 'completed', conclusion: 'skipped' },
                { name: 'frontend-build', status: 'completed', conclusion: 'skipped' },
                { name: 'Build the design-system catalog', status: 'completed', conclusion: 'skipped' },
            ],
        }),
    });
    assert('7g. a provably-covered release with skipped test lanes stays promotable',
        result.appVersionId === 'ver-app-101',
        'the required gate check vouches for the lanes; they need not each be green here');
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

// 13 — a required check that never appeared at all. Tested for every required
// check, because "the job was deleted from the workflow" and "the job was renamed"
// both look exactly like this from the gate's side.
for (const requiredCheck of REQUIRED_RELEASE_CHECKS) {
    await refuses(`13. refuses when required check "${requiredCheck}" is missing entirely`, {
        candidateSha: SHA_TESTED,
        api: fakeApi({
            deployments: { testing: [goodTestingDeployment], production: [] },
            statuses: { 101: ['success'] },
            checkRuns: allRequiredGreen.filter((run) => run.name !== requiredCheck),
        }),
    });
}

// 13b — an empty check list is a refusal, not a vacuous pass
await refuses('13b. refuses a commit with no checks at all', {
    candidateSha: SHA_TESTED,
    api: fakeApi({
        deployments: { testing: [goodTestingDeployment], production: [] },
        statuses: { 101: ['success'] },
        checkRuns: [],
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

}
