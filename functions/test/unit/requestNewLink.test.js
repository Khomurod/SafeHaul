/**
 * "Ask <Company> for a new link": a person whose public link no longer works
 * asks, and the company hears it once a day in its bell, only while what the
 * link was for is still outstanding. The caller always gets the same answer, so
 * it learns nothing about a link. Artificial people, companies and tokens only.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: (optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));
jest.mock('firebase-functions', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

const { createFirestoreMock } = require('../helpers/firestoreMock');

const mock = createFirestoreMock({}, { filters: true });
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));
const mockRateLimit = jest.fn(async () => true);
jest.mock('../../shared/rateLimiter', () => ({ checkRateLimit: (...args) => mockRateLimit(...args) }));

const { logger } = require('firebase-functions');
const { requestNewLink } = require('../../requestNewLink');

const CO = 'co-link';
const PEV_TOKEN = 'pev-token-0000-1111-2222';
const REVIEW_TOKEN = 'review-token-3333-4444-5555';
const RAW = { ip: '203.0.113.9', headers: {} };
const ask = (data) => requestNewLink({ data, rawRequest: RAW });
const today = () => new Date().toISOString().slice(0, 10);

const SEED = {
    [`companies/${CO}`]: { companyName: 'Artificial Freight' },
    [`companies/${CO}/signing_requests/sr-1`]: {
        status: 'sent', title: 'Lease agreement', recipientName: 'Pat Example', senderId: 'rec-1',
    },
    [`verification_requests/${PEV_TOKEN}`]: {
        token: PEV_TOKEN, requestId: 'pev-req-1', companyId: CO, applicationId: 'app-1',
        collectionName: 'applications', employerName: 'ABC Trucking', applicantName: 'Ivan Example',
        status: 'no_response', createdBy: 'rec-2',
    },
    [`change_reviews/${REVIEW_TOKEN}`]: {
        token: REVIEW_TOKEN, companyId: CO, applicationId: 'lead-1', collectionName: 'leads',
        applicantName: 'Dana Driver', status: 'open', createdBy: 'admin-1',
    },
    [`companies/${CO}/leads/lead-1/pending_changes/phone`]: { fieldKey: 'phone', status: 'pending' },
};

const notifications = () => [...mock.docs.entries()]
    .filter(([path]) => path.startsWith(`companies/${CO}/notifications/`))
    .map(([path, data]) => ({ id: path.split('/').pop(), data }));

beforeEach(() => {
    // This file queues *Once values, so every mock is reset and its default put back.
    jest.resetAllMocks();
    mock.reset(SEED);
    mockRateLimit.mockImplementation(async () => true);
});

describe('requestNewLink tells the company', () => {
    it('about a document still waiting for its signer, for the team member who sent it, opening E-Docs', async () => {
        await expect(ask({ kind: 'sign', companyId: CO, requestId: 'sr-1' })).resolves.toEqual({ ok: true });

        expect(mockRateLimit).toHaveBeenCalledWith('new_link_request_203.0.113.9', 10, 3600, 'closed');
        expect(notifications()).toEqual([{
            id: `new_link_sign_sr-1_${today()}`,
            data: expect.objectContaining({
                type: 'signing_link_requested',
                title: 'New link requested',
                message: 'Pat Example asked for a new link to sign “Lease agreement”.',
                recipientId: 'rec-1',
                relatedType: 'signing_request',
                relatedId: 'sr-1',
                read: false,
            }),
        }]);
    });

    it("about a document sent for an application: it opens the application, and the system's sends tell its assignee", async () => {
        mock.docs.set(`companies/${CO}/signing_requests/sr-2`, {
            status: 'sent', title: 'Drug test consent', recipientName: 'Pat Example',
            senderId: 'system:post-application', sourceApplicationId: 'app-9',
        });
        mock.docs.set(`companies/${CO}/applications/app-9`, { assignedTo: 'rec-7' });

        await ask({ kind: 'sign', companyId: CO, requestId: 'sr-2' });
        expect(notifications()[0].data).toMatchObject({
            recipientId: 'rec-7', relatedType: 'application', relatedId: 'app-9',
        });
    });

    it('about a document sent from a lead: it opens the lead', async () => {
        mock.docs.set(`companies/${CO}/signing_requests/sr-3`, {
            status: 'sent', title: 'Lease agreement', recipientName: 'Pat Example', senderId: 'rec-1', sourceLeadId: 'lead-7',
        });

        await ask({ kind: 'sign', companyId: CO, requestId: 'sr-3' });
        expect(notifications()[0].data).toMatchObject({ recipientId: 'rec-1', relatedType: 'lead', relatedId: 'lead-7' });
    });

    it('the whole team when the sender has left it', async () => {
        mock.docs.set(`companies/${CO}`, { companyName: 'Artificial Freight', teamMembers: [{ userId: 'rec-2' }] });

        await ask({ kind: 'sign', companyId: CO, requestId: 'sr-1' });
        await ask({ kind: 'verify', token: PEV_TOKEN });
        const [sign, verify] = ['sign', 'verify'].map((kind) => notifications().find(({ id }) => id.startsWith(`new_link_${kind}_`)));
        // rec-1 sent the document and has left; rec-2, who sent the verification, has not.
        expect(sign.data).not.toHaveProperty('recipientId');
        expect(verify.data.recipientId).toBe('rec-2');
    });

    it('about a verification not answered, naming the employer and the driver, never by its token', async () => {
        await expect(ask({ kind: 'verify', token: PEV_TOKEN })).resolves.toEqual({ ok: true });

        const [notice] = notifications();
        expect(notice.id).toBe(`new_link_verify_pev-req-1_${today()}`);
        expect(notice.data).toMatchObject({
            type: 'pev_link_requested',
            message: 'ABC Trucking asked for a new link to answer the employment verification for Ivan Example.',
            recipientId: 'rec-2',
            relatedType: 'application',
            relatedId: 'app-1',
        });
        expect(JSON.stringify(notice)).not.toContain(PEV_TOKEN);
    });

    it('about a replaced verification while the request that replaced it is unanswered', async () => {
        mock.docs.set(`verification_requests/${PEV_TOKEN}`, {
            ...SEED[`verification_requests/${PEV_TOKEN}`], status: 'superseded', supersededBy: 'pev-req-2',
        });
        mock.docs.set('verification_requests/newer-token', { requestId: 'pev-req-2', companyId: CO, status: 'opened' });

        await ask({ kind: 'verify', token: PEV_TOKEN });
        expect(notifications()).toHaveLength(1);
    });

    it('about a review with changes still waiting, for the admin who sent it, opening the lead', async () => {
        await expect(ask({ kind: 'review', token: REVIEW_TOKEN })).resolves.toEqual({ ok: true });

        const [notice] = notifications();
        expect(notice.data).toMatchObject({
            type: 'review_link_requested',
            message: 'Dana Driver asked for a new link to review the changes to their application.',
            recipientId: 'admin-1',
            relatedType: 'lead',
            relatedId: 'lead-1',
        });
        expect(notice.id).toMatch(new RegExp(`^new_link_review_[0-9a-f]{32}_${today()}$`));
        expect(JSON.stringify(notice)).not.toContain(REVIEW_TOKEN);
    });

    it('about a replaced review link, and the whole team when the record names no sender', async () => {
        mock.docs.set(`change_reviews/${REVIEW_TOKEN}`, {
            ...SEED[`change_reviews/${REVIEW_TOKEN}`], status: 'revoked', createdBy: undefined, applicantName: 'Driver',
        });

        await ask({ kind: 'review', token: REVIEW_TOKEN });
        const [notice] = notifications();
        expect(notice.data.message).toBe('The driver asked for a new link to review the changes to their application.');
        expect(notice.data).not.toHaveProperty('recipientId');
    });
});

describe('requestNewLink adds nothing more', () => {
    it('when the same record is asked about again the same day', async () => {
        await ask({ kind: 'sign', companyId: CO, requestId: 'sr-1' });
        await expect(ask({ kind: 'sign', companyId: CO, requestId: 'sr-1' })).resolves.toEqual({ ok: true });
        expect(notifications()).toHaveLength(1);
    });

    it.each([
        ['a signed document', 'sign', `companies/${CO}/signing_requests/sr-1`, { status: 'signed' }],
        ['a document being sealed', 'sign', `companies/${CO}/signing_requests/sr-1`, { status: 'pending_seal' }],
        ['a voided document', 'sign', `companies/${CO}/signing_requests/sr-1`, { status: 'voided' }],
        ['an answered verification', 'verify', `verification_requests/${PEV_TOKEN}`, { status: 'completed' }],
        ['a verification being answered', 'verify', `verification_requests/${PEV_TOKEN}`, { status: 'processing' }],
        ['a completed review', 'review', `change_reviews/${REVIEW_TOKEN}`, { status: 'completed' }],
    ])('for %s, answering the same', async (_label, kind, path, change) => {
        mock.docs.set(path, { ...mock.docs.get(path), ...change });
        const input = kind === 'sign'
            ? { kind, companyId: CO, requestId: 'sr-1' }
            : { kind, token: kind === 'verify' ? PEV_TOKEN : REVIEW_TOKEN };

        await expect(ask(input)).resolves.toEqual({ ok: true });
        expect(notifications()).toEqual([]);
    });

    it('for a replaced verification whose newer request was answered', async () => {
        mock.docs.set(`verification_requests/${PEV_TOKEN}`, {
            ...SEED[`verification_requests/${PEV_TOKEN}`], status: 'superseded', supersededBy: 'pev-req-2',
        });
        mock.docs.set('verification_requests/newer-token', { requestId: 'pev-req-2', companyId: CO, status: 'completed' });

        await expect(ask({ kind: 'verify', token: PEV_TOKEN })).resolves.toEqual({ ok: true });
        expect(notifications()).toEqual([]);
    });

    it('for a verification replaced more times than are followed: the newest is not known to be waiting', async () => {
        mock.docs.set(`verification_requests/${PEV_TOKEN}`, {
            ...SEED[`verification_requests/${PEV_TOKEN}`], status: 'superseded', supersededBy: 'pev-req-2',
        });
        for (let n = 2; n <= 7; n += 1) {
            mock.docs.set(`verification_requests/token-${n}`, {
                requestId: `pev-req-${n}`, companyId: CO,
                ...(n < 7 ? { status: 'superseded', supersededBy: `pev-req-${n + 1}` } : { status: 'completed' }),
            });
        }

        await expect(ask({ kind: 'verify', token: PEV_TOKEN })).resolves.toEqual({ ok: true });
        expect(notifications()).toEqual([]);
    });

    it("for a review's older link and its replacement the same day: one notice for the application", async () => {
        const NEWER = 'review-token-6666-7777-8888';
        mock.docs.set(`change_reviews/${REVIEW_TOKEN}`, { ...SEED[`change_reviews/${REVIEW_TOKEN}`], status: 'revoked' });
        mock.docs.set(`change_reviews/${NEWER}`, { ...SEED[`change_reviews/${REVIEW_TOKEN}`], token: NEWER });

        await ask({ kind: 'review', token: REVIEW_TOKEN });
        await ask({ kind: 'review', token: NEWER });
        expect(notifications()).toHaveLength(1);
    });

    it('for a review whose changes were all settled under a newer link', async () => {
        mock.docs.set(`change_reviews/${REVIEW_TOKEN}`, { ...SEED[`change_reviews/${REVIEW_TOKEN}`], status: 'revoked' });
        mock.docs.set(`companies/${CO}/leads/lead-1/pending_changes/phone`, { fieldKey: 'phone', status: 'approved' });

        await expect(ask({ kind: 'review', token: REVIEW_TOKEN })).resolves.toEqual({ ok: true });
        expect(notifications()).toEqual([]);
    });

    it.each([
        ['a document', { kind: 'sign', companyId: CO, requestId: 'missing' }],
        ['a company', { kind: 'sign', companyId: 'nobody', requestId: 'sr-1' }],
        ['a verification', { kind: 'verify', token: 'unknown-token' }],
        ['a review', { kind: 'review', token: 'unknown-token' }],
    ])('for %s that does not exist, answering the same', async (_label, input) => {
        await expect(ask(input)).resolves.toEqual({ ok: true });
        expect(notifications()).toEqual([]);
    });
});

describe('requestNewLink refuses', () => {
    it.each([
        ['no input', undefined],
        ['an unknown kind', { kind: 'apply', token: 'abc' }],
        ['a signing request without its company', { kind: 'sign', requestId: 'sr-1' }],
        ['a token that is not text', { kind: 'verify', token: 42 }],
        ['an empty token', { kind: 'review', token: '' }],
        ['a token with a slash', { kind: 'verify', token: 'a/b' }],
        ['a token that is too long', { kind: 'verify', token: 'x'.repeat(129) }],
        ['a reserved document id', { kind: 'sign', companyId: CO, requestId: '__x__' }],
    ])('%s as invalid-argument, counting nothing', async (_label, data) => {
        await expect(ask(data)).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mockRateLimit).not.toHaveBeenCalled();
        expect(notifications()).toEqual([]);
    });

    it('a caller over the limit as resource-exhausted, before reading anything', async () => {
        mockRateLimit.mockResolvedValueOnce(false);
        await expect(ask({ kind: 'sign', companyId: CO, requestId: 'sr-1' })).rejects.toMatchObject({ code: 'resource-exhausted' });
        expect(notifications()).toEqual([]);
    });

    it('a failure as internal, logging neither the token nor the error text', async () => {
        const read = mock.db.collection;
        mock.db.collection = (name) => {
            if (name === 'verification_requests') throw new Error(`Failed reading verification_requests/${PEV_TOKEN}`);
            return read(name);
        };
        try {
            await expect(ask({ kind: 'verify', token: PEV_TOKEN })).rejects.toMatchObject({ code: 'internal' });
        } finally {
            mock.db.collection = read;
        }
        expect(JSON.stringify(logger.error.mock.calls)).not.toContain(PEV_TOKEN);
    });
});
