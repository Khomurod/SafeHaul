/**
 * Promotion-gate scenario 16 — `readReleaseStatus` reports blockers instead
 * of throwing, verbatim from `test-release-promotion.mjs`.
 */
import { assert } from './harness.mjs';
import {
    SHA_TESTED,
    SHA_NEWER,
    SHA_PREVIOUS,
    allRequiredGreen,
    fakeApi,
    goodTestingDeployment,
    readReleaseStatus,
} from './fixtures.mjs';

export async function runStatusView() {
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

}
