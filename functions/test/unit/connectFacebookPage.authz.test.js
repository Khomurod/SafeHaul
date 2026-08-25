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
// Documents written during a test. Reads consult this first, so a claim written
// by one call is visible to the next — which is the entire point of the
// concurrency tests below.
const mockStore = new Map();
// Firestore runs transactions in isolation and retries on conflict. The mock
// models that as a queue: one transaction body at a time, its writes applied on
// commit. That is what makes "two callers race for the same page" a meaningful
// test rather than a coin toss.
let mockTxQueue = Promise.resolve();
jest.mock('firebase-admin', () => {
    const DELETE = '__delete_sentinel__';
    const readPath = (path) => {
        if (mockStore.has(path)) return { exists: true, data: () => mockStore.get(path) };
        if (path.startsWith('integrations_index/') && mockExistingBinding) {
            return { exists: true, data: () => mockExistingBinding };
        }
        // Whether a `companies/{id}` doc exists is the whole difference between
        // "another company holds this page" and "this is a stale uid binding
        // from the old code" — so the mock has to model it.
        if (path.startsWith('companies/')) {
            return { exists: mockRealCompanies.includes(path.split('/')[1]), data: () => ({}) };
        }
        return { exists: false, data: () => ({}) };
    };
    const applyWrite = ({ op, path, data, merge }) => {
        if (op === 'delete') {
            mockStore.delete(path);
            mockWrites.push({ path, deleted: true, data: {} });
            return;
        }
        // A merge writes on top of whatever the document already holds —
        // including a binding seeded through `mockExistingBinding`, which is
        // how every pre-existing-connection test states its starting point.
        // Reading it back through `readPath` rather than the store is what
        // makes "the stale holder's token survived the merge" observable.
        const existing = readPath(path);
        const base = merge && existing.exists ? { ...existing.data() } : {};
        Object.entries(data).forEach(([key, value]) => {
            if (value === DELETE) delete base[key];
            else base[key] = value;
        });
        mockStore.set(path, base);
        mockWrites.push({ path, data: base, merge: Boolean(merge) });
    };
    const makeDoc = (path) => ({
        __path: path,
        id: path.split('/').pop(),
        set: jest.fn(async (data, options) => {
            applyWrite({ op: 'set', path, data, merge: options && options.merge });
        }),
        get: jest.fn(async () => readPath(path)),
        collection: (name) => makeCol(`${path}/${name}`),
    });
    const makeCol = (path) => ({ doc: (id) => makeDoc(`${path}/${id ?? 'auto'}`), add: jest.fn() });
    const runTransaction = (body) => {
        const run = mockTxQueue.then(async () => {
            const pending = [];
            const result = await body({
                get: async (ref) => readPath(ref.__path),
                set: (ref, data, options) => pending.push({
                    op: 'set', path: ref.__path, data, merge: options && options.merge,
                }),
                delete: (ref) => pending.push({ op: 'delete', path: ref.__path }),
            });
            pending.forEach(applyWrite);
            return result;
        });
        mockTxQueue = run.then(() => undefined, () => undefined);
        return run;
    };
    return {
        firestore: Object.assign(
            () => ({ collection: (name) => makeCol(name), runTransaction }),
            { FieldValue: { serverTimestamp: () => '__ts', delete: () => DELETE } },
        ),
        storage: () => ({}),
    };
});

// No network. The Graph API calls only run once authorization has passed, so an
// authorization test never reaches them; the tests that do get through assert on
// what was written rather than on the HTTP traffic. The concurrency tests below
// go further and hold the Graph calls open, because the window this callable used
// to leave open was exactly the length of those two round-trips.
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
    mockStore.clear();
    mockTxQueue = Promise.resolve();
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

/*
 * CLAIMING THE PAGE ATOMICALLY.
 *
 * Fixing the tenant binding above made a second-order problem worse. The shape
 * used to be: read the index, make two Graph API calls, write the index. Two
 * admins of two different companies connecting the same unclaimed page at the
 * same moment therefore BOTH read "unclaimed" — the reads finished long before
 * either write, separated by two network round-trips — and the later write took
 * the page. While the stored value was a uid that redirected a feed nobody read;
 * now it redirects a real tenant's leads into another tenant.
 *
 * The check and the claim are now one transaction that runs before Facebook is
 * contacted at all. These tests hold the Graph calls open on purpose: that is
 * the window, and if the claim were still written after them, every test here
 * would fail.
 */
