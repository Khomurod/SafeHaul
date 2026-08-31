// =====================================================================
// Starting a bulk session and processing a batch.
//
// Part of the bulk-actions suite. The Firestore double, the Cloud Tasks and
// integration mocks and the reset are in `bulkActions.support.js`. Each
// `jest.mock` below has to stay in this file, because Jest hoists it per file
// and cannot register one from a helper.
// =====================================================================

jest.mock('firebase-admin', () => require('./bulkActions.support').firebaseAdminMock());
jest.mock('../firebaseAdmin', () => require('./bulkActions.support').sharedFirebaseAdminMock());
jest.mock('firebase-admin/firestore', () => require('./bulkActions.support').firestoreModuleMock());
jest.mock('firebase-admin/storage', () => require('./bulkActions.support').storageMock());
jest.mock('firebase-functions/v2/https', () => require('./bulkActions.support').httpsMock());
jest.mock('@google-cloud/tasks', () => require('./bulkActions.support').cloudTasksMock());
jest.mock('../integrations/factory', () => require('./bulkActions.support').integrationsFactoryMock());
jest.mock('../blacklist', () => require('./bulkActions.support').blacklistMock());
jest.mock('../integrations/encryption', () => require('./bulkActions.support').encryptionMock());
jest.mock('../utils/phoneUtils', () => require('./bulkActions.support').phoneUtilsMock());

const bulkActions = require('../bulkActions');
const { mockCreateTask, mockGetAdapterForUser, resetBulkState } = require('./bulkActions.support');

describe('Bulk Actions Tests', () => {
    let db;

    beforeEach(() => { db = resetBulkState(); });

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
});
