const assert = require('assert');
// vi is available globally via vitest globals: true config

// --- MOCK FACTORY ---
vi.mock('../../firebaseAdmin', () => {
    const mockFirestore = {
        collection: vi.fn(),
        batch: vi.fn(),
        runTransaction: vi.fn(),
        settings: vi.fn()
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
            getUserByEmail: vi.fn()
        }),
        apps: ['mockApp'],
        initializeApp: vi.fn()
    };

    return {
        admin: mockAdmin,
        db: mockFirestore,
        auth: mockAdmin.auth(),
        storage: {}
    };
});

// Mock firestore v2 - Define mock impl here
vi.mock('firebase-functions/v2/firestore', () => ({
    onDocumentCreated: vi.fn((config, handler) => handler),
    onDocumentUpdated: vi.fn((config, handler) => handler)
}));

// Mock encryption
vi.mock('../../integrations/encryption', () => ({
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
        vi.clearAllMocks();

        // Setup generic mocks

        // Setup generic mocks
        const docMock = {
            collection: vi.fn(),
            update: vi.fn().mockResolvedValue(),
            set: vi.fn().mockResolvedValue(),
            get: vi.fn().mockResolvedValue({
                exists: false, data: () => ({}),
                ref: { collection: vi.fn() }
            })
        };
        const collectionMock = {
            doc: vi.fn().mockReturnValue(docMock),
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
            add: vi.fn().mockResolvedValue({ id: 'new_doc_id' })
        };
        docMock.collection.mockReturnValue(collectionMock);
        mockFirestore.collection.mockReturnValue(collectionMock);

        mockFirestore.runTransaction.mockImplementation(async (callback) => {
            const t = {
                get: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
                set: vi.fn(),
                update: vi.fn(),
                delete: vi.fn()
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
