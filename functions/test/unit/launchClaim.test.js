// =====================================================================
// One launch per campaign draft (`bulkActions/helpers/launchClaim.js`).
//
// `initBulkSession` claims the draft in a transaction before it gathers
// recipients: a draft already launched, or claimed by a launch still within
// its time, is refused, so two tabs (or two people) pressing Launch on the
// same draft send one campaign. A launch that ends marks the draft
// (`launchedAt`, `sessionId`); one that fails gives its claim back.
//
// Firestore is an in-memory map here; a transaction reads and writes it.
// =====================================================================

const store = new Map();

const mockTimestamp = {
    fromMillis: (ms) => ({ toMillis: () => ms, __ms: ms }),
};
const DELETE = { __delete: true };
const SERVER_TIME = { __serverTimestamp: true };

function apply(path, patch) {
    const current = store.get(path);
    if (!current) {
        const error = new Error(`NOT_FOUND: ${path}`);
        error.code = 5;
        throw error;
    }
    const next = { ...current };
    for (const [key, value] of Object.entries(patch)) {
        if (value === DELETE) delete next[key];
        else next[key] = value;
    }
    store.set(path, next);
}

function ref(path) {
    return {
        path,
        update: jest.fn(async (patch) => apply(path, patch)),
    };
}

function collection(name) {
    return {
        doc: (companyId) => ({
            collection: (sub) => ({
                doc: (id) => ref(`${name}/${companyId}/${sub}/${id}`),
            }),
        }),
    };
}

async function transaction(fn) {
    const tx = {
        get: async (docRef) => {
            const data = store.get(docRef.path);
            return { exists: Boolean(data), data: () => data };
        },
        update: (docRef, patch) => apply(docRef.path, patch),
    };
    return fn(tx);
}

const mockDb = {
    collection: jest.fn(),
    runTransaction: jest.fn(),
};

