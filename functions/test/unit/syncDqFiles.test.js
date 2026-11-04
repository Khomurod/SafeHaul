/**
 * The DQ tab, on opening, asks the server to file the record's uploads that no
 * DQ record holds yet — kept or removed — for applications and leads alike.
 */
jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    },
}));

const mockAssertCompanyAccessForRequest = jest.fn();
jest.mock('../../shared/companyAccess', () => ({
    assertCompanyAccessForRequest: (...args) => mockAssertCompanyAccessForRequest(...args),
}));

const mockFileSealed = jest.fn();
jest.mock('../../sealedDocumentDq', () => ({
    fileSealedDocumentInDq: (...args) => mockFileSealed(...args),
}));

const mockRefreshExpiresNext = jest.fn();
jest.mock('../../shared/dqExpiry', () => ({
    ...jest.requireActual('../../shared/dqExpiry'),
    refreshDqExpiresNext: (...args) => mockRefreshExpiresNext(...args),
}));

// `mock`-prefixed so the jest.mock factory may reference them (jest hoisting rule).
const mockDocs = new Map();
const mockWrites = [];
jest.mock('../../firebaseAdmin', () => {
    const docRef = (path) => ({
        path,
        collection: (name) => colRef(`${path}/${name}`),
        get: async () => ({ exists: mockDocs.has(path), data: () => mockDocs.get(path) }),
        set: async (data, options) => { mockWrites.push({ path, data, options }); },
    });
    const docsUnder = (path) => [...mockDocs.entries()]
        .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
        .map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data }));
    const colRef = (path) => ({
        doc: (id) => docRef(`${path}/${id}`),
        get: async () => ({ docs: docsUnder(path) }),
        where: (field, op, value) => ({
            get: async () => ({ docs: docsUnder(path).filter((doc) => op === '==' && doc.data()?.[field] === value) }),
        }),
    });
    return {
        admin: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => 'DELETE_FIELD' } } },
        db: { collection: (name) => colRef(name) },
    };
});

const { syncDqFiles } = require('../../syncDqFiles');

const APP = 'companies/co1/applications/app1';
const CDL = { name: 'cdl.jpg', storagePath: 'companies/co1/applications/guest_uploads/1760000000000_ab12cd_cdl.jpg' };
const MED = { name: 'med.jpg', storagePath: 'companies/co1/applications/guest_uploads/1760000000001_ef34gh_med.jpg' };
const call = (data, auth = { uid: 'recruiter-1' }) => syncDqFiles({ auth, data });
const ask = (extra = {}) => call({ companyId: 'co1', collectionName: 'applications', applicationId: 'app1', ...extra });

beforeEach(() => {
    jest.resetAllMocks();
    mockAssertCompanyAccessForRequest.mockResolvedValue(undefined);
    mockDocs.clear();
    mockWrites.length = 0;
    mockFileSealed.mockResolvedValue(true);
    mockRefreshExpiresNext.mockResolvedValue(true);
});

