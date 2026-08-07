// The migration itself: what it touches, what it refuses to touch, and what it
// does when run twice.
//
// A migration over evidentiary records has to be boring in exactly one way: it
// must only ever ADD. These tests are the proof that it does.

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

jest.mock('firebase-functions', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { assertStorableValue } = require('../helpers/firestoreValueRules');
const { decodeStoredSnapshot, findNestedArrayPaths } = require('../../shared/submissionSnapshotStorage');

const store = {
    companies: {},
    applications: {},   // `${companyId}/${applicationId}` -> data
    snapshots: {},      // `${companyId}/${applicationId}/${seq}` -> data
    dqFiles: {},
    pdfs: {},
};

const applicationRef = (companyId, applicationId) => ({
    id: applicationId,
    data: () => store.applications[`${companyId}/${applicationId}`],
    get ref() { return this; },
    async set(data, options) {
        const key = `${companyId}/${applicationId}`;
        store.applications[key] = options?.merge
            ? { ...store.applications[key], ...data }
            : data;
    },
    collection: (name) => ({
        where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
        doc: (id) => ({
            get: async () => {
                const key = `${companyId}/${applicationId}/${id}`;
                return name === 'submission' && key in store.snapshots
                    ? { exists: true, data: () => store.snapshots[key] }
                    : { exists: false, data: () => undefined };
            },
            async create(data) {
                const key = `${companyId}/${applicationId}/${id}`;
                // Real Firestore refuses a nested array. Without this the double
                // accepted snapshots production could not store.
                assertStorableValue(data, key);
                if (key in store.snapshots) {
                    const error = new Error('6 ALREADY_EXISTS'); error.code = 6; throw error;
                }
                store.snapshots[key] = data;
            },
            async set(data, options) {
                const key = `${companyId}/${applicationId}/${name}/${id}`;
                assertStorableValue(data, key);
                store.dqFiles[key] = options?.merge ? { ...store.dqFiles[key], ...data } : data;
            },
        }),
    }),
});

jest.mock('../../firebaseAdmin', () => ({
    admin: { firestore: { FieldValue: { serverTimestamp: () => '__ts__' } } },
    storage: {
        bucket: () => ({
            file: (path) => ({
                exists: async () => [path in store.pdfs],
                getMetadata: async () => [store.pdfs[path]?.options?.metadata || {}],
                save: async (buffer, options) => {
                    if (options?.preconditionOpts?.ifGenerationMatch === 0 && path in store.pdfs) {
                        const error = new Error('precondition failed'); error.code = 412; throw error;
                    }
                    store.pdfs[path] = { buffer, options };
                },
            }),
        }),
    },
    db: {
        collection: () => ({
            doc: (companyId) => ({
                get: async () => (companyId in store.companies
                    ? { exists: true, data: () => store.companies[companyId] }
                    : { exists: false }),
                collection: () => {
                    const query = (after, max) => ({
                        orderBy: () => query(after, max),
                        limit: (count) => query(after, count),
                        startAfter: (cursor) => query(cursor, max),
                        get: async () => {
                            const ids = Object.keys(store.applications)
                                .filter((key) => key.startsWith(`${companyId}/`) && key.split('/').length === 2)
                                .map((key) => key.split('/')[1])
                                .sort()
                                .filter((id) => !after || id > after)
                                .slice(0, max ?? Infinity);
                            const docs = ids.map((id) => applicationRef(companyId, id));
                            return { empty: docs.length === 0, size: docs.length, docs };
                        },
                    });
                    return {
                        ...query(null, Infinity),
                        doc: (applicationId) => applicationRef(companyId, applicationId),
                    };
                },
            }),
        }),
    },
}));

const { reconstructHistoricalApplications, reconstructForCompany } = require('../../reconstructHistoricalApplications');

const COMPANY_ID = 'company-abc';

const seedCompany = () => {
    store.companies[COMPANY_ID] = {
        companyName: 'Northwind Freight Systems',
        customQuestions: [{ id: 'q-1', label: 'Willing to run a dedicated lane?' }],
    };
};

const seedApplication = (id, over = {}) => {
    store.applications[`${COMPANY_ID}/${id}`] = {
        applicantId: id,
        companyId: COMPANY_ID,
        submittedAt: '2024-03-02T11:04:00.000Z',
        firstName: 'Marcus',
        lastName: 'Delgado',
        signature: 'data:image/png;base64,AAAA',
        'final-certification': 'yes',
        ...over,
    };
};

const superAdmin = (data) => ({
    auth: { uid: 'super-1', token: { globalRole: 'super_admin', roles: {} } },
    data,
});

beforeEach(() => {
    jest.clearAllMocks();
    store.companies = {};
    store.applications = {};
    store.snapshots = {};
    store.dqFiles = {};
    store.pdfs = {};
});

describe('reconstructHistoricalApplications — authorization and inputs', () => {
    it('requires authentication', async () => {
        await expect(reconstructHistoricalApplications({ data: {} }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    it('is super-admin only', async () => {
        await expect(reconstructHistoricalApplications({
            auth: { uid: 'staff-1', token: { roles: { [COMPANY_ID]: 'company_admin' } } },
            data: { companyId: COMPANY_ID },
        })).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('refuses to run across every tenant at once', async () => {
        // A migration that touches every company at once has no safe first run.
        await expect(reconstructHistoricalApplications(superAdmin({})))
            .rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('reports an unknown company rather than doing nothing quietly', async () => {
        await expect(reconstructHistoricalApplications(superAdmin({ companyId: 'nope' })))
            .rejects.toMatchObject({ code: 'not-found' });
    });
});

describe('reconstructHistoricalApplications — what it does', () => {
    it('gives a historical application a record and a preserved PDF', async () => {
        seedCompany();
        seedApplication('app-1');

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(result).toMatchObject({ scanned: 1, reconstructed: 1, skipped: 0, failed: 0, pdfs: 1 });
        const snapshot = store.snapshots[`${COMPANY_ID}/app-1/v1`];
        expect(snapshot.provenance.source).toBe('reconstructed');
        expect(snapshot.agreementVersion).toBe('legacy-1');
        expect(Object.keys(store.pdfs)).toEqual([`application_originals/${COMPANY_ID}/app-1/v1.pdf`]);
        expect(store.applications[`${COMPANY_ID}/app-1`].submissionRecord.source).toBe('reconstructed');
    });

    it('NEVER replaces an existing record — a live submission is untouchable', async () => {
        seedCompany();
        seedApplication('app-1');
        store.snapshots[`${COMPANY_ID}/app-1/v1`] = { frozen: true, provenance: { source: 'submission' } };

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(result).toMatchObject({ scanned: 1, reconstructed: 0, skipped: 1 });
        expect(store.snapshots[`${COMPANY_ID}/app-1/v1`].provenance.source).toBe('submission');
        expect(store.pdfs).toEqual({});
    });

    it('is idempotent: a second run changes nothing', async () => {
        seedCompany();
        seedApplication('app-1');
        seedApplication('app-2');

        const first = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));
        const pdfsAfterFirst = { ...store.pdfs };
        const second = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(first.reconstructed).toBe(2);
        expect(second).toMatchObject({ reconstructed: 0, skipped: 2 });
        expect(store.pdfs[`application_originals/${COMPANY_ID}/app-1/v1.pdf`].buffer)
            .toBe(pdfsAfterFirst[`application_originals/${COMPANY_ID}/app-1/v1.pdf`].buffer);
    });

    it('writes nothing at all on a dry run, but reports what it would do', async () => {
        seedCompany();
        seedApplication('app-1');

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID, dryRun: true }));

        expect(result).toMatchObject({ dryRun: true, reconstructed: 1, pdfs: 0 });
        expect(store.snapshots).toEqual({});
        expect(store.pdfs).toEqual({});
        // And it still reports what could not be recovered.
        expect(result.unrecoverable.definition_at_submission).toBe(1);
        expect(result.unrecoverable.individual_agreement_acceptance).toBe(1);
    });

    it('reports where to resume when it hits its ceiling', async () => {
        seedCompany();
        for (let i = 0; i < 5; i += 1) seedApplication(`app-${i}`);

        const first = await reconstructHistoricalApplications(
            superAdmin({ companyId: COMPANY_ID, maxApplications: 2 }),
        );
        expect(first).toMatchObject({ scanned: 2, truncated: true, lastApplicationId: 'app-1' });

        const second = await reconstructHistoricalApplications(superAdmin({
            companyId: COMPANY_ID, startAfterApplicationId: first.lastApplicationId, maxApplications: 10,
        }));
        expect(second.scanned).toBe(3);
        expect(Object.keys(store.snapshots)).toHaveLength(5);
    });

    it('keeps going when one application cannot be rebuilt, and names it', async () => {
        seedCompany();
        seedApplication('app-1');
        seedApplication('app-2');
        // An application whose data cannot be read at all.
        store.applications[`${COMPANY_ID}/app-2`] = null;

        const result = await reconstructForCompany({
            companyId: COMPANY_ID,
            company: store.companies[COMPANY_ID],
            maxApplications: 10,
        });

        expect(result.reconstructed).toBe(1);
        expect(result.failed).toBe(1);
        expect(result.errors[0].applicationId).toBe('app-2');
        // An unreadable application must be REPORTED, never quietly filed as
        // "never submitted" — that would hide a broken record behind a benign
        // count that no later run would surface again.
        expect(result.unsubmitted).toBe(0);
    });

    it('writes no record for an application that was never submitted', async () => {
        // A draft, or an outreach lead record. There is no submission to
        // preserve, and writing one would take sequence 1 — so if this person
        // later applies for real, their genuine submission would land on `v2`
        // and be recorded as a resubmission, permanently.
        seedCompany();
        seedApplication('app-1', { signature: null, 'final-certification': null });

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(store.snapshots[`${COMPANY_ID}/app-1/v1`]).toBeUndefined();
        expect(result.reconstructed).toBe(0);
        expect(result.unsubmitted).toBe(1);
        expect(result.failed).toBe(0);
    });

    it('leaves sequence 1 free, so a later real submission is still the original', async () => {
        seedCompany();
        seedApplication('app-1', { signature: null, 'final-certification': null });

        await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        // The driver comes back and actually submits.
        seedApplication('app-1', { signature: 'data:image/png;base64,AAAA', 'final-certification': 'agreed' });
        const second = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(second.reconstructed).toBe(1);
        expect(store.snapshots[`${COMPANY_ID}/app-1/v1`]).toBeDefined();
        expect(store.snapshots[`${COMPANY_ID}/app-1/v2`]).toBeUndefined();
    });

    it('counts an empty-string signature as no signature', async () => {
        seedCompany();
        seedApplication('app-1', { signature: '   ', 'final-certification': null });

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(result.unsubmitted).toBe(1);
        expect(result.reconstructed).toBe(0);
    });

    it('still reconstructs a certified application that has no recorded date', async () => {
        // A missing date is reported as unrecoverable — it must never be the
        // reason an application is treated as unsubmitted.
        seedCompany();
        seedApplication('app-1', {
            'final-certification': 'agreed',
            signature: null,
            signatureDate: null,
            submittedAt: null,
            createdAt: null,
        });

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(result.reconstructed).toBe(1);
        expect(result.unsubmitted).toBe(0);
        expect(result.unrecoverable.submitted_at).toBe(1);
    });
});

// The defect that stopped the production migration dead: 56 of 88 in-scope
// applications could not be written at all.
//
// A repeating answer is rows of cells — an array of arrays — and Firestore's rule
// is that an array cannot contain another array. So any driver who listed a
// previous address, an employer, a violation or an accident produced a snapshot
// the database refused, with `INVALID_ARGUMENT: Property array contains an
// invalid nested entity`. Nothing caught it: the whole suite passed, because no
// test had ever seeded a repeating field.
describe('applications whose driver filled in a repeating section', () => {
    const withEmployers = (over = {}) => ({
        employers: [
            { companyName: 'Cascade Haulage', position: 'Driver', startDate: '2019-04', endDate: '2021-06' },
            { companyName: 'Rimrock Transport', position: 'Driver', startDate: '2021-07', endDate: '2023-02' },
        ],
        previousAddresses: [
            { street: '1 Depot Road', city: 'Boise', state: 'ID', zip: '83702' },
        ],
        ...over,
    });

    it('reconstructs one, rather than failing on the write', async () => {
        seedCompany();
        seedApplication('app-1', withEmployers());

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(result.errors).toEqual([]);
        expect(result.failed).toBe(0);
        expect(result.reconstructed).toBe(1);
        expect(result.pdfs).toBe(1);
    });

    it('keeps the rows intact and readable after the round trip', async () => {
        seedCompany();
        seedApplication('app-1', withEmployers());
        await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        const stored = store.snapshots[`${COMPANY_ID}/app-1/v1`];

        // The property that actually matters is not the shape, it is that
        // Firestore would accept it.
        expect(findNestedArrayPaths(stored)).toEqual([]);

        // Stored rows are wrapped; that representation must not be what a
        // renderer sees.
        const storedEmployers = stored.sections
            .flatMap((section) => section.answers)
            .find((answer) => answer.fieldId === 'employers');
        expect(Array.isArray(storedEmployers.rows[0].cells)).toBe(true);

        const employers = decodeStoredSnapshot(stored)
            .sections.flatMap((section) => section.answers)
            .find((answer) => answer.fieldId === 'employers');

        // Two employers, each a list of labelled cells — exactly what the driver
        // submitted and what every renderer reads.
        expect(employers.rows).toHaveLength(2);
        expect(employers.rows[0].map((cell) => cell.label)).toContain('Employer');
        expect(employers.rows[0].every((cell) => typeof cell.displayValue === 'string')).toBe(true);
        expect(employers.rows.map((row) => row.find((cell) => cell.label === 'Employer').displayValue))
            .toEqual(['Cascade Haulage', 'Rimrock Transport']);
    });

    it('is still idempotent: a second run adds nothing and rewrites no PDF', async () => {
        seedCompany();
        seedApplication('app-1', withEmployers());
        await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));
        const firstPdf = Object.keys(store.pdfs)[0];

        const again = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        expect(again.reconstructed).toBe(0);
        expect(again.skipped).toBe(1);
        expect(again.failed).toBe(0);
        expect(Object.keys(store.pdfs)).toEqual([firstPdf]);
    });
});
