/**
 * Tenant binding for `connectFacebookPage`.
 *
 * Until 2026-08-25 this callable did:
 *
 *     const companyId = request.auth.uid; // Assumes 1:1 user-company mapping
 *
 * SafeHaul has never worked that way. Companies carry generated ids and users
 * join them through `memberships`; a user can belong to several, which is why
 * there is a company chooser. So every page connected through this callable
 * wrote `integrations_index/{pageId}.companyId = <a user id>`, and every lead
 * the webhook later ingested went to `companies/{uid}/leads` — a tree belonging
 * to no company, which no screen reads. The leads were not delivered to the
 * wrong tenant; they were silently dropped into nowhere.
 *
 * The caller now names the company and the server authorizes it. These tests
 * cover the full matrix, because the failure mode of getting this wrong the
 * *other* way — trusting a client-supplied id — is worse than the bug being
 * fixed: it would plant one company's leads in another's tenant.
 *
 * All ids and tokens below are artificial.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    onRequest: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('firebase-functions', () => ({ https: { onRequest: jest.fn((fn) => fn) } }));
jest.mock('firebase-functions/params', () => ({
    defineSecret: () => ({ value: () => 'artificial-secret' }),
}));

// The shared admin assertion is mocked, matching `deleteApplication.test.js` and
// `applicationChanges.test.js`. What is pinned here is the property this fix is
// about: the company that gets AUTHORIZED is the company that gets BOUND. The
// helper's own role logic is its business, not this callable's.
const mockAssertCompanyAdminStrict = jest.fn().mockResolvedValue(undefined);
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAdminStrict: (...a) => mockAssertCompanyAdminStrict(...a),
}));

const mockWrites = [];
// What `integrations_index/{pageId}` already holds, per test. `null` = unclaimed.
// `mock`-prefixed because Jest only lets a mock factory close over such names.
let mockExistingBinding = null;
// Ids that have a real `companies/{id}` document.
let mockRealCompanies = [];
jest.mock('firebase-admin', () => {
    const writes = mockWrites;
    const makeDoc = (path) => ({
        set: jest.fn(async (data) => { writes.push({ path, data }); }),
        get: jest.fn(async () => {
            if (path.startsWith('integrations_index/') && mockExistingBinding) {
                return { exists: true, data: () => mockExistingBinding };
            }
            // Whether a `companies/{id}` doc exists is the whole difference
            // between "another company holds this page" and "this is a stale uid
            // binding from the old code" — so the mock has to model it.
            if (path.startsWith('companies/')) {
                return { exists: mockRealCompanies.includes(path.split('/')[1]), data: () => ({}) };
            }
            return { exists: false, data: () => ({}) };
        }),
        collection: (name) => makeCol(`${path}/${name}`),
    });
    const makeCol = (path) => ({ doc: (id) => makeDoc(`${path}/${id ?? 'auto'}`), add: jest.fn() });
    return {
        firestore: Object.assign(
            () => ({ collection: (name) => makeCol(name) }),
            { FieldValue: { serverTimestamp: () => '__ts' } },
        ),
        storage: () => ({}),
    };
});

// No network. The Graph API calls only run once authorization has passed, so
// an authorization test never reaches them; the one test that does get through
// asserts on what was written rather than on the HTTP traffic.
jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
const axios = require('axios');

const { HttpsError } = require('firebase-functions/v2/https');
const { connectFacebookPage } = require('../../integrations/facebook');

const COMPANY = 'artificial-company-id';
const OTHER_COMPANY = 'artificial-other-company-id';
const CALLER_UID = 'artificial-user-uid';

const call = (token, data = {}) => connectFacebookPage({
    auth: { uid: CALLER_UID, token },
    data: {
        shortLivedUserToken: 'artificial-short-lived-token',
        pageId: 'artificial-page-id',
        pageName: 'Artificial Page',
        companyId: COMPANY,
        ...data,
    },
});

beforeEach(() => {
    mockWrites.length = 0;
    mockAssertCompanyAdminStrict.mockReset().mockResolvedValue(undefined);
    mockExistingBinding = null;
    mockRealCompanies = [COMPANY, OTHER_COMPANY];
    // Re-armed per test: `mockResolvedValueOnce` is consumed, so a shared chain
    // would give the first test real tokens and every later one `undefined`.
    axios.get.mockReset()
        .mockResolvedValueOnce({ data: { access_token: 'artificial-long-lived-user-token' } })
        .mockResolvedValueOnce({ data: { access_token: 'artificial-page-token' } });
    axios.post.mockReset().mockResolvedValue({ data: {} });
});

describe('connectFacebookPage authorization', () => {
    it('rejects an unauthenticated caller', async () => {
        await expect(connectFacebookPage({ data: {} }))
            .rejects.toThrow(/logged in/i);
    });

    it('authorizes against the company the caller named, not their uid', async () => {
        // The inverse of the bug. `request.auth.uid` must never be what decides
        // the tenant, and the id that was authorized must be the id that is bound.
        await call({ roles: { [COMPANY]: 'company_admin' } });

        expect(mockAssertCompanyAdminStrict).toHaveBeenCalledWith(CALLER_UID, COMPANY);
        const write = mockWrites.find((w) => w.path.startsWith('integrations_index/'));
        expect(write.data.companyId).toBe(COMPANY);
        expect(write.data.companyId).not.toBe(CALLER_UID);
    });

    it('writes nothing when the shared assertion rejects', async () => {
        mockAssertCompanyAdminStrict.mockRejectedValue(
            new HttpsError('permission-denied', 'You do not have access to this company.'),
        );

        await expect(call({ roles: {} })).rejects.toThrow(/do not have access/i);
        expect(mockWrites).toHaveLength(0);
    });

    it('propagates the assertion\'s own error instead of flattening it', async () => {
        // The catch-all in this callable used to turn every failure into
        // "Failed to connect Facebook Page", which tells an admin nothing.
        mockAssertCompanyAdminStrict.mockRejectedValue(
            new HttpsError('invalid-argument', 'companyId is required.'),
        );

        await expect(call({ roles: {} }, { companyId: undefined }))
            .rejects.toThrow(/companyId is required/i);
    });

    /*
     * A page belongs to one company, and this matters MORE after the tenant fix
     * than before it. `.set()` on `integrations_index/{pageId}` has always
     * overwritten unconditionally; while the stored value was a uid, a rebind
     * just moved the page to another tree nobody reads. Now the value is a real
     * company, so an unguarded rebind would redirect a live lead feed from one
     * tenant into another.
     */
    it('refuses to steal a page already connected to another company', async () => {
        mockExistingBinding = { companyId: OTHER_COMPANY, pageName: 'Artificial Page' };

        await expect(call({ roles: { [COMPANY]: 'company_admin' } }))
            .rejects.toThrow(/already connected to another company/i);
        expect(mockWrites).toHaveLength(0);
    });

    it('reclaims a page left bound to a uid by the old code', async () => {
        // The recovery path. Without it, every page connected before the fix
        // would be permanently unreconnectable by the company that owns it.
        mockExistingBinding = { companyId: CALLER_UID, pageName: 'Artificial Page' };

        await call({ roles: { [COMPANY]: 'company_admin' } });
        const write = mockWrites.find((w) => w.path.startsWith('integrations_index/'));
        expect(write.data.companyId).toBe(COMPANY);
    });

    it('allows the owning company to reconnect its own page', async () => {
        // The ordinary token-refresh path; it must keep working.
        mockExistingBinding = { companyId: COMPANY, pageName: 'Artificial Page' };

        await call({ roles: { [COMPANY]: 'company_admin' } });
        const write = mockWrites.find((w) => w.path.startsWith('integrations_index/'));
        expect(write.data.companyId).toBe(COMPANY);
    });

    it('binds the page to the named company for its company admin', async () => {
        await call({ roles: { [COMPANY]: 'company_admin' } });

        const write = mockWrites.find((w) => w.path.startsWith('integrations_index/'));
        expect(write).toBeDefined();
        // The property the whole fix exists for: the stored tenant is the
        // company, not the caller. `processLead` reads this back to decide where
        // every future lead from this page is written.
        expect(write.data.companyId).toBe(COMPANY);
        expect(write.data.companyId).not.toBe(CALLER_UID);
    });
});
