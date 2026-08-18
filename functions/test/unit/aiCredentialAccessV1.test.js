/**
 * The 1st generation half of the credential-access diagnosis.
 *
 * It exists because 1st and 2nd generation functions default to *different*
 * runtime service accounts, so a Secret Manager grant can fix some AI entry
 * points and not others. One answer proves nothing; the pair is the diagnosis.
 *
 * Two things are worth pinning here. The shared guards throw the 2nd generation
 * `HttpsError`, which the 1st generation wrapper does not recognise — so without
 * translation "you are not a super admin" and "slow down" would both reach the
 * browser as a bare `internal`. And the report must carry the generation, or the
 * console cannot tell the two answers apart.
 */

process.env.FIREBASE_PROJECT_ID = 'truckerapp-system';

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'ts', delete: () => 'del' } } },
    db: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }), add: async () => {} }) },
}));

jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn().mockResolvedValue(true) }));

const mockAudit = [];
jest.mock('../../environmentVault/audit', () => {
    const actual = jest.requireActual('../../environmentVault/audit');
    return {
        ...actual,
        recordAuditEvent: async (event) => { mockAudit.push(event); },
    };
});

const mockReport = { generation: 'v1', providers: [], unreadableCount: 0 };
jest.mock('../../ai/tasks/credentialAccess', () => ({
    diagnoseCredentialAccess: jest.fn(async (options) => ({ ...mockReport, generation: options.generation })),
}));

const functionsV1 = require('firebase-functions/v1');
const { diagnoseAiCredentialAccessV1, __private } = require('../../ai/callablesV1');
const { checkRateLimit } = require('../../shared/rateLimiter');

const NOW = Math.floor(Date.now() / 1000);
const SUPER_ADMIN = { uid: 'sa1', token: { globalRole: 'super_admin', auth_time: NOW } };

/** v1 callables are invoked as (data, context), with auth nested on context. */
function invoke(auth, data = {}) {
    return diagnoseAiCredentialAccessV1.run(data, { auth });
}

beforeEach(() => {
    mockAudit.length = 0;
    checkRateLimit.mockResolvedValue(true);
});

describe('the 1st generation credential access check', () => {
    it('answers a super admin, naming its own generation', async () => {
        const report = await invoke(SUPER_ADMIN);

        expect(report.generation).toBe('v1');
        expect(mockAudit[0].metadata).toMatchObject({
            integration: 'AI credential access',
            setting: 'gen1',
        });
    });

    it('denies a company admin with a code the browser can read', async () => {
        const error = await invoke({
            uid: 'u2', token: { roles: { 'company-1': 'company_admin' }, auth_time: NOW },
        }).catch((err) => err);

        // A 2nd generation HttpsError reaching the 1st generation wrapper would
        // be flattened to `internal`, which is how a permission problem becomes
        // indistinguishable from a bug.
        expect(error).toBeInstanceOf(functionsV1.https.HttpsError);
        expect(error.code).toBe('permission-denied');
    });

    it('denies an unauthenticated caller', async () => {
        const error = await invoke(undefined).catch((err) => err);

        expect(error).toBeInstanceOf(functionsV1.https.HttpsError);
        expect(error.code).toBe('unauthenticated');
    });

    it('reports a rate limit as a rate limit', async () => {
        checkRateLimit.mockResolvedValue(false);

        const error = await invoke(SUPER_ADMIN).catch((err) => err);

        expect(error).toBeInstanceOf(functionsV1.https.HttpsError);
        expect(error.code).toBe('resource-exhausted');
    });
});

describe('error translation', () => {
    it('preserves a recognisable code and hides anything else', () => {
        const { asV1Error } = __private;

        const translated = asV1Error({ code: 'permission-denied', message: 'Super Admin access is required.' });
        expect(translated).toBeInstanceOf(functionsV1.https.HttpsError);
        expect(translated.code).toBe('permission-denied');

        // An unexpected failure must not leak its message to a browser.
        const opaque = asV1Error(new Error('ECONNREFUSED 10.0.0.1:443 while reading secrets'));
        expect(opaque.code).toBe('internal');
        expect(opaque.message).not.toMatch(/ECONNREFUSED/);
    });
});
