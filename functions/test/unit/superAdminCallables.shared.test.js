/**
 * The super-admin-only maintenance callables (Data cleanup's email-settings
 * migration and search-fields backfill, Analytics' stats rebuild) ask the
 * shared `assertSuperAdminAuth` on the verified token: no Auth API read per
 * call, the same two claims the rules read, and each its own refusal sentence.
 * All ids are artificial.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

const mockGetUser = jest.fn();
jest.mock('../../firebaseAdmin', () => {
    const empty = { empty: true, size: 0, docs: [] };
    const query = {
        where: () => query, orderBy: () => query, limit: () => query, startAfter: () => query, select: () => query,
        doc: () => ({ collection: () => query }), get: async () => empty,
    };
    return {
        db: { collection: () => query, collectionGroup: () => query, batch: () => ({ set: jest.fn(), commit: jest.fn() }) },
        admin: {
            auth: () => ({ getUser: (...args) => mockGetUser(...args) }),
            firestore: { FieldPath: { documentId: () => '__id__' }, FieldValue: { serverTimestamp: () => '__ts' } },
        },
    };
});
jest.mock('../../integrations/encryption', () => ({ decrypt: jest.fn() }));
jest.mock('../../shared/smtpSettings', () => ({ sealPassword: jest.fn() }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn(async () => true) }));

const { migrateEmailSettings } = require('../../migrateEmailSettings');
const { backfillCompanyStats, backfillAllStats } = require('../../statsBackfill');
const { backfillApplicationSearchFields } = require('../../searchFieldsBackfill');

const CALLABLES = [
    ['migrateEmailSettings', migrateEmailSettings, {}, 'Only super admins can run migrations.'],
    ['backfillCompanyStats', backfillCompanyStats, { companyId: 'co-1' }, 'Super admin access required.'],
    ['backfillAllStats', backfillAllStats, {}, 'Super admin access required.'],
    ['backfillApplicationSearchFields', backfillApplicationSearchFields, { companyId: 'co-1' }, 'Only Super Admins can run backfills.'],
];

beforeEach(() => mockGetUser.mockReset());

describe.each(CALLABLES)('%s', (_name, callable, data, denied) => {
    it('refuses a caller who is not signed in', async () => {
        await expect(callable({ data })).rejects.toMatchObject({ code: 'unauthenticated', message: 'Login required.' });
    });

    it.each([
        ['a company admin', { roles: { 'co-1': 'company_admin' } }],
        ['a recruiter', { roles: { 'co-1': 'recruiter' } }],
        ['no claims', {}],
    ])('refuses %s with its own sentence', async (_who, token) => {
        await expect(callable({ auth: { uid: 'u1', token }, data })).rejects.toMatchObject({ code: 'permission-denied', message: denied });
    });

    it.each([
        ['under roles', { roles: { globalRole: 'super_admin' } }],
        ['at the token root', { globalRole: 'super_admin' }],
    ])('lets a super admin through by the claim %s, reading no Auth record', async (_where, token) => {
        await expect(callable({ auth: { uid: 'super-1', token }, data })).resolves.toBeDefined();
        expect(mockGetUser).not.toHaveBeenCalled();
    });
});
