/**
 * "Retry seal" end to end: `retrySealDocument` moves a request back to
 * `pending_seal` and `sealDocument` seals it, from a failed seal or from one
 * left sealing. The trigger seals on the request entering `pending_seal`, or on
 * a new attempt recorded while it is there, and only while the stored request
 * still waits for that attempt: an older delivery, or one for a document since
 * signed, changes nothing. The signer's images survive every failed attempt and
 * go only after the seal succeeds. The bell says "Seal failed" once per
 * document, and "Document signed" once it seals.
 * Every name, path and id is artificial.
 */
const { createFirestoreMock } = require('../helpers/firestoreMock');
const { createStorageFake, onePagePdf, tinyPng } = require('./signedCopy.support');

let sealHandler;

jest.mock('firebase-functions/v1', () => ({
    runWith: () => ({
        firestore: {
            document: () => ({
                onUpdate: (handler) => {
                    sealHandler = handler;
                    return handler;
                },
            }),
        },
    }),
}));
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
const mockStorage = createStorageFake();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db, storage: mockStorage.storage }));
jest.mock('../../shared/companyAccess', () => ({ assertCompanyAccessForRequest: async () => {} }));

require('../../digitalSealing');
const { retrySealDocument } = require('../../sealRetry');

const PATH = 'companies/co1/signing_requests/req-r';
const TEMPLATE_PATH = 'secure_documents/co1/templates/offer.pdf';
const COMPANY_IMAGE = 'secure_documents/co1/originals/company-signatures/stamp.png';
const SIGNER_IMAGE = 'secure_documents/co1/signatures/req-r_sig1.png';
const SEALED_PATH = 'secure_documents/co1/completed/req-r_signed.pdf';
const MINUTE = 60 * 1000;
const ago = (minutes) => ({ toMillis: () => Date.now() - minutes * MINUTE });

const signerField = { id: 'sig1', type: 'signature', pageNumber: 1, xPosition: 10, yPosition: 70, width: 30, height: 10, required: true };
const companyField = {
    id: 'cs1', type: 'company_signature', label: 'Company Signature', pageNumber: 1, xPosition: 60, yPosition: 70,
    width: 30, height: 10, required: false, readOnly: true, prefillPolicy: 'locked', companySignaturePath: COMPANY_IMAGE,
};

const ref = () => mock.db.collection('companies').doc('co1').collection('signing_requests').doc('req-r');
/** The request as stored now. */
const stored = () => mock.docs.get(PATH);
const snapshot = () => JSON.parse(JSON.stringify(stored()));

/** One delivery of an update from `before` to `after`, against the stored request. */
async function deliver(before, after) {
    await sealHandler({
        before: { data: () => before },
        after: { data: () => after, ref: ref() },
    }, { params: { companyId: 'co1', requestId: 'req-r' } });
}

/** The signer submits: the request enters `pending_seal`, and the trigger runs. */
async function submit() {
    const before = snapshot();
    await ref().update({ status: 'pending_seal', signedAt: ago(0) });
    await deliver(before, stored());
}

/** A team member presses Retry seal, and the trigger runs on that update. */
async function retry() {
    const before = { ...stored() };
    const answer = await retrySealDocument({ auth: { uid: 'rec-1', token: {} }, data: { companyId: 'co1', requestId: 'req-r' } });
    await deliver(before, { ...stored() });
    return answer;
}

const notifications = () => [...mock.docs.keys()].filter((path) => path.startsWith('companies/co1/notifications/')).sort();

