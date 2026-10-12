const mockAssertCompanyAdmin = jest.fn().mockResolvedValue(true);
const mockEnqueueWorker = jest.fn().mockResolvedValue(true);
const mockCheckRateLimit = jest.fn().mockResolvedValue(true);
const mockBuildLeadQueries = jest.fn();
const mockGetAll = jest.fn();

const mockSessionSet = jest.fn().mockResolvedValue(true);
const mockSessionUpdate = jest.fn().mockResolvedValue(true);

function makeTargetDoc(id) {
    return { id };
}

const mockSessionRef = {
    id: 'session-1',
    set: mockSessionSet,
    update: mockSessionUpdate,
    collection: jest.fn(() => ({
        doc: jest.fn((id) => makeTargetDoc(id))
    }))
};

const mockBatchWrites = [];

const mockDb = {
    getAll: mockGetAll,
    batch: jest.fn(() => ({
        set: jest.fn((ref, data) => mockBatchWrites.push({ id: ref.id, data })),
        delete: jest.fn(),
        commit: jest.fn().mockResolvedValue(true),
    })),
    collection: jest.fn(() => ({
        doc: jest.fn(() => ({
            collection: jest.fn((name) => {
                if (name === 'bulk_sessions') {
                    return { doc: jest.fn(() => mockSessionRef) };
                }
                if (name === 'sms_sent_phones') {
                    return { doc: jest.fn((id) => ({ id })) };
                }
                return { doc: jest.fn((id) => ({ id })) };
            })
        }))
    }))
};

const mockAdmin = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true }),
            increment: (n) => ({ __increment: n }),
        },
        Timestamp: {
            fromDate: (d) => d,
        },
    },
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

jest.mock('../../bulkActions/services/queueService', () => ({
    enqueueWorker: (...args) => mockEnqueueWorker(...args)
}));

jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: (...args) => mockCheckRateLimit(...args)
}));

jest.mock('../../bulkActions/helpers/queryBuilder', () => ({
    buildLeadQueries: (...args) => mockBuildLeadQueries(...args)
}));

const sessionController = require('../../bulkActions/controllers/sessionController');

