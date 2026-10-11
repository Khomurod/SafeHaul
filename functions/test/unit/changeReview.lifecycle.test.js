/**
 * A change-review link works while it is the application's open review, and
 * then stops: once the driver completes it, or once the company sends a newer
 * link. Otherwise an old or forwarded link could settle edits the company
 * proposes later, which the driver never saw under that link.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn() } }));
let mockTokenSeq = 0;
jest.mock('uuid', () => ({ v4: () => `tok-${++mockTokenSeq}` }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: jest.fn(async () => {}) }));
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: jest.fn(async () => true) }));

const mockReviews = new Map();
const mockPending = new Map();
const mockAppDoc = { firstName: 'Jo', lastName: 'Lee' };

function mockDocSnap(map, id) {
    return { id, exists: map.has(id), data: () => (map.has(id) ? { ...map.get(id) } : undefined) };
}

const mockAppRef = {
    get: async () => ({ exists: true, data: () => ({ ...mockAppDoc }) }),
    set: async (data) => Object.assign(mockAppDoc, data),
    collection: (name) => {
        if (name !== 'pending_changes') return { add: async () => {} };
        const all = () => [...mockPending.entries()].map(([id]) => mockDocSnap(mockPending, id));
        return {
            doc: (id) => ({ __pending: id }),
            get: async () => ({ docs: all() }),
            where: (field, op, value) => ({
                limit: () => ({
                    get: async () => {
                        const docs = all().filter((d) => d.data()[field] === value);
                        return { empty: docs.length === 0, size: docs.length, docs };
                    },
                }),
            }),
        };
    },
};

function mockReviewQuery(filters) {
    return {
        where: (field, op, value) => mockReviewQuery([...filters, [field, value]]),
        get: async () => {
            const docs = [...mockReviews.keys()]
                .filter((id) => filters.every(([field, value]) => mockReviews.get(id)[field] === value))
                .map((id) => ({ ...mockDocSnap(mockReviews, id), ref: { __review: id } }));
            return { empty: docs.length === 0, docs };
        },
    };
}

jest.mock('../../firebaseAdmin', () => ({
    admin: {
        firestore: {
            FieldValue: { serverTimestamp: () => 'TS' },
            Timestamp: { now: () => ({ toMillis: () => Date.now() }), fromMillis: (ms) => ({ toMillis: () => ms }) },
        },
    },
    db: {
        collection: (name) => (name === 'change_reviews'
            ? {
                ...mockReviewQuery([]),
                doc: (id) => ({
                    get: async () => mockDocSnap(mockReviews, id),
                    set: async (data, opts) => mockReviews.set(id, { ...(opts?.merge ? mockReviews.get(id) : {}), ...data }),
                }),
            }
            : { doc: () => ({ collection: () => ({ doc: () => mockAppRef }) }) }),
        batch: () => {
            const ops = [];
            return {
                set: (ref, data) => ops.push([ref, data]),
                update: (ref, data) => ops.push([ref, data]),
                commit: async () => {
                    for (const [ref, data] of ops) {
                        if (ref.__pending) mockPending.set(ref.__pending, { ...mockPending.get(ref.__pending), ...data });
                        else if (ref.__review) mockReviews.set(ref.__review, { ...mockReviews.get(ref.__review), ...data });
                        else Object.assign(mockAppDoc, data);
                    }
                },
            };
        },
    },
}));

const { createChangeReview, getChangeReview, submitChangeResolution } = require('../../applicationChanges');

const auth = { uid: 'admin1', token: {} };
const target = { companyId: 'co1', applicationId: 'app1', collectionName: 'applications' };
const propose = (fieldKey, proposedValue) => mockPending.set(fieldKey, {
    fieldKey, fieldLabel: fieldKey, originalValue: 'old', proposedValue, status: 'pending',
});
const approve = (token, fieldKey) => submitChangeResolution({ data: { token, resolutions: [{ fieldKey, action: 'approve' }] } });

beforeEach(() => {
    mockReviews.clear();
    mockPending.clear();
    mockTokenSeq = 0;
    Object.keys(mockAppDoc).forEach((k) => delete mockAppDoc[k]);
    Object.assign(mockAppDoc, { firstName: 'Jo', lastName: 'Lee' });
});

describe('a completed review link', () => {
    it('cannot settle, or show, edits the company proposes later', async () => {
        propose('phone', '555-0100');
        const { token } = await createChangeReview({ auth, data: target });
        await approve(token, 'phone');
        expect(mockReviews.get(token).status).toBe('completed');

        propose('city', 'Springfield');
        await expect(approve(token, 'city')).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockPending.get('city').status).toBe('pending');
        expect(mockAppDoc.city).toBeUndefined();

        // Nothing, not even the settled 'phone': the application's changes now
        // include ones that belong to later links.
        const shown = await getChangeReview({ data: { token } });
        expect(shown).toMatchObject({ status: 'completed', changes: [] });
    });
});

describe('a newer review link', () => {
    it('turns off every older open link for the same application', async () => {
        propose('phone', '555-0100');
        const first = await createChangeReview({ auth, data: target });
        const second = await createChangeReview({ auth, data: target });

        expect(mockReviews.get(first.token).status).toBe('revoked');
        expect(mockReviews.get(second.token).status).toBe('open');
        await expect(approve(first.token, 'phone')).rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(getChangeReview({ data: { token: first.token } })).rejects.toMatchObject({ code: 'failed-precondition' });

        await approve(second.token, 'phone');
        expect(mockAppDoc.phone).toBe('555-0100');
    });

    it("leaves another application's open link alone", async () => {
        propose('phone', '555-0100');
        mockReviews.set('other', { ...target, applicationId: 'app2', status: 'open' });
        await createChangeReview({ auth, data: target });
        expect(mockReviews.get('other').status).toBe('open');
    });
});