beforeEach(async () => {
    mock.reset({
        [PATH]: {
            companyId: 'co1',
            title: 'Offer Letter',
            recipientName: 'Jane Driver',
            senderId: 'rec-1',
            status: 'sent',
            storagePath: TEMPLATE_PATH,
            fields: [signerField, companyField],
            fieldValues: { sig1: SIGNER_IMAGE },
        },
    });
    mockStorage.reset();
    mockStorage.files.set(TEMPLATE_PATH, await onePagePdf());
    mockStorage.files.set(SIGNER_IMAGE, tinyPng(1, 1, [255, 0, 0]));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a seal that failed, sealed again', () => {
    it('seals once the cause is fixed, and only then deletes the signer\'s image', async () => {
        // The company signature image is missing: the seal fails, the signer's image stays.
        await submit();
        expect(stored()).toMatchObject({ status: 'error_sealing', missingFields: ['cs1'] });
        expect(mockStorage.files.has(SIGNER_IMAGE)).toBe(true);
        expect(notifications()).toEqual(['companies/co1/notifications/seal_failed_req-r']);

        // Still missing: the retry fails the same way, the image still stays, the bell says nothing new.
        await expect(retry()).resolves.toMatchObject({ attempt: 1 });
        expect(stored()).toMatchObject({ status: 'error_sealing', missingFields: ['cs1'] });
        expect(mockStorage.files.has(SIGNER_IMAGE)).toBe(true);
        expect(mockStorage.calls.uploads).toEqual([]);
        expect(notifications()).toEqual(['companies/co1/notifications/seal_failed_req-r']);

        // The team uploads the image; the next retry seals.
        mockStorage.files.set(COMPANY_IMAGE, tinyPng(3, 2, [0, 0, 255]));
        await expect(retry()).resolves.toMatchObject({ attempt: 2 });

        expect(stored()).toMatchObject({ status: 'signed', signedPdfUrl: SEALED_PATH, sha256Checksum: expect.any(String) });
        expect(stored()).not.toHaveProperty('errorLog');
        expect(stored()).not.toHaveProperty('missingFields');
        expect(stored().fieldValues).toEqual({ sig1: SIGNER_IMAGE });
        expect(stored().sealAttempts.map((attempt) => attempt.previousStatus)).toEqual(['error_sealing', 'error_sealing']);
        expect(mockStorage.calls.uploads).toEqual([SEALED_PATH]);
        expect(mockStorage.files.has(SIGNER_IMAGE)).toBe(false);
        expect(mockStorage.files.has(COMPANY_IMAGE)).toBe(true);
        expect(notifications()).toEqual([
            'companies/co1/notifications/seal_failed_req-r',
            'companies/co1/notifications/seal_req-r',
        ]);
    });

    it('is never sealed again once signed', async () => {
        mockStorage.files.set(COMPANY_IMAGE, tinyPng(3, 2));
        await submit();
        expect(stored().status).toBe('signed');
        const signed = snapshot();

        await expect(retrySealDocument({ auth: { uid: 'rec-1', token: {} }, data: { companyId: 'co1', requestId: 'req-r' } }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        // A delivery of an earlier retry, arriving now, changes nothing either.
        await deliver({ ...signed, status: 'error_sealing' }, { ...signed, status: 'pending_seal' });

        expect(snapshot()).toEqual(signed);
        expect(mockStorage.calls.uploads).toEqual([SEALED_PATH]);
    });
});

describe('a seal left unfinished, sealed again', () => {
    beforeEach(async () => {
        mockStorage.files.set(COMPANY_IMAGE, tinyPng(3, 2));
        // Signed eleven minutes ago, and the run that should have sealed it never finished.
        await ref().update({ status: 'pending_seal', signedAt: ago(11) });
    });

    it('seals on the attempt the retry records, though the status stays pending_seal', async () => {
        await expect(retry()).resolves.toMatchObject({ attempt: 1 });

        expect(stored()).toMatchObject({ status: 'signed', signedPdfUrl: SEALED_PATH });
        expect(stored().sealAttempts).toEqual([expect.objectContaining({ previousStatus: 'pending_seal', previousError: null })]);
        expect(mockStorage.calls.uploads).toEqual([SEALED_PATH]);
    });

    it('does not seal on an update that records no new attempt', async () => {
        const before = snapshot();
        await ref().update({ viewedAt: 'now' });
        await deliver(before, stored());

        expect(stored().status).toBe('pending_seal');
        expect(mockStorage.calls.downloads).toEqual([]);
    });

    it('does not seal on a late delivery of the attempt before the newest', async () => {
        const firstEvent = { before: { ...stored(), status: 'sent' }, after: { ...stored() } };
        // The retry is recorded and has not been delivered yet...
        await retrySealDocument({ auth: { uid: 'rec-1', token: {} }, data: { companyId: 'co1', requestId: 'req-r' } });
        // ...when the original event arrives, late.
        await deliver(firstEvent.before, firstEvent.after);

        expect(stored().status).toBe('pending_seal');
        expect(mockStorage.calls.downloads).toEqual([]);
    });
});
