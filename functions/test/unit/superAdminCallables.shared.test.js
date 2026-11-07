/**
 * Analytics' stats rebuild is for super admins only, read from the Auth record
 * on every call, not from the token: a super admin whose role was removed is
 * refused on the next call (К4). All ids are artificial.
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
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn(async () => true) }));

const { backfillCompanyStats, backfillAllStats } = require('../../statsBackfill');

const CALLABLES = [
    ['backfillCompanyStats', backfillCompanyStats, { companyId: 'co-1' }, 'Super admin access required.'],
    ['backfillAllStats', backfillAllStats, {}, 'Super admin access required.'],
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
    ])('refuses %s, by the Auth record', async (_who, claims) => {
        mockGetUser.mockResolvedValue({ customClaims: claims });
        await expect(callable({ auth: { uid: 'u1', token: {} }, data })).rejects.toMatchObject({ code: 'permission-denied', message: denied });
    });

    it('refuses a super admin whose role was removed, though the token still says super admin', async () => {
        mockGetUser.mockResolvedValue({ customClaims: {} });
        await expect(callable({ auth: { uid: 'u1', token: { globalRole: 'super_admin' } }, data }))
            .rejects.toMatchObject({ code: 'permission-denied', message: denied });
        expect(mockGetUser).toHaveBeenCalledWith('u1');
    });

    it.each([
        ['under roles', { roles: { globalRole: 'super_admin' } }],
        ['at the root', { globalRole: 'super_admin' }],
    ])('lets a super admin through by the Auth record\'s claim %s', async (_where, claims) => {
        mockGetUser.mockResolvedValue({ customClaims: claims });
        await expect(callable({ auth: { uid: 'super-1', token: {} }, data })).resolves.toBeDefined();
        expect(mockGetUser).toHaveBeenCalledWith('super-1');
    });
});
