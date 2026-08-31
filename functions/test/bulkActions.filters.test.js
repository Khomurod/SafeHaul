// =====================================================================
// How the audience is filtered: excluded ids, and status-id mapping.
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
const { resetBulkState } = require('./bulkActions.support');

describe('Bulk Actions Tests', () => {
    let db;

    beforeEach(() => { db = resetBulkState(); });

    afterEach(() => {
        jest.clearAllMocks();
    });

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
