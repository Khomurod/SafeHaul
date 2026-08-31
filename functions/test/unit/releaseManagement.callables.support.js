/**
 * Shared harness for the `releaseManagement.callables.*` suites.
 *
 * The GitHub transport is mocked; the eligibility **rules** are real, which is
 * the point of these suites.
 *
 * `jest.mock` is hoisted per file and cannot be registered from here, so each
 * suite keeps its own one-line registration and the factory bodies live below.
 * `firebaseAdminMock()` and `githubMock()` close over the singletons built at
 * this module's scope, so the store and the fake GitHub a suite imports are the
 * ones the callables are talking to.
 *
 * No suite here queues a `*Once` value and none calls `jest.resetModules()`
 * (both checked before the split). `resetReleaseState` and `restoreReleaseState`
 * are the original `beforeEach` and `afterEach` bodies, unchanged.
 */

const { createFirestoreMock } = require('../helpers/firestoreMock');
const mock = createFirestoreMock();

const SHA_TESTED = 'a'.repeat(40);
const SHA_LIVE = 'b'.repeat(40);
const SHA_OLDER = 'c'.repeat(40);
const SHA_ATTACKER = 'f'.repeat(40);

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
    // Required lazily for the reason the comment above records: the mock factory
    // is hoisted and closes over `githubState` before this module's constants
    // have initialised, so the eligibility rules cannot be read at module scope.
    const { REQUIRED_RELEASE_CHECKS } = require('../../releaseManagement/eligibility');
    const allRequiredGreen = REQUIRED_RELEASE_CHECKS.map((name) => ({
        name, status: 'completed', conclusion: 'success',
    }));
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

const httpsMock = () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
});

const firebaseAdminMock = () => ({
    admin: mock.admin,
    db: mock.db,
    auth: mock.admin.auth(),
    storage: {},
});

// The GitHub transport is mocked; the eligibility RULES are real.
const githubMock = () => ({
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
});

const nowSeconds = () => Math.floor(Date.now() / 1000);

const superAdmin = (overrides = {}) => ({
    uid: 'super-1',
    token: { globalRole: 'super_admin', email: 'ops@example.test', auth_time: nowSeconds(), ...overrides },
});

const request = (auth, data = {}) => ({ auth, data });

/** Every audit document currently in the store. */
const auditRecords = () => {
    const { AUDIT_COLLECTION } = require('../../environmentVault/audit');
    return [...mock.docs.entries()]
        .filter(([path]) => path.startsWith(`${AUDIT_COLLECTION}/`))
        .map(([, data]) => data);
};

/** The original `beforeEach` body, unchanged. */
function resetReleaseState() {
    const github = require('../../releaseManagement/github');
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
}

/** The original `afterEach` body, unchanged. */
function restoreReleaseState() {
    jest.clearAllMocks();
    jest.restoreAllMocks();
}

module.exports = {
    httpsMock,
    firebaseAdminMock,
    githubMock,
    mock,
    githubState,
    healthyWorld,
    nowSeconds,
    superAdmin,
    request,
    auditRecords,
    resetReleaseState,
    restoreReleaseState,
    SHA_TESTED,
    SHA_LIVE,
    SHA_OLDER,
    SHA_ATTACKER,
};
