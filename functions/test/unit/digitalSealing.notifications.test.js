/**
 * The bell tells whoever waits on a document that it was signed, or that it
 * could not be sealed: the team member who sent it; for a post-application
 * document, which nobody sent, the recruiter its application is assigned to,
 * else the team. One notification per request and outcome however often the
 * trigger delivers the event, holding only the document's title and the
 * signer's name. The notification never changes the seal: the sealed PDF and
 * the request's status are what they were, and a notification that cannot be
 * written is logged, not failed.
 * Every name and id is artificial.
 */
const { createFirestoreMock } = require('../helpers/firestoreMock');
const { createStorageFake, onePagePdf } = require('./signedCopy.support');

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

const mock = createFirestoreMock();
const mockStorage = createStorageFake();
jest.mock('../../firebaseAdmin', () => ({ admin: mock.admin, db: mock.db, storage: mockStorage.storage }));

// The real writer, unless a test makes it fail.
let mockNotificationFailure = null;
jest.mock('../../shared/createNotification', () => {
    const actual = jest.requireActual('../../shared/createNotification');
    return {
        createNotification: (...args) => (mockNotificationFailure
            ? Promise.reject(mockNotificationFailure)
            : actual.createNotification(...args)),
    };
});

require('../../digitalSealing');

const TEMPLATE_PATH = 'secure_documents/co1/templates/offer.pdf';
const SEALED_PATH = 'secure_documents/co1/completed/req-1_signed.pdf';
const nameField = { id: 'name', type: 'text', pageNumber: 1, x: 10, y: 80, width: 30, height: 5, required: true };

const recruiterSent = (extra = {}) => ({
    title: 'Offer Letter',
    recipientName: 'Jane Driver',
    recipientEmail: 'jane.driver@example.test',
    senderId: 'rec-1',
    senderName: 'Rita Recruiter',
    fields: [nameField],
    fieldValues: { name: 'Jane Driver' },
    ...extra,
});

const postApplication = (extra = {}) => recruiterSent({
    senderId: null,
    senderName: 'SafeHaul Auto-Followup',
    source: 'post_application_success',
    sourceApplicationId: 'app-1',
    title: 'W-4',
    ...extra,
});

let patches;

/** One delivery of the request moving to `pending_seal`. */
async function seal(request, requestId = 'req-1') {
    await sealHandler({
        before: { data: () => ({ status: 'sent' }) },
        after: {
            data: () => ({ status: 'pending_seal', storagePath: TEMPLATE_PATH, ...request }),
            ref: { update: async (patch) => { patches.push(patch); } },
        },
    }, { params: { companyId: 'co1', requestId } });
}

const statusWritten = () => patches.map((patch) => patch.status).filter(Boolean);

/** The company's notifications, by id. */
function notifications() {
    const prefix = 'companies/co1/notifications/';
    return Object.fromEntries([...mock.docs.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, data]) => [path.slice(prefix.length), data]));
}

let errors;

beforeEach(async () => {
    patches = [];
    mockNotificationFailure = null;
    mock.reset();
    mockStorage.reset();
    mockStorage.files.set(TEMPLATE_PATH, await onePagePdf());
    errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a document the team sent', () => {
    it('tells its sender it was signed, once however often the trigger is delivered', async () => {
        await seal(recruiterSent());
        await seal(recruiterSent());

        expect(statusWritten()).toEqual(['signed', 'signed']);
        expect(Object.keys(notifications())).toEqual(['seal_req-1']);
        expect(notifications()['seal_req-1']).toEqual({
            type: 'document_signed',
            title: 'Document signed',
            message: 'Jane Driver signed Offer Letter',
            recipientId: 'rec-1',
            relatedType: 'signing_request',
            relatedId: 'req-1',
            read: false,
            createdAt: expect.anything(),
        });
        // Title and signer only: never the signer's email or a value they typed.
        expect(JSON.stringify(notifications())).not.toContain('example.test');
    });

    it('tells its sender once when a required field is missing, and still when a later seal succeeds', async () => {
        await seal(recruiterSent({ fieldValues: {} }));
        await seal(recruiterSent({ fieldValues: {} }));

        expect(statusWritten()).toEqual(['error_sealing', 'error_sealing']);
        expect(mockStorage.calls.uploads).toEqual([]);
        expect(Object.keys(notifications())).toEqual(['seal_failed_req-1']);
        expect(notifications()['seal_failed_req-1']).toMatchObject({
            type: 'document_seal_failed',
            title: 'Seal failed',
            message: 'Offer Letter, signed by Jane Driver, could not be sealed',
            recipientId: 'rec-1',
            relatedType: 'signing_request',
            relatedId: 'req-1',
        });

        await seal(recruiterSent());

        expect(statusWritten()).toEqual(['error_sealing', 'error_sealing', 'signed']);
        expect(Object.keys(notifications()).sort()).toEqual(['seal_failed_req-1', 'seal_req-1']);
    });

    it('tells its sender when sealing fails outright', async () => {
        mockStorage.files.delete(TEMPLATE_PATH);

        await seal(recruiterSent());

        expect(statusWritten()).toEqual(['error_sealing']);
        expect(notifications()['seal_failed_req-1']).toMatchObject({
            type: 'document_seal_failed',
            recipientId: 'rec-1',
        });
    });
});

describe('a post-application document, which nobody sent', () => {
    it('tells the recruiter its application is assigned to, and opens the application', async () => {
        mock.docs.set('companies/co1/applications/app-1', { assignedTo: 'rec-9', assignedToName: 'Oleg' });

        await seal(postApplication());

        expect(notifications()['seal_req-1']).toMatchObject({
            type: 'document_signed',
            message: 'Jane Driver signed W-4',
            recipientId: 'rec-9',
            relatedType: 'application',
            relatedId: 'app-1',
        });
    });

    it('tells the team when the application is not assigned', async () => {
        mock.docs.set('companies/co1/applications/app-1', { assignedTo: '' });

        await seal(postApplication({ fieldValues: {} }));

        expect(statusWritten()).toEqual(['error_sealing']);
        const notification = notifications()['seal_failed_req-1'];
        expect(notification).toMatchObject({ relatedType: 'application', relatedId: 'app-1' });
        expect(notification).not.toHaveProperty('recipientId');
    });

    it('tells the team when the application is gone', async () => {
        await seal(postApplication());

        expect(notifications()['seal_req-1']).toMatchObject({ relatedType: 'application', relatedId: 'app-1' });
        expect(notifications()['seal_req-1']).not.toHaveProperty('recipientId');
    });
});

describe('a notification that cannot be written', () => {
    it('leaves the seal as it was, and is logged', async () => {
        mockNotificationFailure = Object.assign(new Error('unavailable'), { code: 14 });

        await seal(recruiterSent());

        expect(statusWritten()).toEqual(['signed']);
        expect(patches[0]).toMatchObject({ signedPdfUrl: SEALED_PATH, sha256Checksum: expect.any(String) });
        expect(mockStorage.files.has(SEALED_PATH)).toBe(true);
        expect(notifications()).toEqual({});
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('req-1'), 'unavailable');
    });

    it('leaves a failed seal failed', async () => {
        mockNotificationFailure = Object.assign(new Error('unavailable'), { code: 14 });

        await seal(recruiterSent({ fieldValues: {} }));

        expect(statusWritten()).toEqual(['error_sealing']);
        expect(patches).toHaveLength(1);
    });
});