it('requires a signed-in caller of the company, and names no other collection', async () => {
    await expect(call({ companyId: 'co1', collectionName: 'applications', applicationId: 'app1' }, null))
        .rejects.toMatchObject({ code: 'unauthenticated' });
    for (const bad of [{ collectionName: 'drivers' }, { applicationId: '' }, { applicationId: 'a/b' }, { companyId: 7 }]) {
        await expect(ask(bad)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    mockAssertCompanyAccessForRequest.mockRejectedValue(Object.assign(new Error('no'), { code: 'permission-denied' }));
    await expect(ask()).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockAssertCompanyAccessForRequest).toHaveBeenCalledWith(expect.anything(), 'co1', 'syncDqFiles');
    expect(mockWrites).toEqual([]);
});

it('files an upload that no record holds, by its path, with no link', async () => {
    mockDocs.set(APP, { 'cdl-front': CDL, cdlExpiration: '2028-03-01', driverId: 'driver-9' });

    await expect(ask()).resolves.toEqual({ filed: 1 });
    expect(mockWrites).toEqual([{
        path: `${APP}/dq_files/license_front`,
        data: expect.objectContaining({
            fileType: 'CDL Front',
            fileName: 'cdl.jpg',
            storagePath: CDL.storagePath,
            url: 'DELETE_FIELD',
            expirationDate: '2028-03-01',
            ownerUserIds: ['driver-9'],
            isSynced: true,
            sourceField: 'cdl-front',
            removedAt: 'DELETE_FIELD',
        }),
        options: { merge: true },
    }]);
});

it('files nothing a record already holds, kept or removed, whatever its id', async () => {
    mockDocs.set(APP, { 'cdl-front': { ...CDL, url: 'https://signed.example.test/fresh' }, 'medical-card-upload': MED });
    // Filed by the server, then removed on the DQ tab.
    mockDocs.set(`${APP}/dq_files/license_front`, { storagePath: CDL.storagePath, url: 'https://signed.example.test/stale', removedAt: 'then' });
    // Filed long ago by the browser, under an id of its own.
    mockDocs.set(`${APP}/dq_files/auto-1`, { fileType: 'Medical Card', storagePath: MED.storagePath });

    await expect(ask()).resolves.toEqual({ filed: 0 });
    expect(mockWrites).toEqual([]);
});

it('files a new upload of a type whose record holds an older one', async () => {
    mockDocs.set(APP, { 'cdl-front': CDL });
    mockDocs.set(`${APP}/dq_files/license_front`, {
        storagePath: 'companies/co1/applications/guest_uploads/1750000000000_zz99yy_old.jpg',
        removedAt: 'then',
    });

    await expect(ask()).resolves.toEqual({ filed: 1 });
    expect(mockWrites[0]).toMatchObject({
        path: `${APP}/dq_files/license_front`,
        data: { storagePath: CDL.storagePath, removedAt: 'DELETE_FIELD' },
    });
});

it('matches an old upload that holds only a link by its link', async () => {
    const OLD = { name: 'mc.jpg', url: 'https://storage.example.test/mc' };
    mockDocs.set(APP, { 'medical-card-upload': OLD });
    mockDocs.set(`${APP}/dq_files/auto-1`, { url: OLD.url });
    await expect(ask()).resolves.toEqual({ filed: 0 });

    mockDocs.delete(`${APP}/dq_files/auto-1`);
    await expect(ask()).resolves.toEqual({ filed: 1 });
    expect(mockWrites[0].data).toMatchObject({ url: OLD.url, fileUrl: OLD.url, storagePath: '' });
});

it('takes no path of another company as the upload, and files a lead\'s uploads under the lead', async () => {
    mockDocs.set(APP, { 'cdl-front': { name: 'x.jpg', storagePath: 'companies/co2/applications/guest_uploads/1760000000000_ab12cd_x.jpg' } });
    await expect(ask()).resolves.toEqual({ filed: 0 });

    mockDocs.set('companies/co1/leads/lead1', { 'mvr-upload': MED });
    await expect(ask({ collectionName: 'leads', applicationId: 'lead1' })).resolves.toEqual({ filed: 1 });
    expect(mockWrites[0].path).toBe('companies/co1/leads/lead1/dq_files/mvr');
});

it('files nothing for a record that is gone', async () => {
    await expect(ask()).resolves.toEqual({ filed: 0 });
    expect(mockWrites).toEqual([]);
});

it('matches a record that holds only the link of an upload that has its path too', async () => {
    // Filed by the browser long ago, before the upload's path was copied.
    const link = 'https://storage.example.test/cdl';
    mockDocs.set(APP, { 'cdl-front': { ...CDL, url: link } });
    mockDocs.set(`${APP}/dq_files/license_front`, { url: link, storagePath: '', removedAt: 'then' });

    await expect(ask()).resolves.toEqual({ filed: 0 });
    expect(mockWrites).toEqual([]);
});

// A sealed document is filed by `sealDocument` once it is signed; one whose
// filing failed, or that was sealed before documents were filed, is filed when
// the DQ tab opens. A removed entry stays removed.
describe('sealed documents linked to the record', () => {
    const SIGNING = 'companies/co1/signing_requests';
    const signed = (id, extra = {}) => mockDocs.set(`${SIGNING}/${id}`, {
        status: 'signed',
        sourceApplicationId: 'app1',
        signedPdfUrl: `secure_documents/co1/completed/${id}_signed.pdf`,
        sha256Checksum: `sum-${id}`,
        title: 'W-9',
        ...extra,
    });

    it('files a signed one the DQ file lacks, at the sealed PDF, and counts it', async () => {
        mockDocs.set(APP, { driverId: 'driver-9' });
        signed('req-1');

        await expect(ask()).resolves.toEqual({ filed: 1 });
        expect(mockFileSealed).toHaveBeenCalledWith('co1', 'req-1', expect.objectContaining({ sourceApplicationId: 'app1' }), {
            storagePath: 'secure_documents/co1/completed/req-1_signed.pdf',
            sha256Checksum: 'sum-req-1',
        });
    });

    it('leaves one already filed, kept or removed, one not signed, and one whose stored path is not its sealed PDF', async () => {
        mockDocs.set(APP, { driverId: 'driver-9' });
        signed('kept');
        mockDocs.set(`${APP}/dq_files/signed_kept`, { storagePath: 'secure_documents/co1/completed/kept_signed.pdf' });
        signed('removed');
        mockDocs.set(`${APP}/dq_files/signed_removed`, { removedAt: 'then' });
        signed('waiting', { status: 'sent' });
        signed('elsewhere', { signedPdfUrl: 'secure_documents/co2/completed/elsewhere_signed.pdf' });
        signed('other-record', { sourceApplicationId: 'app2' });

        await expect(ask()).resolves.toEqual({ filed: 0 });
        expect(mockFileSealed).not.toHaveBeenCalled();
    });

    it("files a lead's by its lead link", async () => {
        mockDocs.set('companies/co1/leads/app1', {});
        signed('lead-doc', { sourceApplicationId: undefined, sourceLeadId: 'app1' });

        await expect(ask({ collectionName: 'leads' })).resolves.toEqual({ filed: 1 });
        expect(mockFileSealed).toHaveBeenCalledWith('co1', 'lead-doc', expect.anything(), expect.anything());
    });

    it('still answers for the uploads when the signing requests cannot be read', async () => {
        mockDocs.set(APP, { 'cdl-front': CDL });
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockFileSealed.mockRejectedValue(new Error('unavailable'));
        signed('req-1');
        try {
            await expect(ask()).resolves.toEqual({ filed: 1 });
        } finally {
            errors.mockRestore();
        }
    });
});

// `dqExpiresNext` (`shared/dqExpiry.js`) is kept by a trigger on every DQ write;
// a record whose DQ file was filed before it existed has none until the tab
// opens, which puts it right when it disagrees with the files it read.
describe('the earliest valid-until date', () => {
    it('is put right when it disagrees with the DQ file', async () => {
        mockDocs.set(APP, { status: 'Hired' });
        mockDocs.set(`${APP}/dq_files/medical_card`, { storagePath: MED.storagePath, expirationDate: '2027-04-30' });

        await expect(ask()).resolves.toEqual({ filed: 0 });
        expect(mockRefreshExpiresNext).toHaveBeenCalledTimes(1);
        expect(mockRefreshExpiresNext.mock.calls[0][0].path).toBe(APP);
    });

    it('is left alone when it agrees, the stored value or its absence', async () => {
        mockDocs.set(APP, { dqExpiresNext: '2027-04-30' });
        mockDocs.set(`${APP}/dq_files/medical_card`, { storagePath: MED.storagePath, expirationDate: '2027-04-30' });
        await ask();

        mockDocs.set(APP, {});
        mockDocs.set(`${APP}/dq_files/medical_card`, { storagePath: MED.storagePath, expirationDate: '2027-04-30', removedAt: 'then' });
        await ask();

        expect(mockRefreshExpiresNext).not.toHaveBeenCalled();
    });

    it('never fails the filing when it cannot be written', async () => {
        mockDocs.set(APP, { 'cdl-front': CDL });
        mockDocs.set(`${APP}/dq_files/auto-1`, { fileType: 'Medical Card', expirationDate: '2027-04-30' });
        mockRefreshExpiresNext.mockRejectedValue(new Error('aborted'));
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await expect(ask()).resolves.toEqual({ filed: 1 });
        } finally {
            errors.mockRestore();
        }
    });
});
