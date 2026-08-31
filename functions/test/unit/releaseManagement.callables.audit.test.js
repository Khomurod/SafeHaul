/**
 * The audit record, rollback, and the status the console reads.
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
    restoreReleaseState, SHA_TESTED, SHA_LIVE, SHA_OLDER, SHA_ATTACKER,
} = require('./releaseManagement.callables.support');

const allRequiredGreen = REQUIRED_RELEASE_CHECKS.map((name) => ({
    name, status: 'completed', conclusion: 'success',
}));

beforeEach(resetReleaseState);
afterEach(restoreReleaseState);

// ---------------------------------------------------------------------------

describe('audit', () => {
    it('records who promoted what, without any credential', async () => {
        const result = await releaseManagement.promoteTestingToProduction(request(superAdmin()));

        const promotion = auditRecords().find((record) => record.action === 'promote' && record.result === 'success');
        expect(promotion).toMatchObject({
            actorUid: 'super-1',
            actorEmail: 'ops@example.test',
            releaseSha: SHA_TESTED,
            appVersionId: 'ver-app-101',
            requestId: result.requestId,
            channel: 'production',
        });

        const serialised = JSON.stringify(auditRecords());
        expect(serialised).not.toMatch(/PRIVATE KEY/);
        expect(serialised).not.toMatch(/ghs_|ghp_|github_pat_/);
    });

    it('records a finished release once, however many times the screen polls', async () => {
        const { requestId, sha } = await releaseManagement.promoteTestingToProduction(request(superAdmin()));

        // The run has finished. The Release Management screen keeps polling.
        github.selectPromotionRun.mockReturnValue({
            runId: '77', status: 'completed', conclusion: 'success', htmlUrl: 'https://example.test/run/77',
        });

        await releaseManagement.getReleaseStatus(request(superAdmin()));
        await releaseManagement.getReleaseStatus(request(superAdmin()));
        await releaseManagement.getReleaseStatus(request(superAdmin()));

        const outcomes = auditRecords().filter((record) => record.reason === 'promotion-success');
        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]).toMatchObject({ requestId, releaseSha: sha, runId: '77' });

        // Scope of this assertion: it proves the `outcomeRecorded` claim flag
        // works across REPEATED reads, which is the case that actually happens
        // (a screen polling every few seconds after a release finishes). It does
        // NOT prove behaviour under genuinely simultaneous reads — the Firestore
        // double here runs transaction bodies without isolation or retry, so it
        // cannot model that. Simultaneity is handled by real Firestore
        // transaction semantics, which is why the claim is taken inside
        // `runTransaction` rather than by a read followed by a write.
    });

    it('releases the lock as soon as a release finishes, so a retry is not blocked', async () => {
        await releaseManagement.promoteTestingToProduction(request(superAdmin()));
        expect(mock.docs.has('release_promotion_locks/current')).toBe(true);

        github.selectPromotionRun.mockReturnValue({
            runId: '78', status: 'completed', conclusion: 'failure', htmlUrl: 'https://example.test/run/78',
        });
        await releaseManagement.getReleaseStatus(request(superAdmin()));

        expect(mock.docs.has('release_promotion_locks/current')).toBe(false);
    });

    it('records the previous production release alongside the new one', async () => {
        githubState.deployments.production = [
            { id: 900, sha: SHA_LIVE, created_at: '2026-08-06T10:00:00Z', payload: { appVersionId: 'ver-app-900' } },
        ];
        githubState.statuses[900] = ['success'];

        await releaseManagement.promoteTestingToProduction(request(superAdmin()));

        expect(auditRecords()).toContainEqual(expect.objectContaining({
            result: 'success', releaseSha: SHA_TESTED, previousSha: SHA_LIVE,
        }));
    });
});

// ---------------------------------------------------------------------------

describe('rollback', () => {
    beforeEach(() => {
        githubState.deployments.production = [
            { id: 900, sha: SHA_LIVE, created_at: '2026-08-06T10:00:00Z', payload: { appVersionId: 'ver-app-900' } },
            { id: 899, sha: SHA_OLDER, created_at: '2026-08-05T10:00:00Z', payload: { appVersionId: 'ver-app-899' } },
        ];
        githubState.statuses[900] = ['success'];
        githubState.statuses[899] = ['success'];
        githubState.deployments.testing.push({
            id: 55,
            sha: SHA_OLDER,
            created_at: '2026-08-05T09:00:00Z',
            payload: { appVersionId: 'ver-app-899', landingVersionId: 'ver-landing-899' },
        });
        githubState.statuses[55] = ['success'];
    });

    it('rolls back to the previous production release chosen by the server', async () => {
        const result = await releaseManagement.rollbackProductionRelease(
            request(superAdmin(), { expectedSha: SHA_OLDER }),
        );

        expect(result.sha).toBe(SHA_OLDER);
        expect(github.dispatchPromotion.mock.calls[0][0].sha).toBe(SHA_OLDER);
    });

    it('ignores a rollback target supplied by the client', async () => {
        await releaseManagement.rollbackProductionRelease(
            request(superAdmin(), { sha: SHA_ATTACKER, targetSha: SHA_ATTACKER }),
        );

        expect(github.dispatchPromotion.mock.calls[0][0].sha).toBe(SHA_OLDER);
    });

    it('refuses when there is no previous release on record', async () => {
        githubState.deployments.production = [
            { id: 900, sha: SHA_LIVE, created_at: '2026-08-06T10:00:00Z', payload: { appVersionId: 'ver-app-900' } },
        ];

        await expect(releaseManagement.rollbackProductionRelease(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });
});

// ---------------------------------------------------------------------------

describe('release status', () => {
    it('returns only public release identifiers', async () => {
        githubState.deployments.production = [
            { id: 900, sha: SHA_LIVE, created_at: '2026-08-06T10:00:00Z', payload: { appVersionId: 'ver-app-900' } },
        ];
        githubState.statuses[900] = ['success'];

        const result = await releaseManagement.getReleaseStatus(request(superAdmin()));

        expect(result.testing).toMatchObject({ sha: SHA_TESTED, eligible: true, backendReleased: true });
        expect(result.production).toMatchObject({ sha: SHA_LIVE });

        // Nothing resembling a credential may appear anywhere in the payload.
        const serialised = JSON.stringify(result);
        expect(serialised).not.toMatch(/PRIVATE KEY/);
        expect(serialised).not.toMatch(/ghs_|ghp_|github_pat_/);
        expect(serialised).not.toMatch(/RELEASE_GITHUB/);
    });

    it('explains why an unfinished release is not promotable', async () => {
        githubState.statuses[101] = ['in_progress'];
        githubState.checkRuns = [
            ...allRequiredGreen.filter((run) => run.name !== 'Deploy Cloud Functions'),
            { name: 'Deploy Cloud Functions', status: 'in_progress', conclusion: null },
        ];

        const result = await releaseManagement.getReleaseStatus(request(superAdmin()));

        expect(result.testing.eligible).toBe(false);
        expect(result.testing.blockers.length).toBeGreaterThanOrEqual(2);
    });

    it('reports honestly when the release credential is not configured', async () => {
        github.isCredentialConfigured.mockReturnValue(false);

        const result = await releaseManagement.getReleaseStatus(request(superAdmin()));

        expect(result.configured).toBe(false);
        expect(result.testing).toBeNull();
        expect(result.message).toEqual(expect.any(String));
    });

    it('refuses to promote when the release credential is not configured', async () => {
        github.isCredentialConfigured.mockReturnValue(false);

        await expect(releaseManagement.promoteTestingToProduction(request(superAdmin())))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(github.dispatchPromotion).not.toHaveBeenCalled();
    });

    it('ignores foreign deployments that share the production environment name', async () => {
        // This repository's Production environment carries a long tail of
        // Vercel-created records with empty payloads and unrelated SHAs.
        githubState.deployments.production = [
            { id: 998, sha: SHA_ATTACKER, created_at: '2026-08-07T09:00:00Z', payload: {} },
            { id: 900, sha: SHA_LIVE, created_at: '2026-08-06T10:00:00Z', payload: { appVersionId: 'ver-app-900' } },
        ];
        githubState.statuses[998] = ['success'];
        githubState.statuses[900] = ['success'];

        const result = await releaseManagement.getReleaseStatus(request(superAdmin()));
        expect(result.production.sha).toBe(SHA_LIVE);
    });
});
