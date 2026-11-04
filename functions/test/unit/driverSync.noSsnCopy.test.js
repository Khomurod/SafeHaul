/**
 * What driver sync writes to the driver's profile for a new lead or a signed
 * application (`processDriverData`).
 *
 * It works out which profile the person is (an Auth user's by email, else one
 * matched by phone, else the record's own id) and adds the record's company to
 * that profile's `companyIds`: staff reads of a driver profile are built on it
 * (`readerSharesCompany`), so it must keep being set.
 *
 * It leaves no copy of the person's details behind. The staging copy it used to
 * add under `drivers/{id}/pending_updates` was read by nothing, and once held
 * the SSN; every copy is one more place the details live.
 */
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: (_opts, fn) => fn,
    onDocumentUpdated: (_opts, fn) => fn,
}));

// `mock`-prefixed so the jest.mock factories may reference them (jest hoisting rule).
const mockWrites = [];
const mockQueries = [];
const mockState = { authUid: null, phoneMatch: null, missingProfiles: [] };
jest.mock('../../firebaseAdmin', () => {
    const docRef = (path) => ({
        path,
        collection: (name) => colRef(`${path}/${name}`),
        get: async () => ({ exists: false, data: () => ({}) }),
        set: async (data) => { mockWrites.push({ kind: 'set', path, data }); },
        update: async (data) => {
            if (mockState.missingProfiles.includes(path)) throw Object.assign(new Error('NOT_FOUND'), { code: 5 });
            mockWrites.push({ kind: 'update', path, data });
        },
    });
    const colRef = (path) => ({
        doc: (id) => docRef(`${path}/${id}`),
        where: (field, op, value) => {
            mockQueries.push({ path, field, op, value });
            return {
                limit: () => ({
                    get: async () => (mockState.phoneMatch
                        ? { empty: false, docs: [{ id: mockState.phoneMatch }] }
                        : { empty: true, docs: [] }),
                }),
            };
        },
        add: async (data) => { mockWrites.push({ kind: 'add', path, data }); },
    });
    return {
        admin: {
            firestore: {
                FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP', arrayUnion: (...values) => ({ arrayUnion: values }) },
                Timestamp: { fromMillis: (ms) => ({ toMillis: () => ms }) },
            },
        },
        db: {
            collection: (name) => colRef(name),
            runTransaction: async (callback) => callback({
                get: async () => ({ exists: false, data: () => ({}) }),
                create: (ref, data) => { mockWrites.push({ kind: 'create', path: ref.path, data }); },
            }),
        },
        auth: {
            getUserByEmail: async () => {
                if (mockState.authUid) return { uid: mockState.authUid };
                throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' });
            },
        },
    };
});
// Their own suites cover these; here they only have to stay out of the way.
jest.mock('../../shared/leadApplicationLink', () => ({ linkApplicantLead: async () => null }));
jest.mock('../../shared/dqUploads', () => ({ fileDqUploads: async () => 0, uploadKeys: () => [] }));

const { onApplicationSubmitted, onCompanyLeadSubmitted } = require('../../driverSync');

const PERSON = Object.freeze({
    firstName: 'Dana',
    lastName: 'Driver',
    email: 'dana@example.test',
    phone: '555-0100',
    ssn: '123-45-6789',
    cdlNumber: 'D1234567',
    companyId: 'co1',
});
const SIGNATURE = `data:image/png;base64,${'A'.repeat(50)}`;

const submitLead = (data, leadId = 'lead1') => onCompanyLeadSubmitted({
    params: { companyId: 'co1', leadId },
    data: { data: () => data },
});
const submitApplication = (data) => onApplicationSubmitted({
    params: { companyId: 'co1', applicationId: 'app1' },
    data: { data: () => data },
});
const profileWrites = () => mockWrites.filter(({ path }) => path.startsWith('drivers/'));
const stamp = (path) => ({ kind: 'update', path, data: { companyIds: { arrayUnion: ['co1'] } } });

beforeEach(() => {
    mockWrites.length = 0;
    mockQueries.length = 0;
    mockState.authUid = null;
    mockState.phoneMatch = null;
    mockState.missingProfiles = [];
});

it("adds a lead's company to the driver profile, and writes nothing else there", async () => {
    await submitLead(PERSON);

    expect(profileWrites()).toEqual([stamp('drivers/lead1')]);
    expect(mockWrites.filter(({ kind }) => kind === 'add')).toEqual([]);
});

it("stamps the profile of the Auth user a signed application's email belongs to", async () => {
    mockState.authUid = 'driver-uid';

    await submitApplication({ ...PERSON, signature: SIGNATURE });

    expect(profileWrites()).toEqual([stamp('drivers/driver-uid')]);
});

it('stamps the profile a phone-only lead’s number already has', async () => {
    mockState.phoneMatch = 'driver-by-phone';

    await submitLead({ ...PERSON, email: 'dana@placeholder.safehaulapp.com' });

    expect(mockQueries).toEqual([{ path: 'drivers', field: 'personalInfo.phone', op: '==', value: PERSON.phone }]);
    expect(profileWrites()).toEqual([stamp('drivers/driver-by-phone')]);
});

it("leaves no copy of the driver's details, the SSN least of all", async () => {
    mockState.authUid = 'driver-uid';
    await submitLead(PERSON);
    await submitApplication({ ...PERSON, signature: SIGNATURE });

    const written = JSON.stringify(mockWrites);
    for (const detail of [PERSON.ssn, PERSON.firstName, PERSON.email, PERSON.phone, PERSON.cdlNumber]) {
        expect(written).not.toContain(detail);
    }
    expect(written).not.toMatch(/pending_updates|ssn/i);
});

it('treats a profile that does not exist yet as nothing to stamp, not as an error', async () => {
    mockState.missingProfiles = ['drivers/lead2'];
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(submitLead(PERSON, 'lead2')).resolves.toBeUndefined();

    expect(profileWrites()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
});

it('writes nothing to a profile for a record with no company, or nobody to identify', async () => {
    await submitLead({ ...PERSON, companyId: undefined });
    await submitLead({ ...PERSON, email: '', phone: '' });

    expect(profileWrites()).toEqual([]);
});
