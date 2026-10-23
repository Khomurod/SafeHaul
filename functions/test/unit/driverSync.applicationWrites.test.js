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
const mockState = { guardExists: false, recruiterLinks: {}, referralLinks: {}, members: [], users: {} };
jest.mock('../../firebaseAdmin', () => {
    const docRef = (path) => ({
        path,
        collection: (name) => colRef(`${path}/${name}`),
        get: async () => {
            const [, linkId] = path.match(/^recruiter_links\/(.+)$/) || [];
            const [, userId] = path.match(/^users\/(.+)$/) || [];
            const [, referralId] = path.match(/^companies\/co1\/referral_links\/(.+)$/) || [];
            const found = linkId ? mockState.recruiterLinks[linkId]
                : userId ? mockState.users[userId]
                    : referralId ? mockState.referralLinks[referralId] : undefined;
            return { exists: Boolean(found), data: () => found || {} };
        },
        set: async (data) => { mockWrites.push({ kind: 'set', path, data }); },
        update: async (data) => { mockWrites.push({ kind: 'update', path, data }); },
    });
    const colRef = (path, filters = {}) => ({
        doc: (id) => docRef(`${path}/${id}`),
        where: (field, _op, value) => colRef(path, { ...filters, [field]: value }),
        limit() { return this; },
        get: async () => {
            const docs = path === 'memberships'
                ? mockState.members
                    .filter((m) => Object.entries(filters).every(([field, value]) => m[field] === value))
                    .map((m) => ({ data: () => m }))
                : [];
            return { empty: docs.length === 0, docs };
        },
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
    mockState.members = [];
    mockState.users = {};
    mockState.referralLinks = {};
});

it('writes nothing to a signed application it has nothing to change on', async () => {
    await submit({ signature: SIGNATURE });

    expect(applicationWrites()).toEqual([]);
    expect(mockWrites.filter(({ kind }) => kind === 'create')).toEqual([
        { kind: 'create', path: 'processing_status/app_co1_app1', data: expect.objectContaining({ companyId: 'co1', applicationId: 'app1' }) },
    ]);
});

it("assigns an application to its recruiter link's member, with the name, in one write", async () => {
    mockState.recruiterLinks = { 'link-1': { userId: 'artificial-recruiter', companyId: 'co1' } };
    mockState.members = [{ userId: 'artificial-recruiter', companyId: 'co1', role: 'recruiter' }];
    mockState.users = { 'artificial-recruiter': { name: 'Riley Recruiter' } };

    await submit({ signature: SIGNATURE, recruiterCode: 'link-1' });

    expect(applicationWrites()).toEqual([
        { kind: 'update', path: APP_PATH, data: { assignedTo: 'artificial-recruiter', assignedToName: 'Riley Recruiter' } },
    ]);
});

it("does not assign through another company's link", async () => {
    mockState.recruiterLinks = { 'link-2': { userId: 'other-recruiter', companyId: 'co2' } };
    mockState.members = [{ userId: 'other-recruiter', companyId: 'co2', role: 'recruiter' }];

    await submit({ signature: SIGNATURE, recruiterCode: 'link-2' });

    expect(applicationWrites()).toEqual([]);
});

it('writes nothing for a code nobody owns, rather than the code as the assignee', async () => {
    await submit({ signature: SIGNATURE, recruiterCode: 'NOSUCH' });

    expect(applicationWrites()).toEqual([]);
});

it("assigns the older ?recruiter= link's user only when they are on this company's team", async () => {
    mockState.members = [{ userId: 'team-uid', companyId: 'co1', role: 'hr_user' }];
    mockState.users = { 'team-uid': { displayName: 'Taylor Team' } };

    await submit({ signature: SIGNATURE, recruiterCode: 'team-uid' });
    expect(applicationWrites()).toEqual([
        { kind: 'update', path: APP_PATH, data: { assignedTo: 'team-uid', assignedToName: 'Taylor Team' } },
    ]);

    mockWrites.length = 0;
    await submit({ signature: SIGNATURE, recruiterCode: 'outsider-uid' });
    expect(applicationWrites()).toEqual([]);
});

it('names a member without a profile name by their email, and assigns nobody it cannot name', async () => {
    mockState.recruiterLinks = { 'link-3': { userId: 'nameless', companyId: 'co1' } };
    mockState.members = [{ userId: 'nameless', companyId: 'co1', role: 'recruiter' }];
    mockState.users = { nameless: { email: 'riley@example.com' } };

    await submit({ signature: SIGNATURE, recruiterCode: 'link-3' });
    expect(applicationWrites()).toEqual([
        { kind: 'update', path: APP_PATH, data: { assignedTo: 'nameless', assignedToName: 'riley@example.com' } },
    ]);

    mockWrites.length = 0;
    mockState.users = { nameless: { name: '   ', displayName: ' ', email: ' riley@example.com ' } };
    await submit({ signature: SIGNATURE, recruiterCode: 'link-3' });
    expect(applicationWrites()).toEqual([
        { kind: 'update', path: APP_PATH, data: { assignedTo: 'nameless', assignedToName: 'riley@example.com' } },
    ]);

    mockWrites.length = 0;
    mockState.users = {};
    await submit({ signature: SIGNATURE, recruiterCode: 'link-3' });
    expect(applicationWrites()).toEqual([]);
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

describe('a driver referral link', () => {
    const LINK = { companyId: 'co1', code: 'ABCD2345', referrerName: 'Rita Referrer', createdBy: 'rec-1', active: true };

    it('records the referral and assigns its creator, in one write', async () => {
        mockState.referralLinks = { ABCD2345: LINK };
        mockState.members = [{ userId: 'rec-1', companyId: 'co1', role: 'recruiter' }];
        mockState.users = { 'rec-1': { name: 'Riley Recruiter' } };

        await submit({ signature: SIGNATURE, referralCode: 'abcd2345' });

        expect(applicationWrites()).toEqual([{
            kind: 'update',
            path: APP_PATH,
            data: { referral: { code: 'ABCD2345', referrerName: 'Rita Referrer' }, assignedTo: 'rec-1', assignedToName: 'Riley Recruiter' },
        }]);
    });

    it('records the referral alone when its creator has left the team, and nothing for a switched-off link', async () => {
        mockState.referralLinks = { ABCD2345: LINK, ZZZZ9999: { ...LINK, code: 'ZZZZ9999', active: false } };

        await submit({ signature: SIGNATURE, referralCode: 'ABCD2345' });
        expect(applicationWrites()).toEqual([
            { kind: 'update', path: APP_PATH, data: { referral: { code: 'ABCD2345', referrerName: 'Rita Referrer' } } },
        ]);

        mockWrites.length = 0;
        await submit({ signature: SIGNATURE, referralCode: 'ZZZZ9999' });
        expect(applicationWrites()).toEqual([]);
    });

    it('records the referral on an application that already has its recruiter, leaving the recruiter', async () => {
        mockState.referralLinks = { ABCD2345: LINK };
        mockState.members = [{ userId: 'rec-1', companyId: 'co1', role: 'recruiter' }];
        mockState.users = { 'rec-1': { name: 'Riley Recruiter' } };

        await submit({ signature: SIGNATURE, referralCode: 'ABCD2345', assignedTo: 'rec-9', assignedToName: 'Sam' });

        expect(applicationWrites()).toEqual([
            { kind: 'update', path: APP_PATH, data: { referral: { code: 'ABCD2345', referrerName: 'Rita Referrer' } } },
        ]);
    });

    it('keeps only the referral the server finds, never one the applicant wrote', async () => {
        mockState.referralLinks = { ABCD2345: LINK };
        const forged = { code: 'FAKE2345', referrerName: 'Nobody' };

        await submit({ signature: SIGNATURE, referral: forged });
        expect(applicationWrites()).toEqual([
            { kind: 'update', path: APP_PATH, data: { referral: 'DELETE_FIELD' } },
        ]);

        mockWrites.length = 0;
        await submit({ signature: SIGNATURE, referral: forged, referralCode: 'ABCD2345' });
        expect(applicationWrites()).toEqual([
            { kind: 'update', path: APP_PATH, data: { referral: { code: 'ABCD2345', referrerName: 'Rita Referrer' } } },
        ]);
    });

    it("lets a recruiter link's member take the application, keeping the referral", async () => {
        mockState.referralLinks = { ABCD2345: LINK };
        mockState.recruiterLinks = { 'link-1': { userId: 'rec-2', companyId: 'co1' } };
        mockState.members = [
            { userId: 'rec-1', companyId: 'co1', role: 'recruiter' },
            { userId: 'rec-2', companyId: 'co1', role: 'recruiter' },
        ];
        mockState.users = { 'rec-2': { name: 'Robin' } };

        await submit({ signature: SIGNATURE, recruiterCode: 'link-1', referralCode: 'ABCD2345' });

        expect(applicationWrites()).toEqual([{
            kind: 'update',
            path: APP_PATH,
            data: { referral: { code: 'ABCD2345', referrerName: 'Rita Referrer' }, assignedTo: 'rec-2', assignedToName: 'Robin' },
        }]);
    });
});

