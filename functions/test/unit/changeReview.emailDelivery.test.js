/**
 * "Email review link to driver": the server emails the "approve changes" link
 * to the application's own address, so the company never holds it.
 *
 * Pinned here: the caller gets the masked address and never the token; the link
 * is the same newest-only review a copied one is; nothing is created when there
 * is no address, no company email, a limit reached or an email sent a moment
 * ago; a failed send says so and can be retried; nothing logs the token.
 */

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message, details) { super(message); this.code = code; this.details = details; }
    },
}));
const mockLogs = [];
jest.mock('firebase-functions', () => ({
    logger: {
        info: (...args) => mockLogs.push(args.map(String).join(' ')),
        warn: (...args) => mockLogs.push(args.map(String).join(' ')),
    },
}));
let mockTokenSeq = 0;
jest.mock('../../shared/randomId', () => ({ randomId: () => `0f6c1d2e-review-token-${++mockTokenSeq}` }));
const mockAssertAdmin = jest.fn();
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAdminStrict: (...a) => mockAssertAdmin(...a) }));
const mockRateLimit = jest.fn();
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...a) => mockRateLimit(...a) }));
const mockSendEmail = jest.fn();
const mockReadSmtp = jest.fn();
jest.mock('../../emailService', () => ({ sendDynamicEmail: (...a) => mockSendEmail(...a) }));
jest.mock('../../shared/smtpSettings', () => ({ readSmtpSettings: (...a) => mockReadSmtp(...a) }));

const mockReviews = new Map();
const mockPending = new Map();
const mockAppDoc = {};

function mockDocSnap(map, id) {
    return { id, exists: map.has(id), data: () => (map.has(id) ? { ...map.get(id) } : undefined) };
}

