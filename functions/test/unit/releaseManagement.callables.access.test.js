/**
 * Who may promote a release, and why the browser is not allowed to name one.
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
const releaseManagement = require('../../releaseManagement');
const {
    githubState, nowSeconds, superAdmin, request, auditRecords, resetReleaseState,
    restoreReleaseState, SHA_TESTED, SHA_LIVE, SHA_ATTACKER,
} = require('./releaseManagement.callables.support');

beforeEach(resetReleaseState);
afterEach(restoreReleaseState);

// ---------------------------------------------------------------------------

describe('authorization', () => {
    const callables = [
        ['getReleaseStatus', {}],
        ['promoteTestingToProduction', {}],
        ['rollbackProductionRelease', {}],
    ];

    it.each(callables)('%s rejects unauthenticated callers', async (name, data) => {
        await expect(releaseManagement[name](request(null, data)))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it.each(callables)('%s rejects an ordinary signed-in user', async (name, data) => {
        const auth = { uid: 'user-1', token: { auth_time: nowSeconds() } };
        await expect(releaseManagement[name](request(auth, data)))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it.each(callables)('%s rejects a company admin', async (name, data) => {
        const auth = { uid: 'admin-1', token: { roles: { 'co-alpha': 'company_admin' }, auth_time: nowSeconds() } };
        await expect(releaseManagement[name](request(auth, data)))
            .rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('rejects a caller claiming super_admin only in the request payload', async () => {
        const auth = { uid: 'user-2', token: { auth_time: nowSeconds() } };
        await expect(releaseManagement.promoteTestingToProduction(
            request(auth, { isSuperAdmin: true, globalRole: 'super_admin' }),
        )).rejects.toMatchObject({ code: 'permission-denied' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('refuses to promote on a stale session', async () => {
        const auth = superAdmin({ auth_time: nowSeconds() - 3600 });
        await expect(releaseManagement.promoteTestingToProduction(request(auth)))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('does not require recent authentication merely to read the status', async () => {
        const auth = superAdmin({ auth_time: nowSeconds() - 3600 });
        const result = await releaseManagement.getReleaseStatus(request(auth));
        expect(result.testing.sha).toBe(SHA_TESTED);
    });

    it('records a denial in the audit trail', async () => {
        const auth = { uid: 'admin-1', token: { roles: { 'co-alpha': 'company_admin' }, auth_time: nowSeconds() } };
        await expect(releaseManagement.promoteTestingToProduction(request(auth))).rejects.toThrow();
        expect(auditRecords()).toEqual([expect.objectContaining({
            result: 'denied', reason: 'not-super-admin', actorUid: 'admin-1',
        })]);
    });
});

// ---------------------------------------------------------------------------

describe('the browser cannot name the release', () => {
    it('ignores a SHA supplied in the request payload', async () => {
        await releaseManagement.promoteTestingToProduction(
            request(superAdmin(), { sha: SHA_ATTACKER, candidateSha: SHA_ATTACKER, releaseSha: SHA_ATTACKER }),
        );

        expect(github.dispatchPromotion).toHaveBeenCalledTimes(1);
        expect(github.dispatchPromotion.mock.calls[0][0].sha).toBe(SHA_TESTED);
    });

    it('refuses when expectedSha names a release the server did not resolve', async () => {
        await expect(releaseManagement.promoteTestingToProduction(
            request(superAdmin(), { expectedSha: SHA_ATTACKER }),
        )).rejects.toMatchObject({ code: 'failed-precondition' });

        expect(github.dispatchPromotion).not.toHaveBeenCalled();
        expect(auditRecords()).toContainEqual(expect.objectContaining({
            result: 'denied', reason: 'candidate-changed',
        }));
    });

    it('refuses when the tested release changed after the confirmation dialog', async () => {
        // The operator confirmed SHA_TESTED; a newer release landed first.
        const newer = {
            id: 202,
            sha: SHA_LIVE,
            created_at: '2026-08-07T12:00:00Z',
            payload: { appVersionId: 'ver-app-202', landingVersionId: 'ver-landing-202' },
        };
        githubState.deployments.testing = [newer, ...githubState.deployments.testing];
        githubState.statuses[202] = ['success'];

        await expect(releaseManagement.promoteTestingToProduction(
            request(superAdmin(), { expectedSha: SHA_TESTED }),
        )).rejects.toMatchObject({ code: 'failed-precondition' });

        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });
});
