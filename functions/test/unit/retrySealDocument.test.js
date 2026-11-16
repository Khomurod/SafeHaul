/**
 * retrySealDocument — a team member's "Retry seal" for a signed document that
 * did not seal: one whose seal failed (`error_sealing`), or one left
 * `pending_seal` for more than ten minutes, when the run that should have sealed
 * it has died (it is stopped at 300 s). It takes no values from the caller: it
 * records the attempt in `sealAttempts`, clears the last error and moves the
 * request back to `pending_seal`, which `sealDocument` seals. A signed document,
 * one still being sealed, and any other are refused, and nothing is written.
 * Every name and id is artificial.
 */
const { createFirestoreMock } = require('../helpers/firestoreMock');

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

const mock = createFirestoreMock();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db }));

const mockAccess = { refusal: null };
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAccessForRequest: async () => {
        if (mockAccess.refusal) throw mockAccess.refusal;
    },
}));

const { retrySealDocument } = require('../../sealRetry');

const PATH = 'companies/co1/signing_requests/req-1';
const MINUTE = 60 * 1000;
const at = (millis) => ({ toMillis: () => millis });
const ago = (minutes) => at(Date.now() - minutes * MINUTE);

const asRecruiter = (data = { companyId: 'co1', requestId: 'req-1' }) => retrySealDocument({
    auth: { uid: 'rec-1', token: {} },
    data,
});

const failed = (extra = {}) => ({
    companyId: 'co1',
    title: 'Offer Letter',
    status: 'error_sealing',
    errorLog: 'Company signature image missing or unreadable: cs1',
    missingFields: ['cs1'],
    fieldValues: { name: 'Jane Driver', sig1: 'secure_documents/co1/signatures/req-1_sig1.png' },
    signedAt: ago(60),
    ...extra,
});

/** The request's stored data, as Firestore holds it. */
const stored = () => mock.docs.get(PATH);

async function refusal(promise) {
    try {
        await promise;
    } catch (error) {
        return { code: error.code, message: error.message };
    }
    throw new Error('Expected a refusal');
}

beforeEach(() => {
    mock.reset();
    mockAccess.refusal = null;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a document whose seal failed', () => {
    it('is sealed again: the attempt is recorded, the error cleared, the signed values left as they were', async () => {
        mock.reset({ [PATH]: failed() });

        await expect(asRecruiter()).resolves.toEqual({ success: true, status: 'pending_seal', attempt: 1 });

        const request = stored();
        expect(request.status).toBe('pending_seal');
        expect(request).not.toHaveProperty('errorLog');
        expect(request).not.toHaveProperty('missingFields');
        expect(request.fieldValues).toEqual(failed().fieldValues);
        expect(request.sealAttempts).toEqual([{
            at: expect.objectContaining({ toMillis: expect.any(Function) }),
            by: 'rec-1',
            previousStatus: 'error_sealing',
            previousError: 'Company signature image missing or unreadable: cs1',
        }]);
        expect(Math.abs(request.sealAttempts[0].at.toMillis() - Date.now())).toBeLessThan(5000);
    });

    it('keeps every attempt', async () => {
        mock.reset({ [PATH]: failed({ sealAttempts: [{ at: ago(30), by: 'rec-2', previousStatus: 'error_sealing', previousError: 'Earlier' }] }) });

        await expect(asRecruiter()).resolves.toMatchObject({ attempt: 2 });

        expect(stored().sealAttempts.map((attempt) => [attempt.by, attempt.previousError])).toEqual([
            ['rec-2', 'Earlier'],
            ['rec-1', 'Company signature image missing or unreadable: cs1'],
        ]);
    });

    it('takes nothing the caller sends but which document it is', async () => {
        mock.reset({ [PATH]: failed() });

        await asRecruiter({
            companyId: 'co1',
            requestId: 'req-1',
            status: 'signed',
            fieldValues: { name: 'Someone Else' },
            errorLog: 'injected',
            sealAttempts: [],
        });

        expect(stored().status).toBe('pending_seal');
        expect(stored().fieldValues).toEqual(failed().fieldValues);
        expect(stored().sealAttempts).toHaveLength(1);
        expect(JSON.stringify(stored())).not.toMatch(/Someone Else|injected/);
    });
});

