const assert = require('assert');

// --- MOCK FACTORY ---
jest.mock('../../firebaseAdmin', () => {
    const mockFirestore = {
        collection: jest.fn(),
        batch: jest.fn(),
        runTransaction: jest.fn(),
        settings: jest.fn()
    };

    const mockAdmin = {
        firestore: {
            Timestamp: {
                now: () => ({ toDate: () => new Date(), toMillis: () => Date.now() }),
                fromDate: (date) => ({ toDate: () => date, toMillis: () => date.getTime() })
            },
            FieldValue: {
                serverTimestamp: () => 'SERVER_TIMESTAMP',
                arrayUnion: (val) => ['ARRAY_UNION', val],
                increment: (val) => ['INCREMENT', val]
            }
        },
        auth: () => ({
            getUserByEmail: jest.fn()
        }),
        apps: ['mockApp'],
        initializeApp: jest.fn()
    };

    return {
        admin: mockAdmin,
        db: mockFirestore,
        auth: mockAdmin.auth(),
        storage: {}
    };
});

// Mock firestore v2 - Define mock impl here
jest.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: jest.fn((config, handler) => handler)
}));

// Mock encryption
jest.mock('../../integrations/encryption', () => ({
    encrypt: (val) => `ENCRYPTED_${val}`
}));

// Imports
const driverSync = require('../../driverSync');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { db: mockFirestore, auth: mockAuth } = require('../../firebaseAdmin');

describe('E2E: Driver Application Submission Flow', () => {
    // Capture handler ONCE safely before any clearAllMocks
    const calls = onDocumentCreated.mock.calls;
    const match = calls.find(call => call[0].document === "companies/{companyId}/applications/{applicationId}");
    const capturedHandler = match ? match[1] : null;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup generic mocks

        // Setup generic mocks
        const docMock = {
            collection: jest.fn(),
            update: jest.fn().mockResolvedValue(),
            set: jest.fn().mockResolvedValue(),
            get: jest.fn().mockResolvedValue({
                exists: false, data: () => ({}),
                ref: { collection: jest.fn() }
            })
        };
        const collectionMock = {
            doc: jest.fn().mockReturnValue(docMock),
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({ empty: true, docs: [] }),
            add: jest.fn().mockResolvedValue({ id: 'new_doc_id' })
        };
        docMock.collection.mockReturnValue(collectionMock);
        mockFirestore.collection.mockReturnValue(collectionMock);

        mockFirestore.runTransaction.mockImplementation(async (callback) => {
            const t = {
                get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                set: jest.fn(),
                update: jest.fn(),
                delete: jest.fn()
            };
            await callback(t);
        });
    });

    it('should process a valid application submission', async () => {
        const handler = capturedHandler;
        expect(handler).toBeDefined();

        const companyId = 'comp123';
        const applicationId = 'app456';
        const appInputData = {
            firstName: 'Driver',
            lastName: 'One',
            email: 'driver@test.com',
            phone: '555-0101',
            signature: 'TEXT_SIGNATURE: John Doe',
            'cdl-front': { url: 'http://img/cdl-f.jpg', name: 'cdl-f.jpg' }
        };
        const event = {
            data: { data: () => appInputData },
            params: { companyId, applicationId }
        };

        // Configure Auth Mock BEFORE execution
        mockAuth.getUserByEmail.mockRejectedValue({ code: 'auth/user-not-found' });

        await handler(event);

        expect(mockFirestore.runTransaction).toHaveBeenCalled();
        expect(mockFirestore.collection).toHaveBeenCalledWith('drivers');
    });

    it('should reject application without signature', async () => {
        const handler = capturedHandler;
        expect(handler).toBeDefined();
        const event = {
            data: {
                data: () => ({
                    firstName: 'No', sig: null
                }) // Missing signature
            },
            params: { companyId: 'c1', applicationId: 'a1' }
        };

        await handler(event);

        // Should NOT call drivers collection (aborted)
        // Check filtering of calls to collection 'drivers'
        const driverCalls = mockFirestore.collection.mock.calls.filter(args => args[0] === 'drivers');
        expect(driverCalls.length).toBe(0);
    });
});
