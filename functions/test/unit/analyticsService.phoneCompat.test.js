const mockAssertCompanyAdmin = jest.fn().mockResolvedValue(true);
const mockBuildLeadQueries = jest.fn();
const mockGetAll = jest.fn();

const makeDocRef = (id) => ({ id });

const mockDb = {
    getAll: mockGetAll,
    collection: jest.fn(() => ({
        doc: jest.fn(() => ({
            collection: jest.fn(() => ({
                doc: jest.fn((id) => makeDocRef(id))
            }))
        }))
    }))
};

const mockAdmin = {
    firestore: {
        Timestamp: {
            fromDate: (d) => d
        }
    }
};

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (opts, handler) => handler,
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: mockAdmin,
    db: mockDb
}));

jest.mock('../../bulkActions/helpers/auth', () => ({
    assertCompanyAdmin: (...args) => mockAssertCompanyAdmin(...args)
}));

jest.mock('../../bulkActions/helpers/queryBuilder', () => ({
    buildLeadQueries: (...args) => mockBuildLeadQueries(...args)
}));

const analyticsService = require('../../bulkActions/services/analyticsService');

function makeQueryFromDocs(docs) {
    return {
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
            docs: docs.map((d) => ({
                id: d.id,
                data: () => d.data
            }))
        })
    };
}

function mockLedgerDocs(existsById) {
    mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => {
        const data = existsById[ref.id];
        return {
            id: ref.id,
            exists: !!data,
            data: () => data,
        };
    }));
}

