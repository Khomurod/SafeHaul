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
    const colRef = (path) => ({
        doc: (id) => docRef(`${path}/${id}`),
        get: async () => ({
            docs: [...mockDocs.entries()]
                .filter(([key]) => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/'))
                .map(([key, data]) => ({ id: key.slice(path.length + 1), data: () => data })),
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