const mockAppRef = {
    get: async () => ({ exists: true, data: () => ({ ...mockAppDoc }) }),
    collection: (name) => {
        if (name !== 'pending_changes') return { add: async () => {} };
        const all = () => [...mockPending.keys()].map((id) => mockDocSnap(mockPending, id));
        return {
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

function mockReviewRef(id) {
    return { __review: id, get: async () => mockDocSnap(mockReviews, id) };
}

function mockReviewQuery(filters) {
    return {
        where: (field, op, value) => mockReviewQuery([...filters, [field, value]]),
        get: async () => {
            const docs = [...mockReviews.keys()]
                .filter((id) => filters.every(([field, value]) => mockReviews.get(id)[field] === value))
                .map((id) => ({ ...mockDocSnap(mockReviews, id), ref: mockReviewRef(id) }));
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
            ? { ...mockReviewQuery([]), doc: (id) => mockReviewRef(id) }
            : { doc: () => ({ collection: () => ({ doc: () => mockAppRef }) }) }),
        // Serial, each seeing the writes of those before: Firestore's guarantee.
        runTransaction: async (fn) => {
            const writes = [];
            const result = await fn({
                get: (refOrQuery) => refOrQuery.get(),
                set: (ref, data) => writes.push([ref, data, false]),
                update: (ref, data) => {
                    if (!mockReviews.has(ref.__review)) throw new Error('No document to update');
                    writes.push([ref, data, true]);
                },
            });
            for (const [ref, data, merge] of writes) {
                mockReviews.set(ref.__review, { ...(merge ? mockReviews.get(ref.__review) : {}), ...data });
            }
            return result;
        },
    },
}));

const { createChangeReview, getChangeReview } = require('../../applicationChanges');

const auth = { uid: 'admin1', token: {} };
const TESTING = 'https://truckerapp-system.web.app';
const target = { companyId: 'co1', applicationId: 'app1', collectionName: 'applications' };
const emailIt = (extra = {}) => createChangeReview({
    auth, data: { ...target, deliver: 'email', appBaseUrl: TESTING, ...extra },
});
const openReviews = () => [...mockReviews.entries()].filter(([, r]) => r.status === 'open');

beforeEach(() => {
    jest.resetAllMocks();
    mockAssertAdmin.mockResolvedValue(undefined);
    mockRateLimit.mockResolvedValue(true);
    mockSendEmail.mockResolvedValue({ success: true });
    mockReadSmtp.mockResolvedValue({ settings: { user: 'hr@acme.test' }, companyName: 'Acme Freight' });
    mockReviews.clear();
    mockPending.clear();
    mockLogs.length = 0;
    mockTokenSeq = 0;
    Object.keys(mockAppDoc).forEach((k) => delete mockAppDoc[k]);
    Object.assign(mockAppDoc, { firstName: 'Jo', lastName: 'Lee', email: 'Jo.Lee@Example.test' });
    mockPending.set('phone', { fieldKey: 'phone', fieldLabel: 'Phone', originalValue: '1', proposedValue: '2', status: 'pending' });
});

describe('emailing the review link', () => {
    it('sends it to the application’s own address and tells the caller only where, masked', async () => {
        const result = await emailIt();

        expect(result).toEqual({
            success: true, delivered: { channel: 'email', to: 'j***@example.test' }, expiresInDays: 30,
        });
        const [token] = openReviews().map(([id]) => id);
        expect(JSON.stringify(result)).not.toContain(token);
        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        const [companyId, to, subject, html] = mockSendEmail.mock.calls[0];
        expect(companyId).toBe('co1');
        expect(to).toBe('jo.lee@example.test');
        expect(subject).toContain('Acme Freight');
        expect(html).toContain(`${TESTING}/review-change/${token}`);
        expect(html).toContain('Jo');
        expect(mockReviews.get(token).delivery).toMatchObject({
            channel: 'email', status: 'sent', to: 'j***@example.test', by: 'admin1',
        });
    });

    it('is the newest-only review a copied link is', async () => {
        const copied = await createChangeReview({ auth, data: target });
        await emailIt();

        expect(mockReviews.get(copied.token).status).toBe('revoked');
        const [[token]] = openReviews();
        await expect(getChangeReview({ data: { token } })).resolves.toMatchObject({ status: 'open' });
    });

    it('builds the link on the app’s own site, never one the caller names', async () => {
        await emailIt({ appBaseUrl: 'https://evil.example' });
        expect(mockSendEmail.mock.calls[0][3]).toContain('https://app.safehaul.io/review-change/');
        expect(mockSendEmail.mock.calls[0][3]).not.toContain('evil.example');
    });
});

describe('nothing is created when it cannot be emailed', () => {
    it.each([
        ['no email', ''],
        ['a placeholder address', 'lead-9@placeholder.safehaulapp.com'],
        ['an address that is not one', 'jo@'],
    ])('refuses %s, and keeps the link the driver has', async (_label, email) => {
        const copied = await createChangeReview({ auth, data: target });
        mockAppDoc.email = email;

        await expect(emailIt()).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'no-email' } });
        expect(mockSendEmail).not.toHaveBeenCalled();
        expect(openReviews().map(([id]) => id)).toEqual([copied.token]);
    });

    it('refuses when the company has no email set up', async () => {
        mockReadSmtp.mockResolvedValue({ settings: null, companyName: 'Acme Freight' });
        await expect(emailIt()).rejects.toMatchObject({
            code: 'failed-precondition', details: { reason: 'email-not-configured' },
        });
        expect(mockReviews.size).toBe(0);
    });

    it('sends one email for two presses a moment apart', async () => {
        await emailIt();
        await expect(emailIt()).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'just-sent' } });

        expect(mockSendEmail).toHaveBeenCalledTimes(1);
        expect(openReviews()).toHaveLength(1);
    });

    it('limits emails per admin and per application', async () => {
        mockRateLimit.mockImplementation(async (key) => !key.startsWith('link_email_'));
        await expect(emailIt()).rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'rate-limited' } });
        expect(mockReviews.size).toBe(0);

        mockRateLimit.mockResolvedValue(true);
        await emailIt();
        const keys = mockRateLimit.mock.calls.map(([key]) => key);
        expect(keys).toContain('link_email_co1_admin1');
        expect(keys).toContain('link_email_review_co1_applications_app1');
    });

    it('still needs pending changes, and a Company Admin', async () => {
        mockPending.clear();
        await expect(emailIt()).rejects.toMatchObject({ code: 'failed-precondition' });
        expect(mockSendEmail).not.toHaveBeenCalled();

        mockPending.set('phone', { fieldKey: 'phone', status: 'pending' });
        mockAssertAdmin.mockRejectedValueOnce(Object.assign(new Error('no'), { code: 'permission-denied' }));
        await expect(emailIt()).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSendEmail).not.toHaveBeenCalled();
    });

    it('refuses a channel it does not offer', async () => {
        await expect(emailIt({ deliver: 'sms' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockReviews.size).toBe(0);
    });
});

describe('a send that fails', () => {
    it('says nobody received it, and can be tried again at once', async () => {
        mockSendEmail.mockRejectedValueOnce(new Error('Failed to send email: 550 rejected'));

        await expect(emailIt()).rejects.toMatchObject({ code: 'unavailable', details: { reason: 'email-failed' } });
        const [[, failed]] = openReviews();
        expect(failed.delivery.status).toBe('failed');

        await expect(emailIt()).resolves.toMatchObject({ delivered: { to: 'j***@example.test' } });
        expect(mockSendEmail).toHaveBeenCalledTimes(2);
    });
});

describe('the logs', () => {
    it('never hold the token or the link', async () => {
        const seen = [];
        for (const level of ['log', 'info', 'warn', 'error']) {
            jest.spyOn(console, level).mockImplementation((...args) => seen.push(args.map(String).join(' ')));
        }
        await emailIt();
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
        mockSendEmail.mockRejectedValueOnce(new Error('Failed to send email: rejected'));
        await expect(emailIt()).rejects.toMatchObject({ code: 'unavailable' });

        const all = [...seen, ...mockLogs].join('\n');
        for (const id of mockReviews.keys()) expect(all).not.toContain(id);
        expect(all).not.toContain('/review-change/');
        jest.restoreAllMocks();
    });
});
