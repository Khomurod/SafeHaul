/**
 * A sealed document linked to a driver record (`sourceApplicationId`, an
 * application; `sourceLeadId`, a lead) is filed once in that record's DQ file:
 * `dq_files/signed_<requestId>`, pointing at the sealed PDF the seal wrote,
 * never a copy of it, with the checksum the seal recorded. A record that is not
 * this company's files nothing, and a filing that fails never undoes or fails
 * the seal. Every name and id is artificial.
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

require('../../digitalSealing');

const TEMPLATE_PATH = 'secure_documents/co1/templates/offer.pdf';
const SEALED_PATH = 'secure_documents/co1/completed/req-1_signed.pdf';
const DQ_PATH = (collection, id) => `companies/co1/${collection}/${id}/dq_files/signed_req-1`;
const nameField = { id: 'name', type: 'text', pageNumber: 1, x: 10, y: 80, width: 30, height: 5, required: true };

const sent = (extra = {}) => ({
    title: 'Offer Letter',
    recipientName: 'Jane Driver',
    recipientEmail: 'jane.driver@example.test',
    senderId: 'rec-1',
    fields: [nameField],
    fieldValues: { name: 'Jane Driver' },
    ...extra,
});

let patches;

/** One delivery of the request moving to `pending_seal`. */
async function seal(request) {
    await sealHandler({
        before: { data: () => ({ status: 'sent' }) },
        after: {
            data: () => ({ status: 'pending_seal', storagePath: TEMPLATE_PATH, ...request }),
            ref: { update: async (patch) => { patches.push(patch); }, get: async () => ({ exists: true, data: () => ({ status: 'pending_seal' }) }) },
        },
    }, { params: { companyId: 'co1', requestId: 'req-1' } });
}

const statusWritten = () => patches.map((patch) => patch.status).filter(Boolean);
const dqFiles = () => [...mock.docs.keys()].filter((path) => path.includes('/dq_files/'));

let errors;

beforeEach(async () => {
    patches = [];
    mock.reset({
        'companies/co1/applications/app-1': { firstName: 'Jane', applicantId: 'uid-1', driverId: 'uid-1', userId: null },
        'companies/co1/leads/lead-1': { firstName: 'Dana' },
    });
    mockStorage.reset();
    mockStorage.files.set(TEMPLATE_PATH, await onePagePdf());
    errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('a sealed document linked to an application', () => {
    it("is filed in the application's DQ file, pointing at the sealed PDF and its checksum", async () => {
        await seal(sent({ sourceApplicationId: 'app-1' }));

        expect(statusWritten()).toEqual(['signed']);
        const { sha256Checksum } = patches[0];
        expect(mock.docs.get(DQ_PATH('applications', 'app-1'))).toEqual({
            type: 'signed_document',
            fileType: 'Signed document – Offer Letter',
            label: 'Signed document',
            fileName: 'Offer Letter.pdf',
            storagePath: SEALED_PATH,
            url: null,
            source: 'signed_document',
            isSynced: true,
            signingRequestId: 'req-1',
            sha256Checksum,
            uploadedBy: 'e_docs',
            uploadedAt: '__server_timestamp__',
            createdAt: '__server_timestamp__',
            applicationId: 'app-1',
            applicantId: 'uid-1',
            driverId: 'uid-1',
            userId: null,
            ownerUserIds: ['uid-1'],
        });
        expect(sha256Checksum).toMatch(/^[0-9a-f]{64}$/);
        // The path of the one sealed PDF; nothing was copied.
        expect(mockStorage.calls.uploads).toHaveLength(1);
        expect([...mockStorage.files.keys()].filter((path) => path.endsWith('.pdf')).sort()).toEqual([SEALED_PATH, TEMPLATE_PATH].sort());
    });

    it('is filed once, however often the trigger is delivered, and stays removed once removed', async () => {
        await seal(sent({ sourceApplicationId: 'app-1' }));
        const filed = mock.docs.get(DQ_PATH('applications', 'app-1'));
        expect(filed).toMatchObject({ storagePath: SEALED_PATH, signingRequestId: 'req-1' });
        // Removed on the DQ tab: hidden, never deleted.
        mock.docs.set(DQ_PATH('applications', 'app-1'), { ...filed, removedAt: 'removed' });
        await seal(sent({ sourceApplicationId: 'app-1' }));

        expect(dqFiles()).toEqual([DQ_PATH('applications', 'app-1')]);
        expect(mock.docs.get(DQ_PATH('applications', 'app-1'))).toEqual({ ...filed, removedAt: 'removed' });
    });
});

describe('a sealed document linked to a lead', () => {
    it("is filed in the lead's DQ file", async () => {
        await seal(sent({ sourceLeadId: 'lead-1' }));

        expect(dqFiles()).toEqual([DQ_PATH('leads', 'lead-1')]);
        expect(mock.docs.get(DQ_PATH('leads', 'lead-1'))).toMatchObject({
            storagePath: SEALED_PATH,
            signingRequestId: 'req-1',
            isSynced: true,
            ownerUserIds: ['lead-1'],
        });
    });
});

describe('a sealed document with no record of this company', () => {
    it('files nothing when it is linked to no record', async () => {
        await seal(sent());

        expect(statusWritten()).toEqual(['signed']);
        expect(dqFiles()).toEqual([]);
    });

    it('files nothing for a record that does not exist, and the seal stands', async () => {
        await seal(sent({ sourceApplicationId: 'app-gone' }));

        expect(statusWritten()).toEqual(['signed']);
        expect(dqFiles()).toEqual([]);
        expect(mock.docs.has('companies/co1/applications/app-gone')).toBe(false);
    });

    it.each(['../other/app-1', 'co2/applications/app-1', '', 42])('files nothing for the link %j', async (link) => {
        await seal(sent({ sourceApplicationId: link }));

        expect(statusWritten()).toEqual(['signed']);
        expect(dqFiles()).toEqual([]);
    });

    it('files nothing for a document that could not be sealed', async () => {
        await seal(sent({ sourceApplicationId: 'app-1', fieldValues: {} }));

        expect(statusWritten()).toEqual(['error_sealing']);
        expect(dqFiles()).toEqual([]);
    });
});

describe('a filing that fails', () => {
    it('leaves the seal as it was, and is logged', async () => {
        // The record is there; writing its DQ entry fails.
        const realCollection = mock.db.collection;
        jest.spyOn(mock.db, 'collection').mockImplementation((name) => {
            const ref = realCollection(name);
            if (name !== 'companies') return ref;
            return {
                ...ref,
                doc: (companyId) => {
                    const company = ref.doc(companyId);
                    return {
                        ...company,
                        collection: (sub) => {
                            const records = company.collection(sub);
                            return {
                                ...records,
                                doc: (id) => {
                                    const record = records.doc(id);
                                    return {
                                        ...record,
                                        collection: (child) => (child === 'dq_files'
                                            ? { doc: () => ({ create: async () => { throw Object.assign(new Error('unavailable'), { code: 14 }); } }) }
                                            : record.collection(child)),
                                    };
                                },
                            };
                        },
                    };
                },
            };
        });

        await seal(sent({ sourceApplicationId: 'app-1' }));

        expect(statusWritten()).toEqual(['signed']);
        expect(patches[0]).toMatchObject({ signedPdfUrl: SEALED_PATH, sha256Checksum: expect.any(String) });
        expect(dqFiles()).toEqual([]);
        expect(errors).toHaveBeenCalledWith(expect.stringContaining('req-1'), 'unavailable');
        // The seal's own notification still goes.
        expect(mock.docs.has('companies/co1/notifications/seal_req-1')).toBe(true);
    });
});
