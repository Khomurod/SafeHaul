// The survey that decides whether the temporary operator action is still needed.
//
// It exists because a hard-coded "56 remaining" is a claim about production that
// starts rotting immediately, and an operator reading a stale number cannot tell.
// So these cases care about one thing above all: the count comes from the records,
// and "complete" is only ever reported when it is actually true.

jest.mock('firebase-functions/v2/https', () => ({
    onCall: jest.fn((optsOrFn, maybeFn) => (typeof maybeFn === 'function' ? maybeFn : optsOrFn)),
    HttpsError: class HttpsError extends Error {
        constructor(code, message) { super(message); this.code = code; }
    },
}));

jest.mock('firebase-functions', () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockStore = {
    companies: {},      // companyId -> { companyName }
    applications: {},   // `${companyId}/${appId}` -> data | null (null = unreadable)
    snapshots: {},      // `${companyId}/${appId}` -> snapshot data
    pdfs: new Set(),    // storage paths
    pdfError: false,
};

const mockAppRef = (companyId, appId) => ({
    id: appId,
    path: `${companyId}/${appId}`,
    // A query snapshot exposes `.ref`; the survey reads ids from the query and
    // then re-reads through the refs, exactly as Firestore does.
    get ref() { return this; },
    collection: () => ({
        doc: () => ({
            // A submission/v1 ref, resolved by getAll below.
            __snapshotKey: `${companyId}/${appId}`,
        }),
    }),
});

jest.mock('../../firebaseAdmin', () => ({
    admin: {},
    storage: {
        bucket: () => ({
            file: (path) => ({
                exists: async () => {
                    if (mockStore.pdfError) throw new Error('storage unavailable');
                    return [mockStore.pdfs.has(path)];
                },
            }),
        }),
    },
    db: {
        // Resolves both kinds of ref this module passes in: an application ref
        // (fetching its data) and a submission/v1 ref (fetching the record).
        getAll: async (...args) => {
            const refs = args.filter((arg) => arg && (arg.__snapshotKey || arg.path));
            return refs.map((ref) => {
                if (ref.__snapshotKey) {
                    const data = mockStore.snapshots[ref.__snapshotKey];
                    return {
                        id: ref.__snapshotKey.split('/')[1],
                        exists: data !== undefined,
                        data: () => data,
                    };
                }
                const raw = mockStore.applications[ref.path];
                return {
                    id: ref.path.split('/')[1],
                    exists: raw !== undefined,
                    data: () => {
                        if (raw === null) throw new Error('unreadable document');
                        return raw;
                    },
                };
            });
        },
        collection: (name) => {
            if (name !== 'companies') throw new Error(`unexpected collection ${name}`);
            return {
                select: () => ({
                    get: async () => {
                        const docs = Object.entries(mockStore.companies).map(([id, data]) => ({
                            id, data: () => data,
                        }));
                        return { docs, size: docs.length, empty: docs.length === 0 };
                    },
                }),
                doc: (companyId) => ({
                    collection: () => ({
                        select: () => ({
                            limit: () => ({
                                get: async () => {
                                    const docs = Object.keys(mockStore.applications)
                                        .filter((key) => key.startsWith(`${companyId}/`))
                                        .map((key) => mockAppRef(companyId, key.split('/')[1]));
                                    return { docs, size: docs.length, empty: docs.length === 0 };
                                },
                            }),
                        }),
                    }),
                }),
            };
        },
    },
}));

const { surveyHistoricalReconstruction } = require('../../historicalReconstructionSurvey');

const CO = 'co-1';
const pdfPath = (appId) => `application_originals/${CO}/${appId}/v1.pdf`;

const superAdmin = (data = {}) => ({
    auth: { uid: 'super-1', token: { globalRole: 'super_admin', roles: {} } },
    data,
});

const submitted = { 'final-certification': 'yes', signature: 'data:image/png;base64,AAAA' };
const draft = { 'final-certification': null, signature: null };

beforeEach(() => {
    jest.clearAllMocks();
    mockStore.companies = { [CO]: { companyName: 'Northwind Freight' } };
    mockStore.applications = {};
    mockStore.snapshots = {};
    mockStore.pdfs = new Set();
    mockStore.pdfError = false;
});

describe('authorization', () => {
    it('requires authentication', async () => {
        await expect(surveyHistoricalReconstruction({ data: {} }))
            .rejects.toMatchObject({ code: 'unauthenticated' });
    });

    // Platform-wide record counts are super-admin information.
    it('refuses a company admin', async () => {
        await expect(surveyHistoricalReconstruction({
            auth: { uid: 'staff-1', token: { roles: { [CO]: 'company_admin' } } },
            data: {},
        })).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('accepts a super admin whose role sits under `roles`', async () => {
        const res = await surveyHistoricalReconstruction({
            auth: { uid: 'super-1', token: { roles: { globalRole: 'super_admin' } } },
            data: {},
        });
        expect(res.success).toBe(true);
    });
});

describe('counting what is left', () => {
    it('counts a submitted application with no record as remaining', async () => {
        mockStore.applications[`${CO}/app-1`] = submitted;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals.remaining).toBe(1);
        expect(res.totals.neverSubmitted).toBe(0);
        expect(res.complete).toBe(false);
    });

    // The distinction the whole migration is built on: a draft has nothing to
    // preserve, and writing a record for it would take sequence 1 from the
    // submission the driver may yet make.
    it('does not count a draft as remaining', async () => {
        mockStore.applications[`${CO}/app-1`] = draft;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals.remaining).toBe(0);
        expect(res.totals.neverSubmitted).toBe(1);
    });

    it('counts an application that already has its record as preserved, not remaining', async () => {
        mockStore.applications[`${CO}/app-1`] = submitted;
        mockStore.snapshots[`${CO}/app-1`] = { provenance: { source: 'reconstructed' } };
        mockStore.pdfs.add(pdfPath('app-1'));

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals).toMatchObject({ preserved: 1, reconstructed: 1, remaining: 0 });
    });

    it('tells a reconstruction apart from a live submission', async () => {
        mockStore.applications[`${CO}/app-1`] = submitted;
        mockStore.snapshots[`${CO}/app-1`] = { provenance: { source: 'reconstructed' } };
        mockStore.pdfs.add(pdfPath('app-1'));
        mockStore.applications[`${CO}/app-2`] = submitted;
        mockStore.snapshots[`${CO}/app-2`] = { provenance: { source: 'submission' } };
        mockStore.pdfs.add(pdfPath('app-2'));

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals).toMatchObject({ reconstructed: 1, liveSubmissions: 1 });
    });

    // An unreadable document needs a person, and must never be filed as a draft:
    // that would hide it behind a benign count no later run would surface.
    it('reports an unreadable application separately, with its id', async () => {
        mockStore.applications[`${CO}/app-broken`] = null;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals.unreadable).toBe(1);
        expect(res.totals.neverSubmitted).toBe(0);
        expect(res.companies[0].unreadableApplicationIds).toEqual(['app-broken']);
        expect(res.complete).toBe(false);
    });

    it('leaves a company with no applications out of the report', async () => {
        mockStore.companies['co-empty'] = { companyName: 'No Applications Ltd' };
        mockStore.applications[`${CO}/app-1`] = submitted;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.companies.map((row) => row.companyId)).toEqual([CO]);
        expect(res.totals.companiesWithApplications).toBe(1);
    });

    it('puts the companies with the most outstanding work first', async () => {
        mockStore.companies['co-2'] = { companyName: 'Second' };
        mockStore.applications[`${CO}/a`] = submitted;
        mockStore.applications['co-2/a'] = submitted;
        mockStore.applications['co-2/b'] = submitted;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.companies.map((row) => row.remaining)).toEqual([2, 1]);
    });
});

