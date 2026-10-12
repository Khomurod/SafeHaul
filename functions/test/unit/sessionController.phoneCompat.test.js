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
