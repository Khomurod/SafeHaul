// B4 coverage: the recursive worker must halt a session that exceeds the lifetime
// send ceiling instead of enqueuing another batch (runaway-cost circuit breaker).

process.env.BULK_WORKER_SECRET = 'unit-test-secret';
process.env.BULK_SESSION_MAX_SENDS = '2'; // tiny ceiling for the test

const mockSendSMS = jest.fn().mockResolvedValue(true);

// currentPointer (2) has already reached the ceiling (2), while total (5) is larger —
// so it is the ceiling, not normal completion, that must trigger the halt.
const sessionData = {
    status: 'active',
    config: { method: 'sms', message: 'Hi [Driver Name]' },
    leadSourceType: 'leads',
    createdBy: 'u1',
    targetIds: ['a', 'b', 'c', 'd', 'e'],
    progress: { currentPointer: 2, processedCount: 2 },
    workerGeneration: 1,
};

const sessionRef = {
    __type: 'session',
    get: jest.fn().mockResolvedValue({ exists: true, data: () => sessionData }),
    update: jest.fn().mockResolvedValue(true),
    collection: jest.fn(() => ({ doc: jest.fn((id) => ({ id })) })),
};

const mockDb = {
    runTransaction: jest.fn(async (callback) => {
        const tx = {
            get: jest.fn(async () => ({ exists: true, data: () => sessionData })),
            update: jest.fn(),
            set: jest.fn(),
        };
        return callback(tx);
    }),
    collection: jest.fn((name) => {
        if (name !== 'companies') return { doc: jest.fn(() => ({})) };
        return {
            doc: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Test Co' }) }),
                collection: jest.fn((sub) =>
                    sub === 'bulk_sessions'
                        ? { doc: jest.fn(() => sessionRef) }
                        : { doc: jest.fn((id) => ({ id })) }
                ),
            })),
        };
    }),
};

const mockAdmin = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true }),
            increment: (n) => ({ __increment: n }),
        },
    },
};

jest.mock('firebase-functions/v2/https', () => ({ onRequest: (opts, handler) => handler }));
jest.mock('../../firebaseAdmin', () => ({ admin: mockAdmin, db: mockDb }));
jest.mock('../../blacklist', () => ({ isBlacklisted: jest.fn().mockResolvedValue(false) }));
jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: jest.fn().mockResolvedValue({
        ensureLoggedIn: jest.fn().mockResolvedValue(true),
        sendSMS: mockSendSMS,
    }),
}));
jest.mock('../../integrations/encryption', () => ({ decrypt: jest.fn((v) => v) }));

const mockEnqueueWorker = jest.fn().mockResolvedValue(true);
jest.mock('../../bulkActions/services/queueService', () => ({ enqueueWorker: mockEnqueueWorker }));

const batchWorker = require('../../bulkActions/workers/batchWorker');

describe('batchWorker per-session ceiling (B4)', () => {
    beforeEach(() => jest.clearAllMocks());

    it('halts and marks the session failed once the lifetime ceiling is reached', async () => {
        const req = {
            headers: { 'x-safehaul-internal-auth': 'unit-test-secret' },
            body: { companyId: 'co1', sessionId: 's1', workerGeneration: 1 },
        };
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };

        await batchWorker.processBulkBatch(req, res);

        // Session marked failed with a ceiling reason.
        const failUpdate = sessionRef.update.mock.calls.find(
            ([arg]) => arg && arg.status === 'failed' && /ceiling/i.test(arg.error || '')
        );
        expect(failUpdate).toBeTruthy();

        // Circuit breaker: no further work and no next batch enqueued.
        expect(mockSendSMS).not.toHaveBeenCalled();
        expect(mockEnqueueWorker).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
    });
});