describe('analyticsService phone compatibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('checkImportPhones detects legacy-key-only hit when input is canonical', async () => {
        mockLedgerDocs({
            '15551234567': { lastSentAt: new Date() },
        });

        const result = await analyticsService.checkImportPhones({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                phones: ['+15551234567'],
                excludeRecentDays: '7'
            }
        });

        expect(result.excludedPhones).toEqual(['+15551234567']);
    });

    it('checkImportPhones detects canonical-key-only hit when input is legacy format', async () => {
        mockLedgerDocs({
            '+15551234567': { lastSentAt: new Date() },
        });

        const result = await analyticsService.checkImportPhones({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                phones: ['5551234567'],
                excludeRecentDays: '7'
            }
        });

        expect(result.excludedPhones).toEqual(['5551234567']);
    });

    it('getFilterCount stays correct when both canonical and legacy docs exist for same number', async () => {
        mockBuildLeadQueries.mockReturnValue([
            makeQueryFromDocs([
                {
                    id: 'lead1',
                    data: { phone: '(555) 123-4567' }
                }
            ])
        ]);
        mockLedgerDocs({
            '+15551234567': { lastSentAt: new Date() },
            '15551234567': { lastSentAt: new Date() },
            '5551234567': { lastSentAt: new Date() },
        });

        const result = await analyticsService.getFilterCount({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { excludeRecentDays: '7' }
            }
        });

        // Single lead should be excluded once, not over-counted
        expect(result).toEqual({ count: 0, alreadyMessaged: 1 });
    });

    it('getFilteredLeadsPage remains consistent under mixed ledger key styles', async () => {
        mockBuildLeadQueries.mockReturnValue([
            makeQueryFromDocs([
                {
                    id: 'lead1',
                    data: { firstName: 'A', phone: '+1 (555) 123-4567' }
                },
                {
                    id: 'lead2',
                    data: { firstName: 'B', phone: '+1 (555) 999-0000' }
                }
            ])
        ]);

        mockLedgerDocs({
            '5551234567': { lastSentAt: new Date() }, // legacy key for lead1 only
        });

        const result = await analyticsService.getFilteredLeadsPage({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { excludeRecentDays: '7' },
                pageSize: 50
            }
        });

        expect(result.leads.map((l) => l.id)).toEqual(['lead2']);
    });

    it('non-exclusion path stays unchanged when excludeRecentDays is off', async () => {
        mockBuildLeadQueries.mockReturnValue([
            {
                count: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ data: () => ({ count: 3 }) })
                })),
                get: jest.fn(),
            }
        ]);

        const result = await analyticsService.getFilterCount({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { excludeRecentDays: 'off' }
            }
        });

        expect(result.count).toBe(3);
        expect(mockGetAll).not.toHaveBeenCalled();
    });

    const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

    const { emailLedgerKey } = require('../../bulkActions/helpers/recentlyMessaged');

    it('a logged call is not a message: the count and the preview keep the lead', async () => {
        const docs = [
            { id: 'called', data: { firstName: 'C', phone: '(555) 000-0001', lastContactedAt: daysAgo(1) } },
        ];
        mockBuildLeadQueries.mockImplementation(() => [makeQueryFromDocs(docs)]);
        mockLedgerDocs({});
        const filters = { excludeRecentDays: '7' };

        const count = await analyticsService.getFilterCount({ auth: { uid: 'u1' }, data: { companyId: 'co1', filters } });
        const page = await analyticsService.getFilteredLeadsPage({ auth: { uid: 'u1' }, data: { companyId: 'co1', filters, pageSize: 50 } });

        expect(count).toEqual({ count: 1, alreadyMessaged: 0 });
        expect(page.leads.map((l) => l.id)).toEqual(['called']);
    });

    it('an email campaign leaves out the emailed, not the texted, and says how many', async () => {
        const docs = [
            { id: 'texted', data: { firstName: 'T', phone: '(555) 000-0001', email: 'tess@example.com' } },
            { id: 'emailed', data: { firstName: 'E', phone: '(555) 000-0002', email: 'Eve@Example.com' } },
        ];
        mockBuildLeadQueries.mockImplementation(() => [makeQueryFromDocs(docs)]);
        mockLedgerDocs({
            '+15550000001': { lastSentAt: daysAgo(1) },
            [emailLedgerKey('eve@example.com')]: { lastSentAt: daysAgo(1) },
        });
        const data = { companyId: 'co1', filters: { excludeRecentDays: '7' }, method: 'email' };

        const count = await analyticsService.getFilterCount({ auth: { uid: 'u1' }, data });
        const page = await analyticsService.getFilteredLeadsPage({ auth: { uid: 'u1' }, data: { ...data, pageSize: 50 } });
        const sms = await analyticsService.getFilterCount({ auth: { uid: 'u1' }, data: { ...data, method: 'sms' } });

        expect(count).toEqual({ count: 1, alreadyMessaged: 1 });
        expect(page.leads.map((l) => l.id)).toEqual(['texted']);
        expect(sms).toEqual({ count: 1, alreadyMessaged: 1 });
    });

    it('checkImportPhones names the uploaded rows the campaign\'s channel reached', async () => {
        mockLedgerDocs({
            '+15550000001': { lastSentAt: daysAgo(1) },
            [emailLedgerKey('eve@example.com')]: { lastSentAt: daysAgo(1) },
        });
        const recipients = [
            { key: 'import_0', phone: '5550000001', email: 'tess@example.com' },
            { key: 'row-7', phone: '', email: 'eve@example.com' },
        ];
        const ask = (method) => analyticsService.checkImportPhones({
            auth: { uid: 'u1' },
            data: { companyId: 'co1', recipients, method, excludeRecentDays: '7' },
        });

        expect(await ask('sms')).toEqual({ excludedKeys: ['import_0'] });
        expect(await ask('email')).toEqual({ excludedKeys: ['row-7'] });
    });

    it('the count reads a window it does not know as 7 days, as the launch does', async () => {
        mockBuildLeadQueries.mockImplementation(() => [makeQueryFromDocs([
            { id: 'month', data: { phone: '(555) 000-0003' } },
            { id: 'days', data: { phone: '(555) 000-0004' } },
        ])]);
        mockLedgerDocs({
            '+15550000003': { lastSentAt: daysAgo(30) },
            '+15550000004': { lastSentAt: daysAgo(3) },
        });

        const count = await analyticsService.getFilterCount({
            auth: { uid: 'u1' },
            data: { companyId: 'co1', filters: { excludeRecentDays: 'fortnight' } },
        });

        expect(count).toEqual({ count: 1, alreadyMessaged: 1 });
    });
});
