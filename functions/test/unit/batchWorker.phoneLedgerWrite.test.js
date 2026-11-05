const smsDocIds = [];
// `fails`: the ledger write is refused (the send itself went out).
const mockLedger = { fails: false };
const mockSendSMS = jest.fn().mockResolvedValue(true);
const mockEnsureLoggedIn = jest.fn().mockResolvedValue(true);
// The pause after a send, answered at once (`sendPacing.js` keeps the real three seconds).
const mockPauseBeforeNextSend = jest.fn(async () => {});

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
                    data: () => ({ companyName: 'Test Co' })
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
                                    set: jest.fn(() => (mockLedger.fails
                                        ? Promise.reject(new Error('unavailable'))
                                        : Promise.resolve(true)))
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

jest.mock('../../bulkActions/workers/sendPacing', () => ({
    ...jest.requireActual('../../bulkActions/workers/sendPacing'),
    pauseBeforeNextSend: mockPauseBeforeNextSend,
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
        expect(mockPauseBeforeNextSend).toHaveBeenCalledTimes(1);
    });
});

// A worker's log names the lead, never its number: a Cloud Functions log is
// read by everyone who can read the project's logs.
describe('batchWorker logs without the recipient', () => {
    const req = {
        headers: { 'x-safehaul-internal-auth': 'unit-test-secret', 'x-appengine-queuename': 'bulk-actions-queue' },
        body: { companyId: 'co1', sessionId: 's1', workerGeneration: 1 },
    };
    const res = () => ({ status: jest.fn().mockReturnThis(), send: jest.fn() });
    const logged = () => [console.log, console.warn, console.error]
        .flatMap((spy) => spy.mock.calls.flat())
        .map((value) => (value instanceof Error ? `${value.message} ${value.stack}` : String(value)))
        .join('\n');

    beforeEach(() => {
        jest.clearAllMocks();
        smsDocIds.length = 0;
        mockLedger.fails = false;
        mockSendSMS.mockImplementation(async () => true);
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        mockLedger.fails = false;
        mockSendSMS.mockImplementation(async () => true);
        jest.restoreAllMocks();
    });

    it('names the lead, not the number, when the sent-numbers ledger cannot be written', async () => {
        mockLedger.fails = true;

        await batchWorker.processBulkBatch(req, res());
        await new Promise((resolve) => setImmediate(resolve));

        expect(smsDocIds).toContain('+15551234567');
        expect(logged()).toContain('lead1');
        expect(logged()).not.toContain('5551234567');
    });

    it('names the lead, not the number, when the provider refuses a text and names the number', async () => {
        mockSendSMS.mockImplementation(async () => { throw new Error('Invalid destination +15551234567 (555) 123-4567'); });

        await batchWorker.processBulkBatch(req, res());

        expect(mockSendSMS).toHaveBeenCalled();
        expect(logged()).toContain('lead1');
        expect(logged()).not.toContain('5551234567');
        expect(logged()).not.toContain('123-4567');
    });
});
