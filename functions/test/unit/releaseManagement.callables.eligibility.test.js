/**
 * What makes a release eligible, what happens when two promotions race, and
 * what a failed dispatch leaves behind.
 *
 * Part of the release-management callable suite. The fake GitHub, the Firestore
 * store, the fixtures and the hooks are in
 * `releaseManagement.callables.support.js`. Each `jest.mock` below has to stay
 * in this file, because Jest hoists it per file and cannot register one from a
 * helper.
 */

jest.mock('firebase-functions/v2/https', () => require('./releaseManagement.callables.support').httpsMock());
jest.mock('../../firebaseAdmin', () => require('./releaseManagement.callables.support').firebaseAdminMock());
jest.mock('../../releaseManagement/github', () => require('./releaseManagement.callables.support').githubMock());

const github = require('../../releaseManagement/github');
const { REQUIRED_RELEASE_CHECKS } = require('../../releaseManagement/eligibility');
const releaseManagement = require('../../releaseManagement');
const {
    mock, githubState, superAdmin, request, auditRecords, resetReleaseState,
    restoreReleaseState, SHA_TESTED,
} = require('./releaseManagement.callables.support');

const allRequiredGreen = REQUIRED_RELEASE_CHECKS.map((name) => ({
    name, status: 'completed', conclusion: 'success',
}));

beforeEach(resetReleaseState);
afterEach(restoreReleaseState);

// ---------------------------------------------------------------------------

describe('eligibility', () => {
    it('promotes a confirmed, fully green release', async () => {
        const result = await releaseManagement.promoteTestingToProduction(
            request(superAdmin(), { expectedSha: SHA_TESTED }),
        );

        expect(result).toMatchObject({ status: 'dispatched', sha: SHA_TESTED });
        expect(result.requestId).toEqual(expect.any(String));
        expect(github.dispatchPromotion).toHaveBeenCalledWith(expect.objectContaining({
            sha: SHA_TESTED, requestId: result.requestId,
        }));
    });

    it('refuses while the shared backend rollout is unconfirmed', async () => {
        githubState.statuses[101] = ['in_progress'];

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it.each([
        ['queued', 'queued'],
        ['in progress', 'in_progress'],
    ])('refuses while a required check is %s', async (_label, status) => {
        githubState.checkRuns = [
            ...allRequiredGreen.filter((run) => run.name !== 'Deploy Cloud Functions'),
            { name: 'Deploy Cloud Functions', status, conclusion: null },
        ];

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('refuses when a required check failed', async () => {
        githubState.checkRuns = [
            ...allRequiredGreen.filter((run) => run.name !== 'Verify the release is fully validated'),
            { name: 'Verify the release is fully validated', status: 'completed', conclusion: 'failure' },
        ];

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('refuses when there is no Testing release at all', async () => {
        githubState.deployments = { testing: [], production: [] };

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(auditRecords()).toContainEqual(expect.objectContaining({ reason: 'no-candidate' }));
    });

    it('refuses when the Testing deployment itself failed', async () => {
        githubState.statuses[101] = ['failure'];

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('is a safe no-op when production already serves the release', async () => {
        githubState.deployments.production = [
            { id: 900, sha: SHA_TESTED, created_at: '2026-08-07T11:30:00Z', payload: { appVersionId: 'ver-app-101' } },
        ];
        githubState.statuses[900] = ['success'];

        const result = await releaseManagement.promoteTestingToProduction(request(superAdmin()));

        expect(result).toEqual({ status: 'already-live', sha: SHA_TESTED, requestId: null });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------

describe('concurrency', () => {
    it('refuses while GitHub reports a release already running', async () => {
        github.findRunningPromotion.mockResolvedValue({ runId: '55', status: 'in_progress' });

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'aborted' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('refuses a second promotion while the local lock is held', async () => {
        mock.docs.set('release_promotion_locks/current', {
            requestId: 'in-flight',
            sha: SHA_TESTED,
            takenAt: { toMillis: () => Date.now() },
        });

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'aborted' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('treats a lock with an unreadable timestamp as held, not as free', async () => {
        mock.docs.set('release_promotion_locks/current', { requestId: 'unknown-age' });

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'aborted' });
    });

    it('lets a release proceed once an expired lock has aged out', async () => {
        mock.docs.set('release_promotion_locks/current', {
            requestId: 'abandoned',
            takenAt: { toMillis: () => Date.now() - (60 * 60 * 1000) },
        });

        const result = await releaseManagement.promoteTestingToProduction(request(superAdmin()));
        expect(result.status).toBe('dispatched');
    });
});

// ---------------------------------------------------------------------------

describe('dispatch failure', () => {
    it('reports a safe error, releases the lock and records the failure', async () => {
        const { GithubRequestError } = github;
        github.dispatchPromotion.mockRejectedValue(new GithubRequestError('boom', 503));

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'unavailable' });

        expect(mock.docs.has('release_promotion_locks/current')).toBe(false);
        expect(auditRecords()).toContainEqual(expect.objectContaining({
            result: 'failed', reason: 'dispatch-failed', releaseSha: SHA_TESTED,
        }));
    });

    it('never echoes the underlying GitHub message to the caller', async () => {
        const { GithubRequestError } = github;
        github.dispatchPromotion.mockRejectedValue(
            new GithubRequestError('Bad credentials for token ghs_ARTIFICIAL', 401),
        );

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({
                code: 'unavailable',
                message: expect.not.stringContaining('ghs_ARTIFICIAL'),
            });
    });
});
