// vitest globals (describe, it, expect, vi, etc.) available via globals: true config
const jestMock = { fn: vi.fn.bind(vi) };

// =====================================================================
// MOCK SETUP — Matches the modular bulkActions/ directory structure
// =====================================================================

// --- Firebase Admin Mock ---
const firestoreMock = {
    settings: jestMock.fn(),
    collection: jestMock.fn(),
    doc: jestMock.fn(),
    batch: jestMock.fn(() => ({
        set: jestMock.fn(),
        delete: jestMock.fn(),
        commit: jestMock.fn().mockResolvedValue(true)
    })),
    runTransaction: jestMock.fn(),
    getAll: jestMock.fn().mockResolvedValue([]), // For sms_sent_phones checks
};

const collectionFn = jestMock.fn(() => ({
    doc: docFn,
    where: jestMock.fn().mockReturnThis(),
    select: jestMock.fn().mockReturnThis(),
    limit: jestMock.fn().mockReturnThis(),
    get: jestMock.fn().mockResolvedValue({ docs: [], size: 0 }),
    add: jestMock.fn(),
}));

const docFn = jestMock.fn(() => ({
    collection: collectionFn,
    get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
    set: jestMock.fn().mockResolvedValue(true),
    update: jestMock.fn().mockResolvedValue(true),
    id: 'mock-doc-id'
}));

firestoreMock.collection.mockImplementation(collectionFn);
firestoreMock.doc.mockImplementation(docFn);

const firestoreFn = jestMock.fn(() => firestoreMock);
firestoreFn.FieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    increment: (n) => ({ increment: n })
};
firestoreFn.Timestamp = {
    fromDate: (date) => date,
};
firestoreFn.Filter = {
    or: (...args) => ({ or: args }),
    where: (field, op, val) => ({ field, op, val })
};

jestMock.mock('firebase-admin', () => ({
    apps: [{}], // Pretend app is initialized
    app: jestMock.fn(() => ({ options: { projectId: 'test-project' } })),
    initializeApp: jestMock.fn(),
    firestore: firestoreFn,
    auth: jestMock.fn()
}));

// --- Mock firebaseAdmin.js (shared module) ---
jestMock.mock('../firebaseAdmin', () => ({
    admin: require('firebase-admin'),
    db: require('firebase-admin').firestore()
}));

// --- Mock firebase-admin/firestore and storage ---
jestMock.mock('firebase-admin/firestore', () => ({
    getFirestore: jestMock.fn(() => require('firebase-admin').firestore())
}));
jestMock.mock('firebase-admin/storage', () => ({
    getStorage: jestMock.fn()
}));

// --- Mock firebase-functions/v2/https ---
jestMock.mock('firebase-functions/v2/https', () => ({
    onRequest: jestMock.fn((opts, handler) => handler),
    onCall: jestMock.fn((opts, handler) => handler),
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
}));

// --- Mock Cloud Tasks (queueService dependency) ---
const mockCreateTask = jestMock.fn().mockResolvedValue([{}]);
jestMock.mock('@google-cloud/tasks', () => ({
    CloudTasksClient: jestMock.fn(() => ({
        queuePath: jestMock.fn((project, location, queue) =>
            `projects/${project}/locations/${location}/queues/${queue}`),
        createTask: mockCreateTask
    }))
}));

// --- Mock SMS/Integrations ---
const mockGetAdapterForUser = jestMock.fn();
jestMock.mock('../integrations/factory', () => ({
    getAdapterForUser: mockGetAdapterForUser
}));

jestMock.mock('../blacklist', () => ({
    isBlacklisted: jestMock.fn().mockResolvedValue(false)
}));

jestMock.mock('../integrations/encryption', () => ({
    decrypt: jestMock.fn(text => text)
}));

