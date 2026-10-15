/**
 * What `onApplicationSubmitted` writes to the application it was fired for.
 *
 * Every write to an application runs each of its update triggers, so the
 * trigger writes to it only what changes it: a recruiter link's assignment, or
 * a rejection for a missing signature. Its bookkeeping lives in
 * `processing_status`, the guard that keeps a replayed event from running twice.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

// `mock`-prefixed so the jest.mock factories may reference them (jest hoisting rule).
const mockWrites = [];
const mockState = { guardExists: false, recruiterLinks: {} };
jest.mock('../../firebaseAdmin', () => {
    const docRef = (path) => ({
        path,
        collection: (name) => colRef(`${path}/${name}`),
        get: async () => {
            const [, linkId] = path.match(/^recruiter_links\/(.+)$/) || [];
            const link = linkId ? mockState.recruiterLinks[linkId] : undefined;
            return { exists: Boolean(link), data: () => link || {} };
        },
        set: async (data) => { mockWrites.push({ kind: 'set', path, data }); },
        update: async (data) => { mockWrites.push({ kind: 'update', path, data }); },
    });
    const colRef = (path) => ({
        doc: (id) => docRef(`${path}/${id}`),
        where() { return this; },
        limit() { return this; },
        get: async () => ({ empty: true, docs: [] }),
        add: async (data) => { mockWrites.push({ kind: 'add', path, data }); },
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
                get: async () => ({ exists: mockState.guardExists, data: () => ({}) }),
                create: (ref, data) => { mockWrites.push({ kind: 'create', path: ref.path, data }); },
                update: (ref, data) => { mockWrites.push({ kind: 'update', path: ref.path, data }); },
            }),
        },
        auth: { getUserByEmail: async () => { throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); } },
    };
});

// A placeholder email with no phone makes processDriverData return early, which
// keeps these tests on the application's own writes.
jest.mock('../../shared/placeholderDomains', () => ({ isPlaceholderEmail: () => true }));

const { onApplicationSubmitted } = require('../../driverSync');

const APP_PATH = 'companies/co1/applications/app1';
const SIGNATURE = `data:image/png;base64,${'A'.repeat(50)}`;

const submit = (data) => onApplicationSubmitted({
    params: { companyId: 'co1', applicationId: 'app1' },
    data: { data: () => data },
});
const applicationWrites = () => mockWrites.filter(({ path }) => path === APP_PATH);

beforeEach(() => {
    mockWrites.length = 0;
    mockState.guardExists = false;
    mockState.recruiterLinks = {};
});

it('writes nothing to a signed application it has nothing to change on', async () => {
    await submit({ signature: SIGNATURE });

    expect(applicationWrites()).toEqual([]);
    expect(mockWrites.filter(({ kind }) => kind === 'create')).toEqual([
        { kind: 'create', path: 'processing_status/app_co1_app1', data: expect.objectContaining({ companyId: 'co1', applicationId: 'app1' }) },
    ]);
});

it("assigns an application to its recruiter link's member in one write", async () => {
    mockState.recruiterLinks = { 'link-1': { userId: 'artificial-recruiter' } };

    await submit({ signature: SIGNATURE, recruiterCode: 'link-1' });

    expect(applicationWrites()).toEqual([
        { kind: 'update', path: APP_PATH, data: { assignedTo: 'artificial-recruiter' } },
    ]);
});

it('still rejects an application without a valid signature, in one write', async () => {
    await submit({ signature: 'not-a-signature' });

    expect(applicationWrites()).toEqual([{
        kind: 'update',
        path: APP_PATH,
        data: expect.objectContaining({
            status: 'validation_error',
            'lifecycle.status': 'failed',
            'lifecycle.failureReason': 'invalid_signature',
        }),
    }]);
});

it('writes nothing for an event it has already processed', async () => {
    mockState.guardExists = true;

    await submit({ signature: SIGNATURE, recruiterCode: 'link-1' });

    expect(mockWrites).toEqual([]);
});