describe('sessionController phone compatibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAll.mockReset();
        mockBatchWrites.length = 0;
    });

    it('initBulkSession leaves out a lead texted inside the window whose last bulk message is older', async () => {
        const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
        mockBuildLeadQueries.mockReturnValue([{
            select: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
                docs: [
                    { id: 'texted', data: () => ({ phone: '(555) 000-0001', lastBulkMessageAt: daysAgo(90), lastContactedAt: daysAgo(1) }) },
                    { id: 'quiet', data: () => ({ phone: '(555) 000-0002', lastBulkMessageAt: daysAgo(90) }) },
                ],
                size: 2,
            }),
        }]);
        mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => ({ id: ref.id, exists: false, data: () => undefined })));

        await sessionController.initBulkSession({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { leadType: 'leads', excludeRecentDays: '7' },
                config: { method: 'sms', message: 'Hi' },
            },
        });

        expect(mockSessionSet).toHaveBeenCalledWith(expect.objectContaining({ targetIds: ['quiet'] }));
    });

    it('initBulkSession import path excludes repeated same canonical number with legacy ledger key', async () => {
        const now = new Date();
        mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => {
            const isLegacyMatch = ref.id === '15551234567';
            return {
                id: ref.id,
                exists: isLegacyMatch,
                data: () => isLegacyMatch ? { lastSentAt: now } : undefined,
            };
        }));

        const result = await sessionController.initBulkSession({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: {
                    leadType: 'import',
                    excludeRecentDays: '7'
                },
                config: {
                    method: 'sms',
                    message: 'Hello there'
                },
                rawData: [
                    { firstName: 'A', phone: '+1 (555) 123-4567' },
                    { firstName: 'B', phone: '5551234567' }, // same canonical as first row
                    { firstName: 'C', phone: '5559990000' } // should remain
                ]
            }
        });

        // Two rows share same canonical phone and should both be filtered
        expect(result.filteredCount).toBe(2);
        expect(result.targetCount).toBe(1);
        expect(mockSessionSet).toHaveBeenCalledWith(expect.objectContaining({
            targetIds: expect.arrayContaining([expect.stringMatching(/^imp_2_/)])
        }));
        expect(mockEnqueueWorker).toHaveBeenCalled();
    });

    it('initBulkSession import path skips numbers messaged in the last 7 days when the window was left as shown', async () => {
        const now = new Date();
        mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => ({
            id: ref.id,
            exists: ref.id === '+15551234567',
            data: () => (ref.id === '+15551234567' ? { lastSentAt: now } : undefined),
        })));

        // The upload screen shows "Last 7 Days" without the recruiter choosing it,
        // so the filters arrive without excludeRecentDays.
        const result = await sessionController.initBulkSession({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { leadType: 'import' },
                config: { method: 'sms', message: 'Hello there' },
                rawData: [
                    { firstName: 'A', phone: '(555) 123-4567' },
                    { firstName: 'B', phone: '5559990000' },
                ],
            },
        });

        expect(result.filteredCount).toBe(1);
        expect(result.targetCount).toBe(1);
    });

    it('initBulkSession import path counts a row that both ledgers found once', async () => {
        const emailKey = Buffer.from('pat@example.com').toString('base64url');
        mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => {
            const hit = ref.id === '+15551234567' || ref.id === emailKey;
            return { id: ref.id, exists: hit, data: () => (hit ? { lastSentAt: new Date() } : undefined) };
        }));

        const result = await sessionController.initBulkSession({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { leadType: 'import', excludeRecentDays: '7' },
                config: { method: 'email', message: 'Hello there', subject: 'Hello' },
                rawData: [
                    { firstName: 'Pat', phone: '(555) 123-4567', email: 'pat@example.com' },
                    { firstName: 'Lee', phone: '5559990000', email: 'lee@example.com' },
                ],
            },
        });

        expect(result.filteredCount).toBe(1);
        expect(result.targetCount).toBe(1);
    });

    it('initBulkSession import path keeps the SMS ledger matches when the email ledger cannot be read', async () => {
        const emailKeys = new Set(['pat@example.com', 'lee@example.com'].map((e) => Buffer.from(e).toString('base64url')));
        const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockGetAll.mockImplementation(async (...refs) => {
            if (refs.some((ref) => emailKeys.has(ref.id))) throw new Error('email_sent_addresses unavailable');
            return refs.map((ref) => {
                const hit = ref.id === '+15551234567';
                return { id: ref.id, exists: hit, data: () => (hit ? { lastSentAt: new Date() } : undefined) };
            });
        });

        const result = await sessionController.initBulkSession({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                filters: { leadType: 'import', excludeRecentDays: '7' },
                config: { method: 'email', message: 'Hello there', subject: 'Hello' },
                rawData: [
                    { firstName: 'Pat', phone: '(555) 123-4567', email: 'pat@example.com' },
                    { firstName: 'Lee', phone: '5559990000', email: 'lee@example.com' },
                ],
            },
        });

        expect(result.filteredCount).toBe(1);
        expect(result.targetCount).toBe(1);
        errors.mockRestore();
    });

    it('initBulkSession import path leaves out the rows the recruiter un-ticked, and stores nothing for them', async () => {
        const result = await sessionController.initBulkSession({
            auth: { uid: 'u1' },
            data: {
                companyId: 'co1',
                // The preview names a row without an id after its place in the list.
                filters: { leadType: 'import', excludeRecentDays: 'off', excludedLeadIds: ['import_1', 'row-c'] },
                config: { method: 'sms', message: 'Hello there' },
                rawData: [
                    { firstName: 'A', phone: '5551110001' },
                    { firstName: 'B', phone: '5551110002' },
                    { id: 'row-c', firstName: 'C', phone: '5551110003' },
                    { firstName: 'D', phone: '5551110004' },
                ],
            },
        });

        expect(result.targetCount).toBe(2);
        expect(result.filteredCount).toBe(0);
        const { targetIds } = mockSessionSet.mock.calls[0][0];
        expect(targetIds).toEqual([expect.stringMatching(/^imp_0_/), expect.stringMatching(/^imp_3_/)]);
        expect(mockBatchWrites.map((write) => write.data.firstName)).toEqual(['A', 'D']);
    });
});