jest.mock('firebase-functions/v2/https', () => ({
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

jest.mock('../../firebaseAdmin', () => ({
    db: mockDb,
    admin: {
        firestore: {
            Timestamp: mockTimestamp,
            FieldValue: {
                delete: () => DELETE,
                serverTimestamp: () => SERVER_TIME,
            },
        },
    },
}));

const {
    CLAIM_TTL_MS,
    claimDraftLaunch,
    finishDraftLaunch,
    releaseDraftLaunch,
} = require('../../bulkActions/helpers/launchClaim');

const PATH = 'companies/co-1/campaign_drafts/camp-1';
const NOW = 1800000000000;

function claim(overrides = {}) {
    return claimDraftLaunch({
        companyId: 'co-1',
        campaignId: 'camp-1',
        uid: 'admin-1',
        sessionId: 'session-1',
        now: NOW,
        ...overrides,
    });
}

beforeEach(() => {
    // A test below queues a `*Once` value: reset, then put the defaults back.
    jest.resetAllMocks();
    mockDb.collection.mockImplementation(collection);
    mockDb.runTransaction.mockImplementation(transaction);
    store.clear();
    store.set(PATH, { name: 'Spring drive' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('claimDraftLaunch', () => {
    it('claims an unlaunched draft for this launch, by whom and when', async () => {
        const draft = await claim();

        expect(draft.path).toBe(PATH);
        expect(store.get(PATH).launchClaim).toEqual({
            by: 'admin-1',
            sessionId: 'session-1',
            at: expect.objectContaining({ __ms: NOW }),
        });
        expect(store.get(PATH).name).toBe('Spring drive');
    });

    it('claims nothing when the screen sends no draft (Production’s screens until promotion)', async () => {
        await expect(claim({ campaignId: undefined })).resolves.toBeNull();
        await expect(claim({ campaignId: null })).resolves.toBeNull();

        expect(mockDb.runTransaction).not.toHaveBeenCalled();
        expect(store.get(PATH).launchClaim).toBeUndefined();
    });

    it('refuses a second launch while the first is still running: one campaign, not two', async () => {
        await claim();

        await expect(claim({ uid: 'admin-2', sessionId: 'session-2', now: NOW + 1000 }))
            .rejects.toMatchObject({ code: 'failed-precondition', message: expect.stringMatching(/being launched/) });
        expect(store.get(PATH).launchClaim.sessionId).toBe('session-1');
    });

    it('refuses a draft that was already launched', async () => {
        store.set(PATH, { name: 'Spring drive', launchedAt: { seconds: 1 }, sessionId: 'old' });

        await expect(claim()).rejects.toMatchObject({
            code: 'failed-precondition',
            message: expect.stringMatching(/already launched/),
        });
        expect(store.get(PATH).launchClaim).toBeUndefined();
    });

    it('takes over a claim left by a launch that died, once it is older than the callable could run', async () => {
        await claim();

        await claim({ uid: 'admin-2', sessionId: 'session-2', now: NOW + CLAIM_TTL_MS + 1 });

        expect(store.get(PATH).launchClaim).toMatchObject({ by: 'admin-2', sessionId: 'session-2' });
        // The callable stops after 540 seconds, so a live launch always holds its claim.
        expect(CLAIM_TTL_MS).toBeGreaterThan(540 * 1000);
    });

    it('treats a claim without a readable time as stale', async () => {
        store.set(PATH, { launchClaim: { by: 'x', sessionId: 'y', at: 'garbled' } });

        await claim();

        expect(store.get(PATH).launchClaim.sessionId).toBe('session-1');
    });

    it('refuses a draft that no longer exists, and does not create one', async () => {
        store.delete(PATH);

        await expect(claim()).rejects.toMatchObject({ code: 'not-found' });
        expect(store.has(PATH)).toBe(false);
    });

    it.each([
        ['an empty id', ''],
        ['a path', 'a/b'],
        ['a reserved id', '__x__'],
        ['a dot', '..'],
        ['a number', 7],
        ['a long id', 'x'.repeat(201)],
    ])('refuses %s as the draft', async (_label, campaignId) => {
        await expect(claim({ campaignId })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockDb.runTransaction).not.toHaveBeenCalled();
    });
});

describe('finishDraftLaunch', () => {
    it('marks the draft launched with its session and drops the claim', async () => {
        const draft = await claim();

        await finishDraftLaunch(draft, 'session-1');

        expect(store.get(PATH)).toEqual({
            name: 'Spring drive',
            launchedAt: SERVER_TIME,
            sessionId: 'session-1',
        });
    });

    it('does nothing without a claimed draft', async () => {
        await expect(finishDraftLaunch(null, 'session-1')).resolves.toBeUndefined();
    });

    it('never fails the launch that already went out: a draft deleted meanwhile is logged, not recreated', async () => {
        const draft = await claim();
        store.delete(PATH);

        await expect(finishDraftLaunch(draft, 'session-1')).resolves.toBeUndefined();
        expect(store.has(PATH)).toBe(false);
        // Only the error's code is logged.
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[launchClaim]'), 5);
    });
});

describe('releaseDraftLaunch', () => {
    it('gives back this launch’s claim, so the draft can be launched again', async () => {
        const draft = await claim();

        await releaseDraftLaunch(draft, 'session-1');

        expect(store.get(PATH)).toEqual({ name: 'Spring drive' });
        await expect(claim({ sessionId: 'session-2', now: NOW + 1 })).resolves.toBeTruthy();
    });

    it('leaves another launch’s claim alone', async () => {
        const draft = await claim();
        await claim({ sessionId: 'session-2', now: NOW + CLAIM_TTL_MS + 1 });

        await releaseDraftLaunch(draft, 'session-1');

        expect(store.get(PATH).launchClaim.sessionId).toBe('session-2');
    });

    it('does nothing without a claimed draft, and never throws over the launch’s own error', async () => {
        await expect(releaseDraftLaunch(null, 'session-1')).resolves.toBeUndefined();

        const draft = await claim();
        mockDb.runTransaction.mockRejectedValueOnce(new Error('UNAVAILABLE'));
        await expect(releaseDraftLaunch(draft, 'session-1')).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalled();
    });
});