describe('connectFacebookPage page claim', () => {
    // Lets a test decide when the Graph API answers, so two calls can genuinely
    // be in flight at once.
    const gateGraph = () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        axios.get.mockReset().mockImplementation(async (url) => {
            await gate;
            return url.includes('oauth/access_token')
                ? { data: { access_token: 'artificial-long-lived-user-token' } }
                : { data: { access_token: 'artificial-page-token' } };
        });
        return release;
    };
    const settle = () => new Promise((resolve) => { setImmediate(resolve); });

    it('lets only one of two concurrent companies claim the same page', async () => {
        const releaseGraph = gateGraph();

        const first = call({ roles: { [COMPANY]: 'company_admin' } });
        const second = call(
            { roles: { [OTHER_COMPANY]: 'company_admin' } },
            { companyId: OTHER_COMPANY },
        );
        const settled = Promise.allSettled([first, second]);
        await settle();
        releaseGraph();
        const [a, b] = await settled;

        expect(a.status).toBe('fulfilled');
        expect(b.status).toBe('rejected');
        expect(b.reason.message).toMatch(/already connected to another company/i);
        expect(b.reason.code).toBe('already-exists');
        // The page ends up bound to the winner, and only the winner.
        expect(mockStore.get('integrations_index/artificial-page-id').companyId).toBe(COMPANY);
    });

    it('claims the page before it calls Facebook', async () => {
        // The ordering on its own, stated separately from the race: by the time
        // the first Graph request is made, the index already names the tenant.
        let bindingWhenFacebookWasCalled;
        axios.get.mockReset().mockImplementation(async (url) => {
            // Not `??=`: the functions eslint config pins `ecmaVersion: 2020`,
            // and logical assignment is ES2021. Jest parses it happily, so this
            // only fails in lint.
            if (bindingWhenFacebookWasCalled === undefined) {
                bindingWhenFacebookWasCalled = mockStore.get('integrations_index/artificial-page-id');
            }
            return url.includes('oauth/access_token')
                ? { data: { access_token: 'artificial-long-lived-user-token' } }
                : { data: { access_token: 'artificial-page-token' } };
        });

        await call({ roles: { [COMPANY]: 'company_admin' } });

        expect(bindingWhenFacebookWasCalled).toMatchObject({
            companyId: COMPANY,
            claimPending: true,
        });
        // ...and the claim carries no token, because there is none yet.
        expect(bindingWhenFacebookWasCalled.accessToken).toBeUndefined();
    });

    it('clears the pending marker and stores the token once connected', async () => {
        await call({ roles: { [COMPANY]: 'company_admin' } });

        const stored = mockStore.get('integrations_index/artificial-page-id');
        expect(stored.accessToken).toBe('artificial-page-token');
        expect(stored.claimPending).toBeUndefined();
    });

    it('drops the previous holder token when reclaiming a stale uid binding', async () => {
        // A lead arriving inside the claim window must not be fetched with the
        // old holder's token and filed under the new tenant.
        mockExistingBinding = { companyId: CALLER_UID, accessToken: 'artificial-stale-token' };
        let tokenDuringClaim = 'unset';
        axios.get.mockReset().mockImplementation(async (url) => {
            if (tokenDuringClaim === 'unset') {
                tokenDuringClaim = mockStore.get('integrations_index/artificial-page-id').accessToken;
            }
            return url.includes('oauth/access_token')
                ? { data: { access_token: 'artificial-long-lived-user-token' } }
                : { data: { access_token: 'artificial-page-token' } };
        });

        await call({ roles: { [COMPANY]: 'company_admin' } });

        expect(tokenDuringClaim).toBeUndefined();
    });

    it('releases the claim when the Facebook exchange fails', async () => {
        // Otherwise a failed connect would lock the page away from the company
        // that owns it, with no way back through the UI.
        axios.get.mockReset().mockRejectedValue(new Error('artificial Graph failure'));

        await expect(call({ roles: { [COMPANY]: 'company_admin' } }))
            .rejects.toThrow(/Failed to connect Facebook Page/i);

        expect(mockStore.has('integrations_index/artificial-page-id')).toBe(false);
    });

    it('restores the working connection when a token refresh fails', async () => {
        // The refresh path: the company already had a connected page. A failed
        // refresh must give it back, not delete it.
        const working = {
            companyId: COMPANY,
            pageName: 'Artificial Page',
            accessToken: 'artificial-existing-page-token',
            platform: 'facebook',
        };
        mockExistingBinding = working;
        axios.get.mockReset().mockRejectedValue(new Error('artificial Graph failure'));

        await expect(call({ roles: { [COMPANY]: 'company_admin' } }))
            .rejects.toThrow(/Failed to connect Facebook Page/i);

        expect(mockStore.get('integrations_index/artificial-page-id')).toEqual(working);
    });

    it('leaves a claim alone once another attempt has completed it', async () => {
        // The rollback is conditional on purpose: it must only ever undo the
        // claim this call made. A slow failing attempt must not delete the
        // connection a later successful one established.
        axios.get.mockReset().mockImplementation(async (url) => {
            if (url.includes('oauth/access_token')) {
                // Someone else finishes the connection while this attempt is
                // still waiting on Facebook.
                mockStore.set('integrations_index/artificial-page-id', {
                    companyId: COMPANY,
                    accessToken: 'artificial-page-token',
                    platform: 'facebook',
                });
                throw new Error('artificial Graph failure');
            }
            return { data: { access_token: 'artificial-page-token' } };
        });

        await expect(call({ roles: { [COMPANY]: 'company_admin' } }))
            .rejects.toThrow(/Failed to connect Facebook Page/i);

        const stored = mockStore.get('integrations_index/artificial-page-id');
        expect(stored).toBeDefined();
        expect(stored.accessToken).toBe('artificial-page-token');
    });
});
