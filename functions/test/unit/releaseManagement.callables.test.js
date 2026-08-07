/**
 * Behaviour contract for the Super Admin Release Management callables.
 *
 * These prove the properties the feature exists to guarantee. Every one of them
 * is a way the wrong code could reach app.safehaul.io, or a way a credential
 * could leave the server:
 *
 *  - authorization is exactly `globalRole === 'super_admin'` — an ordinary user
 *    and a company admin are rejected, not degraded;
 *  - promoting additionally requires recent authentication;
 *  - THE BROWSER CANNOT NAME THE RELEASE. A SHA in the request payload changes
 *    nothing about what is promoted;
 *  - a release whose shared-backend rollout is unconfirmed is refused;
 *  - a release whose required checks are queued, running, red or absent is
 *    refused;
 *  - a candidate that changed between the confirmation dialog and the request is
 *    refused rather than silently promoted;
 *  - a repeat promotion of the live release is a no-op, and a concurrent one is
 *    refused;
 *  - a failed dispatch leaves the system releasable rather than wedged;
 *  - every outcome writes a value-free audit record;
 *  - no response from any of these callables contains the release credential.
 *
 * The eligibility rules themselves are NOT re-implemented here: the real
 * `eligibility.js` runs against a fake GitHub REST surface, so these tests
 * exercise the same gate the release runner does.
 *
 * All SHAs, ids and email addresses below are artificial.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({
    admin: mock.admin,
    db: mock.db,
    auth: mock.admin.auth(),
    storage: {},
}));

// The GitHub transport is mocked; the eligibility RULES are real.
jest.mock('../../releaseManagement/github', () => ({
    SECRET_NAMES: ['RELEASE_GITHUB_APP_ID', 'RELEASE_GITHUB_INSTALLATION_ID', 'RELEASE_GITHUB_PRIVATE_KEY'],
    GithubRequestError: class GithubRequestError extends Error {
        constructor(message, status) { super(message); this.status = status; }
    },
    isCredentialConfigured: jest.fn(() => true),
    createReleaseApi: jest.fn(() => (path) => githubState.api(path)),
    dispatchPromotion: jest.fn(async () => null),
    listPromotionRuns: jest.fn(async () => []),
    selectPromotionRun: jest.fn(() => null),
    selectRunningPromotion: jest.fn(() => null),
    findRunningPromotion: jest.fn(async () => null),
}));

const github = require('../../releaseManagement/github');
const { REQUIRED_RELEASE_CHECKS } = require('../../releaseManagement/eligibility');
const releaseManagement = require('../../releaseManagement');
const { AUDIT_COLLECTION } = require('../../environmentVault/audit');

const SHA_TESTED = 'a'.repeat(40);
const SHA_LIVE = 'b'.repeat(40);
const SHA_OLDER = 'c'.repeat(40);
const SHA_ATTACKER = 'f'.repeat(40);

const allRequiredGreen = REQUIRED_RELEASE_CHECKS.map((name) => ({
    name, status: 'completed', conclusion: 'success',
}));

/**
 * A mutable fake GitHub. Each test reshapes it to describe one release world;
 * the real resolver reads it exactly as it reads the live API.
 */
const githubState = {
    deployments: {},
    statuses: {},
    // Filled by `healthyWorld()` in beforeEach. Left empty here because the
    // jest.mock factory above is hoisted and closes over this object before the
    // module-level constants below have initialised.
    checkRuns: [],
    api(path) {
        const statusMatch = path.match(/^\/deployments\/(\d+)\/statuses/);
        if (statusMatch) {
            return (this.statuses[statusMatch[1]] || []).map((state) => ({ state }));
        }
        if (path.startsWith('/commits/')) return { check_runs: this.checkRuns };
        const env = path.match(/environment=([a-z]+)/)?.[1];
        const sha = path.match(/sha=([0-9a-f]+)/)?.[1];
        const pool = this.deployments[env] || [];
        return sha ? pool.filter((d) => d.sha === sha) : pool;
    },
};

/** The default world: one confirmed, fully green Testing release, no production. */
function healthyWorld() {
    githubState.deployments = {
        testing: [{
            id: 101,
            sha: SHA_TESTED,
            created_at: '2026-08-07T11:00:49Z',
            payload: { appVersionId: 'ver-app-101', landingVersionId: 'ver-landing-101' },
        }],
        production: [],
    };
    githubState.statuses = { 101: ['success'] };
    githubState.checkRuns = allRequiredGreen;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

const superAdmin = (overrides = {}) => ({
    uid: 'super-1',
    token: { globalRole: 'super_admin', email: 'ops@example.test', auth_time: nowSeconds(), ...overrides },
});

const request = (auth, data = {}) => ({ auth, data });

const auditRecords = () => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith(`${AUDIT_COLLECTION}/`))
    .map(([, data]) => data);

beforeEach(() => {
    mock.reset({});
    healthyWorld();
    github.isCredentialConfigured.mockReturnValue(true);
    github.dispatchPromotion.mockResolvedValue(null);
    github.listPromotionRuns.mockResolvedValue([]);
    github.selectPromotionRun.mockReturnValue(null);
    github.selectRunningPromotion.mockReturnValue(null);
    github.findRunningPromotion.mockResolvedValue(null);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
});

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
            ...allRequiredGreen.filter((run) => run.name !== 'frontend-quality'),
            { name: 'frontend-quality', status: 'completed', conclusion: 'failure' },
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