jestMock.mock('../utils/phoneUtils', () => ({
    normalizePhone: jestMock.fn(phone => phone ? phone.replace(/\D/g, '') : '')
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
        jestMock.clearAllMocks();
        // Re-apply default mocks after clearAllMocks
        firestoreMock.collection.mockImplementation(collectionFn);
        firestoreMock.getAll = jestMock.fn().mockResolvedValue([]);
    });

    afterEach(() => {
        test.cleanup();
    });

    // ---------------------------------------------------------------
    // Test 1: initBulkSession enqueues worker with correct URL
    // ---------------------------------------------------------------
    it('should enqueue worker with correct URL in initBulkSession', async () => {
        const request = {
            data: {
                companyId: 'company123',
                filters: { leadType: 'global' },
                config: { method: 'sms', message: 'Hello' }
            },
            auth: { uid: 'user123', token: { roles: { company123: 'company_admin' } } }
        };

        // Mock the auth check (assertCompanyAdmin)
        const userDoc = {
            get: jestMock.fn().mockResolvedValue({
                exists: true,
                data: () => ({ role: 'company_admin', companyId: 'company123' })
            })
        };

        // Session doc mock
        const sessionDocMock = {
            id: 'session-abc',
            set: jestMock.fn().mockResolvedValue(true),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn(() => ({
                doc: jestMock.fn(() => ({ set: jestMock.fn(), get: jestMock.fn().mockResolvedValue({ exists: false }) }))
            }))
        };

        // Company doc mock
        const companyDocMock = {
            get: jestMock.fn().mockResolvedValue({
                exists: true,
                data: () => ({ name: 'Test Company', ownerId: 'user123' })
            }),
            collection: jestMock.fn((name) => {
                if (name === 'bulk_sessions') return { doc: jestMock.fn(() => sessionDocMock) };
                if (name === 'team') return {
                    doc: jestMock.fn(() => ({
                        get: jestMock.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ role: 'company_admin' })
                        })
                    }))
                };
                return {
                    doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: false }) })),
                    where: jestMock.fn().mockReturnThis(),
                    select: jestMock.fn().mockReturnThis(),
                    get: jestMock.fn().mockResolvedValue({
                        docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                        size: 2
                    })
                };
            })
        };

        // Global leads query mock
        const leadsCollectionMock = {
            doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({}) }) })),
            where: jestMock.fn().mockReturnThis(),
            select: jestMock.fn().mockReturnThis(),
            limit: jestMock.fn().mockReturnThis(),
            get: jestMock.fn().mockResolvedValue({
                docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                size: 2
            })
        };

        db.collection.mockImplementation((name) => {
            if (name === 'companies') return { doc: jestMock.fn(() => companyDocMock) };
            if (name === 'leads') return leadsCollectionMock;
            if (name === 'memberships') return {
                where: jestMock.fn().mockReturnThis(),
                limit: jestMock.fn().mockReturnThis(),
                get: jestMock.fn().mockResolvedValue({
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
            status: jestMock.fn().mockReturnThis(),
            send: jestMock.fn()
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
            get: jestMock.fn().mockResolvedValue({ exists: true, data: () => sessionData }),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn((name) => {
                if (name === 'logs') return {
                    doc: jestMock.fn(() => ({
                        get: jestMock.fn().mockResolvedValue({ exists: false }),
                        set: jestMock.fn().mockResolvedValue(true)
                    }))
                };
                return {
                    doc: jestMock.fn(() => ({
                        get: jestMock.fn().mockResolvedValue({ exists: false }),
                        set: jestMock.fn().mockResolvedValue(true)
                    }))
                };
            })
        };

        // Transaction mock — returns batch claim
        db.runTransaction.mockImplementation(async (callback) => {
            const mockT = {
                get: jestMock.fn().mockResolvedValue({
                    exists: true,
                    data: () => sessionData
                }),
                update: jestMock.fn()
            };
            return await callback(mockT);
        });

        const companyDocMock = {
            get: jestMock.fn().mockResolvedValue({
                exists: true,
                data: () => ({ name: 'Test Company' })
            }),
            collection: jestMock.fn((name) => {
                if (name === 'bulk_sessions') return { doc: jestMock.fn(() => sessionRefMock) };
                if (name === 'leads') return {
                    doc: jestMock.fn((id) => ({
                        get: jestMock.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ firstName: 'John', phone: '1234567890' })
                        }),
                        update: jestMock.fn().mockResolvedValue(true)
                    }))
                };
                if (name === 'sms_sent_phones') return {
                    doc: jestMock.fn(() => ({ set: jestMock.fn().mockResolvedValue(true) }))
                };
                return { doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: false }) })) };
            })
        };

        const companiesCollectionMock = {
            doc: jestMock.fn(() => companyDocMock)
        };

        db.collection.mockImplementation((name) => {
            if (name === 'companies') return companiesCollectionMock;
            return {
                doc: jestMock.fn(() => ({
                    get: jestMock.fn().mockResolvedValue({ exists: false }),
                    set: jestMock.fn().mockResolvedValue(true),
                    update: jestMock.fn().mockResolvedValue(true)
                }))
            };
        });

        // Mock SMS adapter
        mockGetAdapterForUser.mockResolvedValue({
            sendSMS: jestMock.fn().mockResolvedValue(true),
            ensureLoggedIn: jestMock.fn().mockResolvedValue(true)
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
                    leadType: 'global',
                    excludedLeadIds: ['lead1']
                },
                config: { method: 'sms', message: 'Hello' }
            },
            auth: { uid: 'user123', token: { roles: { company123: 'company_admin' } } }
        };

        const sessionDocMock = {
            id: 'session-abc',
            set: jestMock.fn().mockResolvedValue(true),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn(() => ({
                doc: jestMock.fn(() => ({ set: jestMock.fn(), get: jestMock.fn().mockResolvedValue({ exists: false }) }))
            }))
        };

        const companyDocMock = {
            get: jestMock.fn().mockResolvedValue({
                exists: true,
                data: () => ({ name: 'Test Company', ownerId: 'user123' })
            }),
            collection: jestMock.fn((name) => {
                if (name === 'bulk_sessions') return { doc: jestMock.fn(() => sessionDocMock) };
                if (name === 'team') return {
                    doc: jestMock.fn(() => ({
                        get: jestMock.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ role: 'company_admin' })
                        })
                    }))
                };
                return { doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: false }) })) };
            })
        };

        // Global leads — return 2 leads (lead1 should be filtered out by excludedLeadIds)
        const leadsCollectionMock = {
            doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({}) }) })),
            where: jestMock.fn().mockReturnThis(),
            select: jestMock.fn().mockReturnThis(),
            limit: jestMock.fn().mockReturnThis(),
            get: jestMock.fn().mockResolvedValue({
                docs: [{ id: 'lead1', data: () => ({}) }, { id: 'lead2', data: () => ({}) }],
                size: 2
            })
        };

        db.collection.mockImplementation((name) => {
            if (name === 'companies') return { doc: jestMock.fn(() => companyDocMock) };
            if (name === 'leads') return leadsCollectionMock;
            if (name === 'memberships') return {
                where: jestMock.fn().mockReturnThis(),
                limit: jestMock.fn().mockReturnThis(),
                get: jestMock.fn().mockResolvedValue({
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

        const mockWhere = jestMock.fn().mockReturnThis();
        const sessionDocMock = {
            id: 'sess1',
            set: jestMock.fn().mockResolvedValue(true),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn(() => ({
                doc: jestMock.fn(() => ({ set: jestMock.fn(), get: jestMock.fn().mockResolvedValue({ exists: false }) }))
            }))
        };

        const leadsCollectionMock = {
            doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: false }) })),
            where: mockWhere,
            select: jestMock.fn().mockReturnThis(),
            limit: jestMock.fn().mockReturnThis(),
            get: jestMock.fn().mockResolvedValue({
                docs: [{ id: 'lead1', data: () => ({}) }],
                size: 1
            })
        };

        const companyDocMock = {
            get: jestMock.fn().mockResolvedValue({
                exists: true,
                data: () => ({ ownerId: 'user123' })
            }),
            collection: jestMock.fn((colName) => {
                if (colName === 'leads') return leadsCollectionMock;
                if (colName === 'bulk_sessions') return { doc: jestMock.fn(() => sessionDocMock) };
                if (colName === 'team') return {
                    doc: jestMock.fn(() => ({
                        get: jestMock.fn().mockResolvedValue({
                            exists: true,
                            data: () => ({ role: 'company_admin' })
                        })
                    }))
                };
                return { doc: jestMock.fn(() => ({ get: jestMock.fn().mockResolvedValue({ exists: false }) })) };
            })
        };

        db.collection.mockImplementation((colName) => {
            if (colName === 'companies') return { doc: jestMock.fn(() => companyDocMock) };
            if (colName === 'memberships') return {
                where: jestMock.fn().mockReturnThis(),
                limit: jestMock.fn().mockReturnThis(),
                get: jestMock.fn().mockResolvedValue({
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