// One launch messages at most 2,000 recipients, counted after every exclusion,
// and a larger audience is refused before anything is written.
describe('initBulkSession launch limit', () => {
    const phoneOf = (i) => `+1555${String(i).padStart(7, '0')}`;
    const leadsQuery = (count, from = 0) => ({
        select: jest.fn().mockReturnThis(),
        get: jest.fn().mockResolvedValue({
            docs: Array.from({ length: count }, (_, i) => ({ id: `lead${from + i}`, data: () => ({ phone: phoneOf(from + i) }) })),
            size: count,
        }),
    });
    const rows = (count) => Array.from({ length: count }, (_, i) => ({ firstName: `R${i}`, phone: phoneOf(i) }));
    const launch = (filters, rawData) => sessionController.initBulkSession({
        auth: { uid: 'u1' },
        data: { companyId: 'co1', filters, config: { method: 'sms', message: 'Hello there' }, rawData },
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetAll.mockReset();
        mockBatchWrites.length = 0;
        mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => ({ id: ref.id, exists: false, data: () => undefined })));
    });

    it('launches an audience of exactly 2,000', async () => {
        mockBuildLeadQueries.mockReturnValue([leadsQuery(2000)]);

        const result = await launch({ leadType: 'leads' });

        expect(result.targetCount).toBe(2000);
    });

    it('refuses an audience of 2,001 before the session exists', async () => {
        mockBuildLeadQueries.mockReturnValue([leadsQuery(2001)]);

        await expect(launch({ leadType: 'leads' })).rejects.toMatchObject({
            code: 'invalid-argument',
            message: expect.stringContaining('at most 2,000 recipients, and this audience has 2,001. Narrow the filters'),
        });
        expect(mockSessionSet).not.toHaveBeenCalled();
        expect(mockEnqueueWorker).not.toHaveBeenCalled();
    });

    it('holds Limit Volume to the whole audience when the filters split into two queries', async () => {
        // "Not contacted since" splits the filters into two queries
        // (`buildLeadQueries`), and each query takes Limit Volume on its own.
        mockBuildLeadQueries.mockReturnValue([leadsQuery(1500), leadsQuery(1500, 1500)]);

        const result = await launch({ leadType: 'leads', campaignLimit: '2000' });

        expect(result.targetCount).toBe(2000);
        expect(mockSessionSet).toHaveBeenCalledWith(expect.objectContaining({
            targetIds: expect.arrayContaining(['lead0', 'lead1499', 'lead1500']),
        }));
    });

    it('refuses an uploaded list of 2,001 before any row is written', async () => {
        await expect(launch({ leadType: 'import', excludeRecentDays: 'off' }, rows(2001))).rejects.toMatchObject({
            code: 'invalid-argument',
            message: expect.stringContaining('this audience has 2,001. Upload the list in parts'),
        });
        expect(mockBatchWrites).toHaveLength(0);
        expect(mockSessionSet).not.toHaveBeenCalled();
    });

    it('counts an uploaded list after the rows the ledger leaves out', async () => {
        // 2,100 rows, 100 of them texted today: 2,000 recipients, inside the limit.
        const recent = new Set(rows(100).map((row) => row.phone));
        mockGetAll.mockImplementation(async (...refs) => refs.map((ref) => {
            const hit = recent.has(ref.id);
            return { id: ref.id, exists: hit, data: () => (hit ? { lastSentAt: new Date() } : undefined) };
        }));

        const result = await launch({ leadType: 'import', excludeRecentDays: '7' }, rows(2100));

        expect(result.filteredCount).toBe(100);
        expect(result.targetCount).toBe(2000);
    });
});
