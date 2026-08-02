const smsDocIds = [];
const mockSendSMS = jest.fn().mockResolvedValue(true);
const mockEnsureLoggedIn = jest.fn().mockResolvedValue(true);

process.env.BULK_WORKER_SECRET = 'unit-test-secret';

const sessionData = {
    status: 'active',
    config: { method: 'sms', message: 'Hello [Driver Name]' },
    leadSourceType: 'leads',
    createdBy: 'u1',
    targetIds: ['lead1'],
    progress: { currentPointer: 0, processedCount: 0, totalCount: 1 },
    workerGeneration: 1,
};

const sessionRef = {
    __type: 'session',
    get: jest.fn().mockResolvedValue({
        exists: true,
        data: () => sessionData
    }),
    update: jest.fn().mockResolvedValue(true),
    collection: jest.fn((name) => {
        if (name === 'logs') {
            return {
                doc: jest.fn((id) => ({
                    __type: 'log',
                    id,
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    set: jest.fn().mockResolvedValue(true)
                }))
            };
        }
        return { doc: jest.fn((id) => ({ id })) };
    })
};

const mockDb = {
    runTransaction: jest.fn(async (callback) => {
        const tx = {
            get: jest.fn(async (ref) => {
                if (ref && ref.__type === 'session') {
                    return { exists: true, data: () => sessionData };
                }
                if (ref && ref.__type === 'log') {
                    return { exists: false, data: () => ({}) };
                }
                return { exists: false, data: () => ({}) };
            }),
            update: jest.fn(),
            set: jest.fn(),
        };
        return callback(tx);
    }),
    collection: jest.fn((name) => {
        if (name !== 'companies') return {};
        return {
            doc: jest.fn(() => ({
                get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => ({ name: 'Test Co' })
                }),
                collection: jest.fn((sub) => {
                    if (sub === 'bulk_sessions') {
                        return { doc: jest.fn(() => sessionRef) };
                    }
                    if (sub === 'leads') {
                        return {
                            doc: jest.fn(() => ({
                                get: jest.fn().mockResolvedValue({
                                    exists: true,
                                    data: () => ({
                                        firstName: 'Alice',
                                        phone: '(555) 123-4567'
                                    })
                                }),
                                update: jest.fn().mockResolvedValue(true),
                            }))
                        };
                    }
                    if (sub === 'sms_sent_phones') {
                        return {
                            doc: jest.fn((id) => {
                                smsDocIds.push(id);
                                return {
                                    id,
                                    set: jest.fn().mockResolvedValue(true)
                                };
                            })
                        };
                    }
                    return { doc: jest.fn((id) => ({ id })) };
                })
            }))
        };
    })
};

const mockAdmin = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true }),
            increment: (n) => ({ __increment: n }),
        }
    }
};

jest.mock('firebase-functions/v2/https', () => ({
    onRequest: (opts, handler) => handler
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: mockAdmin,
    db: mockDb
}));

jest.mock('../../blacklist', () => ({
    isBlacklisted: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../integrations/factory', () => ({
    getAdapterForUser: jest.fn().mockResolvedValue({
        ensureLoggedIn: mockEnsureLoggedIn,
        sendSMS: mockSendSMS,
    })
}));

jest.mock('../../integrations/encryption', () => ({
    decrypt: jest.fn((v) => v)
}));

jest.mock('../../bulkActions/services/queueService', () => ({
    enqueueWorker: jest.fn().mockResolvedValue(true)
}));

const batchWorker = require('../../bulkActions/workers/batchWorker');

describe('batchWorker SMS ledger write canonicalization', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        smsDocIds.length = 0;
    });

    it('writes canonical sms_sent_phones key for formatted phone values', async () => {
        const req = {
            headers: {
                'x-safehaul-internal-auth': 'unit-test-secret',
                'x-appengine-queuename': 'bulk-actions-queue'
            },
            body: {
                companyId: 'co1',
                sessionId: 's1',
                workerGeneration: 1
            }
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn()
        };

        await batchWorker.processBulkBatch(req, res);

        expect(mockEnsureLoggedIn).toHaveBeenCalled();
        expect(mockSendSMS).toHaveBeenCalled();
        expect(smsDocIds).toContain('+15551234567');
    }, 15000);
});
