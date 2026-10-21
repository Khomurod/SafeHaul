/**
 * The application's uploads, filed in its DQ file: one `dq_files/{type}` record
 * per document type, written when the application arrives and when an upload
 * changes.
 *
 * The DQ tab keeps a synced record it was asked to delete, marked `removedAt`, so
 * that the same upload is not filed again. A new upload of that type must show,
 * so filing one clears the mark.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

// `mock`-prefixed so the jest.mock factory may reference it (jest hoisting rule).
const mockWrites = [];
jest.mock('../../firebaseAdmin', () => {
    const docRef = (path) => ({
        path,
        collection: (name) => colRef(`${path}/${name}`),
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (data, options) => { mockWrites.push({ path, data, options }); },
        update: async () => {},
    });
    const colRef = (path) => ({
        doc: (id) => docRef(`${path}/${id}`),
        where() { return this; },
        limit() { return this; },
        get: async () => ({ empty: true, docs: [] }),
        add: async () => {},
    });
    return {
        admin: {
            firestore: {
                FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', delete: () => 'DELETE_FIELD' },
                Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) },
            },
        },
        db: {
            collection: (name) => colRef(name),
            runTransaction: async (callback) => callback({
                get: async () => ({ exists: false, data: () => ({}) }),
                create: () => {},
                update: () => {},
            }),
        },
        auth: { getUserByEmail: async () => { throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); } },
    };
});

// A placeholder email with no phone makes processDriverData return early, which
// keeps these tests on the DQ records.
jest.mock('../../shared/placeholderDomains', () => ({ isPlaceholderEmail: () => true }));

const { onApplicationSubmitted, onApplicationUpdated } = require('../../driverSync');

const PATH = 'companies/co1/applications/app1/dq_files/license_front';
const OLD = { name: 'cdl-old.jpg', url: 'https://storage.example.test/old', storagePath: 'companies/co1/applications/app1/cdl-front-old.jpg' };
const NEW = { name: 'cdl-new.jpg', url: 'https://storage.example.test/new', storagePath: 'companies/co1/applications/app1/cdl-front-new.jpg' };

beforeEach(() => { mockWrites.length = 0; });

it('files a new upload of a type whose entry was removed, and shows it', async () => {
    await onApplicationUpdated({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: {
            before: { data: () => ({ 'cdl-front': OLD }) },
            after: { data: () => ({ 'cdl-front': NEW }) },
        },
    });

    expect(mockWrites).toEqual([{
        path: PATH,
        data: expect.objectContaining({ url: NEW.url, storagePath: NEW.storagePath, isSynced: true, removedAt: 'DELETE_FIELD' }),
        options: { merge: true },
    }]);
});

it('files nothing when no upload changed', async () => {
    await onApplicationUpdated({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: {
            before: { data: () => ({ 'cdl-front': OLD, status: 'New Application' }) },
            after: { data: () => ({ 'cdl-front': OLD, status: 'Reviewed' }) },
        },
    });

    expect(mockWrites).toEqual([]);
});

it('files an arriving application\'s uploads unmarked', async () => {
    await onApplicationSubmitted({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: {
            data: () => ({
                // A valid drawn signature, so the trigger does not reject the application.
                signature: `data:image/png;base64,${'A'.repeat(50)}`,
                'cdl-front': NEW,
            }),
        },
    });

    const dqWrites = mockWrites.filter(({ path }) => path.includes('/dq_files/'));
    expect(dqWrites).toEqual([{
        path: PATH,
        data: expect.objectContaining({ url: NEW.url, removedAt: 'DELETE_FIELD' }),
        options: { merge: true },
    }]);
});

// What the wizard has stored since 2026-09-08: the file's path, never a link.
const GUEST = { name: 'cdl.jpg', storagePath: 'companies/co1/applications/guest_uploads/1760000000000_ab12cd_cdl.jpg' };

it('files an arriving application\'s upload that has a path and no link', async () => {
    await onApplicationSubmitted({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: { data: () => ({ signature: `data:image/png;base64,${'A'.repeat(50)}`, 'cdl-front': GUEST }) },
    });

    const dqWrites = mockWrites.filter(({ path }) => path.includes('/dq_files/'));
    expect(dqWrites).toEqual([{
        path: PATH,
        data: expect.objectContaining({ storagePath: GUEST.storagePath, fileName: 'cdl.jpg', isSynced: true }),
        options: { merge: true },
    }]);
});

it('files a path-only upload added after the application arrived', async () => {
    await onApplicationUpdated({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: { before: { data: () => ({}) }, after: { data: () => ({ 'cdl-front': GUEST }) } },
    });

    expect(mockWrites).toEqual([expect.objectContaining({ path: PATH })]);
});


it('files nothing when only the link of the same upload was signed again', async () => {
    await onApplicationUpdated({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: {
            before: { data: () => ({ 'cdl-front': { ...GUEST, url: 'https://signed.example.test/a' } }) },
            after: { data: () => ({ 'cdl-front': { ...GUEST, url: 'https://signed.example.test/b' } }) },
        },
    });

    expect(mockWrites).toEqual([]);
});

it('takes no other company\'s path for an upload', async () => {
    const foreign = { name: 'x.jpg', storagePath: 'companies/co2/applications/guest_uploads/1760000000000_ab12cd_x.jpg' };
    await onApplicationUpdated({
        params: { companyId: 'co1', applicationId: 'app1' },
        data: { before: { data: () => ({}) }, after: { data: () => ({ 'cdl-front': foreign }) } },
    });

    expect(mockWrites).toEqual([]);
});
