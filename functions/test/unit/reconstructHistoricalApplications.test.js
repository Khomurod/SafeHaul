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
                if (key in store.snapshots) {
                    const error = new Error('6 ALREADY_EXISTS'); error.code = 6; throw error;
                }
                store.snapshots[key] = data;
            },
            async set(data, options) {
                const key = `${companyId}/${applicationId}/${name}/${id}`;
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
    });

    it('claims no acceptance for an application with no signature and no certification', async () => {
        seedCompany();
        seedApplication('app-1', { signature: null, 'final-certification': null });

        const result = await reconstructHistoricalApplications(superAdmin({ companyId: COMPANY_ID }));

        const snapshot = store.snapshots[`${COMPANY_ID}/app-1/v1`];
        for (const agreement of snapshot.agreements) {
            expect(agreement.accepted).toBe(false);
            expect(agreement.signature).toBeNull();
        }
        expect(result.unrecoverable.agreement_acceptance).toBe(1);
        expect(result.unrecoverable.signature).toBe(1);
    });
});