describe('a preserved record with no official PDF is unfinished too', () => {
    beforeEach(() => {
        mockStore.applications[`${CO}/app-1`] = submitted;
        mockStore.snapshots[`${CO}/app-1`] = { provenance: { source: 'reconstructed' } };
    });

    it('is counted as a missing PDF', async () => {
        const res = await surveyHistoricalReconstruction(superAdmin());
        expect(res.totals.missingPdfs).toBe(1);
        expect(res.complete).toBe(false);
    });

    it('is not counted once the document exists', async () => {
        mockStore.pdfs.add(pdfPath('app-1'));
        const res = await surveyHistoricalReconstruction(superAdmin());
        expect(res.totals.missingPdfs).toBe(0);
        expect(res.complete).toBe(true);
    });

    // Failing open here would retire the operator action on a storage blip.
    it('counts a PDF it cannot check as missing rather than present', async () => {
        mockStore.pdfs.add(pdfPath('app-1'));
        mockStore.pdfError = true;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals.missingPdfs).toBe(1);
        expect(res.complete).toBe(false);
    });
});

describe('reporting completion', () => {
    it('reports complete only when nothing is outstanding', async () => {
        mockStore.applications[`${CO}/app-1`] = submitted;
        mockStore.snapshots[`${CO}/app-1`] = { provenance: { source: 'reconstructed' } };
        mockStore.pdfs.add(pdfPath('app-1'));
        mockStore.applications[`${CO}/app-2`] = draft;

        const res = await surveyHistoricalReconstruction(superAdmin());

        expect(res.totals).toMatchObject({ remaining: 0, missingPdfs: 0, unreadable: 0 });
        expect(res.complete).toBe(true);
    });

    // The trap this closes: with the PDF half skipped, `missingPdfs: 0` means
    // "not checked". Reporting complete on that would retire the action while
    // official documents were still missing.
    it('never reports complete when the PDF check was skipped', async () => {
        mockStore.applications[`${CO}/app-1`] = submitted;
        mockStore.snapshots[`${CO}/app-1`] = { provenance: { source: 'reconstructed' } };

        const res = await surveyHistoricalReconstruction(superAdmin({ includePdfCheck: false }));

        expect(res.pdfCheckPerformed).toBe(false);
        expect(res.totals.missingPdfs).toBe(0);
        expect(res.complete).toBe(false);
    });

    it('is not complete while an application is still eligible', async () => {
        mockStore.applications[`${CO}/app-1`] = submitted;
        const res = await surveyHistoricalReconstruction(superAdmin());
        expect(res.complete).toBe(false);
    });
});

describe('privacy', () => {
    it('returns no applicant data — only ids, names and counts', async () => {
        mockStore.applications[`${CO}/app-1`] = {
            ...submitted,
            firstName: 'Marcus',
            ssn: '000-00-0000',
            dob: '1980-01-01',
            licenseNumber: 'D1234567',
        };

        const res = await surveyHistoricalReconstruction(superAdmin());
        const serialised = JSON.stringify(res);

        for (const secret of ['Marcus', '000-00-0000', '1980-01-01', 'D1234567', 'base64']) {
            expect(serialised).not.toContain(secret);
        }
    });
});
