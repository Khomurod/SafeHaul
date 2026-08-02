

// =====================================================================
// MOCK SETUP — Matches the modular bulkActions/ directory structure
// =====================================================================

// --- Firebase Admin Mock ---
const firestoreMock = {
    settings: jest.fn(),
    collection: jest.fn(),
    doc: jest.fn(),
    batch: jest.fn(() => ({
        set: jest.fn(),
        delete: jest.fn(),
        commit: jest.fn().mockResolvedValue(true)
    })),
    runTransaction: jest.fn(),
    getAll: jest.fn().mockResolvedValue([]), // For sms_sent_phones checks
};

const mockCollectionFn = jest.fn(() => ({
    doc: mockDocFn,
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue({ docs: [], size: 0 }),
    add: jest.fn(),
}));

const mockDocFn = jest.fn(() => ({
    collection: mockCollectionFn,
    // Add default windowStart to prevent rateLimiter toMillis crash
    get: jest.fn().mockResolvedValue({ exists: true, data: () => ({ windowStart: { toMillis: () => 0 }, count: 0 }) }),
    set: jest.fn().mockResolvedValue(true),
    update: jest.fn().mockResolvedValue(true),
    id: 'mock-doc-id'
}));

firestoreMock.collection.mockImplementation(mockCollectionFn);
firestoreMock.doc.mockImplementation(mockDocFn);

const mockFirestoreFn = jest.fn(() => firestoreMock);
mockFirestoreFn.FieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    increment: (n) => ({ increment: n })
};
mockFirestoreFn.Timestamp = {
    fromDate: (date) => date,
    now: () => ({ toMillis: () => Date.now() }),
    fromMillis: (ms) => ({ toMillis: () => ms })
};
mockFirestoreFn.Filter = {
    or: (...args) => ({ or: args }),
    where: (field, op, val) => ({ field, op, val })
};

jest.mock('firebase-admin', () => ({
    apps: [{}], // Pretend app is initialized
    app: jest.fn(() => ({ options: { projectId: 'test-project' } })),
    initializeApp: jest.fn(),
    firestore: mockFirestoreFn,
    auth: jest.fn(() => ({
        getUser: jest.fn().mockResolvedValue({
            customClaims: {
                globalRole: 'super_admin',
                roles: { globalRole: 'super_admin' }
            }
        })
    }))
}));

// --- Mock firebaseAdmin.js (shared module) ---
jest.mock('../firebaseAdmin', () => ({
    admin: require('firebase-admin'),
    db: require('firebase-admin').firestore()
}));

// --- Mock firebase-admin/firestore and storage ---
jest.mock('firebase-admin/firestore', () => ({
    getFirestore: jest.fn(() => require('firebase-admin').firestore())
}));
jest.mock('firebase-admin/storage', () => ({
    getStorage: jest.fn()
}));

// --- Mock firebase-functions/v2/https ---
jest.mock('firebase-functions/v2/https', () => ({
    onRequest: jest.fn((opts, handler) => handler),
    onCall: jest.fn((opts, handler) => handler),
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
}));

// --- Mock Cloud Tasks (queueService dependency) ---
const mockCreateTask = jest.fn().mockResolvedValue([{}]);
jest.mock('@google-cloud/tasks', () => ({
    CloudTasksClient: jest.fn(() => ({
        queuePath: jest.fn((project, location, queue) =>
            `projects/${project}/locations/${location}/queues/${queue}`),
        createTask: mockCreateTask
    }))
}));

// --- Mock SMS/Integrations ---
const mockGetAdapterForUser = jest.fn();
jest.mock('../integrations/factory', () => ({
    getAdapterForUser: mockGetAdapterForUser
}));

jest.mock('../blacklist', () => ({
    isBlacklisted: jest.fn().mockResolvedValue(false)
}));

jest.mock('../integrations/encryption', () => ({
    decrypt: jest.fn(text => text)
}));

jest.mock('../utils/phoneUtils', () => ({
    normalizePhone: jest.fn(phone => phone ? phone.replace(/\D/g, '') : '')
}));

// --- Environment ---
process.env.GCLOUD_PROJECT = 'test-project';
process.env.FUNCTION_REGION = 'us-central1';
process.env.PROCESS_BULK_BATCH_URL = 'https://us-central1-test-project.cloudfunctions.net/processBulkBatch';
process.env.BULK_WORKER_SECRET = 'test-secret-for-unit-tests';

// =====================================================================
// IMPORT MODULE UNDER TEST
// =====================================================================
const bulkActions = require('../bulkActions');
const admin = require('firebase-admin');