describe('a document left sealing', () => {
    it('is sealed again after ten minutes, when the run that should have sealed it has stopped', async () => {
        mock.reset({ [PATH]: failed({ status: 'pending_seal', errorLog: undefined, missingFields: undefined, signedAt: ago(11) }) });

        await expect(asRecruiter()).resolves.toEqual({ success: true, status: 'pending_seal', attempt: 1 });

        expect(stored().sealAttempts).toEqual([expect.objectContaining({
            by: 'rec-1', previousStatus: 'pending_seal', previousError: null,
        })]);
    });

    it.each([
        ['signed two minutes ago', { signedAt: ago(2) }],
        ['signed long ago, sealed again two minutes ago', {
            signedAt: ago(90),
            sealAttempts: [{ at: ago(2), by: 'rec-2', previousStatus: 'error_sealing', previousError: 'x' }],
        }],
        ['with no time it started', { signedAt: undefined }],
    ])('is refused while it may still be sealing: %s', async (_label, extra) => {
        const before = failed({ status: 'pending_seal', errorLog: undefined, missingFields: undefined, ...extra });
        mock.reset({ [PATH]: before });

        expect(await refusal(asRecruiter())).toEqual({
            code: 'failed-precondition',
            message: 'This document is still being sealed. If it has not finished ten minutes after it was signed, try again.',
        });
        expect(stored()).toEqual(before);
    });
});

describe('a document that is not waiting on a seal', () => {
    it('is refused once signed and sealed, and is never sealed again', async () => {
        const signed = failed({ status: 'signed', errorLog: undefined, signedPdfUrl: 'secure_documents/co1/completed/req-1_signed.pdf' });
        mock.reset({ [PATH]: signed });

        expect(await refusal(asRecruiter())).toEqual({
            code: 'failed-precondition',
            message: 'This document is already signed and sealed.',
        });
        expect(stored()).toEqual(signed);
    });

    it.each(['sent', 'voided', 'processing'])('is refused when %s', async (status) => {
        mock.reset({ [PATH]: failed({ status }) });

        expect(await refusal(asRecruiter())).toEqual({
            code: 'failed-precondition',
            message: 'Only a signed document whose seal failed can be sealed again.',
        });
        expect(stored().status).toBe(status);
    });

    it('is refused when there is no such document', async () => {
        expect(await refusal(asRecruiter())).toMatchObject({ code: 'not-found' });
        expect(stored()).toBeUndefined();
    });
});

describe('who may ask', () => {
    it('refuses a caller who is not signed in', async () => {
        mock.reset({ [PATH]: failed() });
        expect(await refusal(retrySealDocument({ data: { companyId: 'co1', requestId: 'req-1' } }))).toMatchObject({ code: 'unauthenticated' });
        expect(stored().status).toBe('error_sealing');
    });

    it("refuses someone outside the company's team, and writes nothing", async () => {
        mock.reset({ [PATH]: failed() });
        mockAccess.refusal = Object.assign(new Error('You do not have access to this company.'), { code: 'permission-denied' });

        expect(await refusal(asRecruiter())).toMatchObject({ code: 'permission-denied' });
        expect(stored().status).toBe('error_sealing');
    });

    it.each([
        [{ requestId: 'req-1' }],
        [{ companyId: 'co1' }],
        [{ companyId: 'co1', requestId: 'co2/signing_requests/req-1' }],
        [{ companyId: '', requestId: 'req-1' }],
        [{ companyId: 'co1', requestId: 42 }],
    ])('refuses %j', async (data) => {
        expect(await refusal(asRecruiter(data))).toMatchObject({ code: 'invalid-argument' });
    });
});