// =====================================================================
// TESTS
// =====================================================================
describe('Bulk Actions Tests', () => {
    let db;

    beforeEach(() => {
        db = admin.firestore();
        jest.clearAllMocks();
        // Re-apply default mocks after clearAllMocks
        firestoreMock.collection.mockImplementation(mockCollectionFn);
        firestoreMock.getAll = jest.fn().mockResolvedValue([]);
        // AUDIT FIX: Reset runTransaction mock to prevent Test 2 from poisoning Test 3 & 4
        firestoreMock.runTransaction.mockImplementation(async (cb) => {
            const mockT = {
                get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                set: jest.fn(),
                update: jest.fn(),
                delete: jest.fn()
            };
            return await cb(mockT);
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ---------------------------------------------------------------
    // Test 1: initBulkSession enqueues worker with correct URL
    // ---------------------------------------------------------------
    it('should enqueue worker with correct URL in initBulkSession', async () => {
        const request = {
            data: {
                companyId: 'company123',
                filters: { leadType: 'leads' },
                config: { method: 'sms', message: 'Hello' }
            },
            auth: { uid: 'user123', token: { roles: { company123: 'company_admin' } } }
        };

        // Session doc mock
        const sessionDocMock = {
            id: 'session-abc',
            set: jest.fn().mockResolvedValue(true),
            update: jest.fn().mockResolvedValue(true),
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({ set: jest.fn(), get: jest.fn().mockResolvedValue({ exists: false }) }))
            }))
        };

        // Company doc mock
        const companyDocMock = {
            get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ name: 'Test Company', ownerId: 'user123' })
            }),
            collection: jest.fn((name) => {
                if (name === 'bulk_sessions') return { doc: jest.fn(() => sessionDocMock) };
                if (name === 'team') return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ role: 'company_admin' })
                        })
                    }))
                };
                return {
                    doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })),
                    where: jest.fn().mockReturnThis(),
                    select: jest.fn().mockReturnThis(),
                    get: jest.fn().mockResolvedValue({
                        docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                        size: 2
                    })
                };
            })
        };

        // Company leads query mock
        const leadsCollectionMock = {
            doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }) })),
            where: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
                docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                size: 2
            })
        };

        db.collection.mockImplementation((name) => {
            if (name === 'companies') return { doc: jest.fn(() => companyDocMock) };
            if (name === 'leads') return leadsCollectionMock;
            if (name === 'memberships') return {
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                get: jest.fn().mockResolvedValue({
                    docs: [{ data: () => ({ role: 'company_admin', companyId: 'company123' }) }]
                })
            };
            return leadsCollectionMock;
        });

        await bulkActions.initBulkSession(request);

        expect(mockCreateTask).toHaveBeenCalled();
        const taskCall = mockCreateTask.mock.calls[0][0];
        const task = taskCall.task;

        // Verify URL
        expect(task.httpRequest.url).toBe('https://us-central1-test-project.cloudfunctions.net/processBulkBatch');
    });

    // ---------------------------------------------------------------
    // Test 2: processBulkBatch completes session
    // ---------------------------------------------------------------
    it('should process batch and complete session (no next batch)', async () => {
        const req = {
            headers: {
                'x-appengine-queuename': 'bulk-actions-queue',
                'x-safehaul-internal-auth': process.env.BULK_WORKER_SECRET
            },
            body: { companyId: 'company123', sessionId: 'session123' }
        };
        const res = {
            status: jest.fn().mockReturnThis(),
            send: jest.fn()
        };

        const sessionData = {
            status: 'active',
            targetIds: ['lead0', 'lead1'],
            currentPointer: 0,
            config: { method: 'sms', message: 'Hello' },
            progress: { currentPointer: 0, processedCount: 0, totalCount: 2 },
            createdBy: 'user123',
            creatorId: 'user123',
            leadSourceType: 'leads'
        };

        const sessionRefMock = {
            get: jest.fn().mockResolvedValue({ exists: true, data: () => sessionData }),
            update: jest.fn().mockResolvedValue(true),
            collection: jest.fn((name) => {
                if (name === 'logs') return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({ exists: false }),
                        set: jest.fn().mockResolvedValue(true)
                    }))
                };
                return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({ exists: false }),
                        set: jest.fn().mockResolvedValue(true)
                    }))
                };
            })
        };

        // Transaction mock — returns batch claim
        db.runTransaction.mockImplementation(async (callback) => {
            const mockT = {
                get: jest.fn().mockResolvedValue({
                    exists: true,
                    data: () => sessionData
                }),
                update: jest.fn()
            };
            return await callback(mockT);
        });

        const companyDocMock = {
            get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ name: 'Test Company' })
            }),
            collection: jest.fn((name) => {
                if (name === 'bulk_sessions') return { doc: jest.fn(() => sessionRefMock) };
                if (name === 'leads') return {
                    doc: jest.fn((id) => ({
                        get: jest.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ firstName: 'John', phone: '1234567890' })
                        }),
                        update: jest.fn().mockResolvedValue(true)
                    }))
                };
                if (name === 'sms_sent_phones') return {
                    doc: jest.fn(() => ({ set: jest.fn().mockResolvedValue(true) }))
                };
                return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })) };
            })
        };

        const companiesCollectionMock = {
            doc: jest.fn(() => companyDocMock)
        };

        db.collection.mockImplementation((name) => {
            if (name === 'companies') return companiesCollectionMock;
            return {
                doc: jest.fn(() => ({
                    get: jest.fn().mockResolvedValue({ exists: false }),
                    set: jest.fn().mockResolvedValue(true),
                    update: jest.fn().mockResolvedValue(true)
                }))
            };
        });

        // Mock SMS adapter
        mockGetAdapterForUser.mockResolvedValue({
            sendSMS: jest.fn().mockResolvedValue(true),
            ensureLoggedIn: jest.fn().mockResolvedValue(true)
        });

        await bulkActions.processBulkBatch(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        // Session should be completed because we processed all 2 items
        expect(sessionRefMock.update).toHaveBeenCalledWith(expect.objectContaining({
            status: 'completed',
        }));
        // No next task should be enqueued since all items processed
        expect(mockCreateTask).not.toHaveBeenCalled();
    }, 30000); // Allow time for 3s delays per message

    // ---------------------------------------------------------------
    // Test 3: excludedLeadIds filtering
    // ---------------------------------------------------------------
    it('should exclude IDs in filters.excludedLeadIds', async () => {
        const request = {
            data: {
                companyId: 'company123',
                filters: {
                    leadType: 'leads',
                    excludedLeadIds: ['lead1']
                },
                config: { method: 'sms', message: 'Hello' }
            },
            auth: { uid: 'user123', token: { roles: { company123: 'company_admin' } } }
        };

        const sessionDocMock = {
            id: 'session-abc',
            set: jest.fn().mockResolvedValue(true),
            update: jest.fn().mockResolvedValue(true),
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({ set: jest.fn(), get: jest.fn().mockResolvedValue({ exists: false }) }))
            }))
        };

        const companyDocMock = {
            get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ name: 'Test Company', ownerId: 'user123' })
            }),
            collection: jest.fn((name) => {
                if (name === 'bulk_sessions') return { doc: jest.fn(() => sessionDocMock) };
                if (name === 'team') return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ role: 'company_admin' })
                        })
                    }))
                };
                return {
                    doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })),
                    where: jest.fn().mockReturnThis(),
                    select: jest.fn().mockReturnThis(),
                    limit: jest.fn().mockReturnThis(),
                    get: jest.fn().mockResolvedValue({
                        docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                        size: 2
                    })
                };
            })
        };

        // Company leads — return 2 leads (lead1 should be filtered out by excludedLeadIds)
        const leadsCollectionMock = {
            doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) }) })),
            where: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
                docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                size: 2
            })
        };

        db.collection.mockImplementation((name) => {
            if (name === 'companies') return { doc: jest.fn(() => companyDocMock) };
            if (name === 'leads') return leadsCollectionMock;
            if (name === 'memberships') return {
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                get: jest.fn().mockResolvedValue({
                    docs: [{ data: () => ({ role: 'company_admin', companyId: 'company123' }) }]
                })
            };
            return leadsCollectionMock;
        });

        const result = await bulkActions.initBulkSession(request);

        // lead1 excluded → only lead2 remains → count = 1
        expect(result.targetCount).toBe(1);
    });

    // ---------------------------------------------------------------
    // Test 4: Status mapping (status IDs → DB values)
    // ---------------------------------------------------------------
    it('should map status IDs to DB values', async () => {
        const request = {
            data: {
                companyId: 'company123',
                filters: {
                    leadType: 'leads',
                    status: ['new', 'contacted']
                },
                config: { method: 'sms', message: 'Hello' }
            },
            auth: { uid: 'user123', token: { roles: { company123: 'company_admin' } } }
        };

        const mockWhere = jest.fn().mockReturnThis();
        const sessionDocMock = {
            id: 'sess1',
            set: jest.fn().mockResolvedValue(true),
            update: jest.fn().mockResolvedValue(true),
            collection: jest.fn(() => ({
                doc: jest.fn(() => ({ set: jest.fn(), get: jest.fn().mockResolvedValue({ exists: false }) }))
            }))
        };

        const leadsCollectionMock = {
            doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })),
            where: mockWhere,
            select: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
                docs: [{ id: 'lead1', data: () => ({}) }],
                size: 1
            })
        };

        const companyDocMock = {
            get: jest.fn().mockResolvedValue({
                exists: true,
                data: () => ({ ownerId: 'user123' })
            }),
            collection: jest.fn((colName) => {
                if (colName === 'leads') return leadsCollectionMock;
                if (colName === 'bulk_sessions') return { doc: jest.fn(() => sessionDocMock) };
                if (colName === 'team') return {
                    doc: jest.fn(() => ({
                        get: jest.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ role: 'company_admin' })
                        })
                    }))
                };
                return { doc: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ exists: false }) })) };
            })
        };

        db.collection.mockImplementation((colName) => {
            if (colName === 'companies') return { doc: jest.fn(() => companyDocMock) };
            if (colName === 'memberships') return {
                where: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                get: jest.fn().mockResolvedValue({
                    docs: [{ data: () => ({ role: 'company_admin', companyId: 'company123' }) }]
                })
            };
            return leadsCollectionMock;
        });

        await bulkActions.initBulkSession(request);

        // Verify status mapping: 'new' -> 'New Application', 'contacted' -> 'Contacted'
        expect(mockWhere).toHaveBeenCalledWith('status', 'in', ['New Application', 'Contacted']);
    });
});
