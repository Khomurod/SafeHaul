const { describe, it, expect, beforeEach, afterEach } = require('@jest/globals');
const firebaseFunctionsTest = require('firebase-functions-test');

const test = firebaseFunctionsTest();

// Mock dependencies
const jestMock = require('@jest/globals').jest;

jestMock.mock('firebase-admin', () => {
    const firestoreMock = {
        settings: jestMock.fn(),
        collection: jestMock.fn(),
        doc: jestMock.fn(),
        batch: jestMock.fn(() => ({
            set: jestMock.fn(),
            commit: jestMock.fn().mockResolvedValue(true)
        })),
    };

    // Recursive mocking for collection().doc().collection()...
    const collectionFn = jestMock.fn(() => ({
        doc: docFn,
        where: jestMock.fn().mockReturnThis(),
        limit: jestMock.fn().mockReturnThis(),
        get: jestMock.fn().mockResolvedValue({ docs: [] })
    }));

    const docFn = jestMock.fn(() => ({
        collection: collectionFn,
        get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({}) }),
        set: jestMock.fn().mockResolvedValue(true),
        update: jestMock.fn().mockResolvedValue(true)
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

    return {
        apps: [],
        initializeApp: jestMock.fn(),
        instanceId: jestMock.fn(() => ({ app: { options: { projectId: 'test-project' } } })),
        firestore: firestoreFn,
        auth: jestMock.fn()
    };
});

// Mock firebase-admin/firestore and storage
jestMock.mock('firebase-admin/firestore', () => ({
    getFirestore: jestMock.fn(() => require('firebase-admin').firestore())
}));
jestMock.mock('firebase-admin/storage', () => ({
    getStorage: jestMock.fn()
}));

// Mock Cloud Tasks
const mockCreateTask = jestMock.fn().mockResolvedValue([{}]);
jestMock.mock('@google-cloud/tasks', () => {
    return {
        CloudTasksClient: jestMock.fn(() => ({
            queuePath: jestMock.fn((project, location, queue) => `projects/${project}/locations/${location}/queues/${queue}`),
            createTask: mockCreateTask
        }))
    };
});

// Mock other dependencies
const mockGetAdapterForUser = jestMock.fn();
jestMock.mock('../integrations/factory', () => ({
    getAdapterForUser: mockGetAdapterForUser
}));

jestMock.mock('../blacklist', () => ({
    isBlacklisted: jestMock.fn().mockResolvedValue(false)
}));

// Import the module under test
process.env.GCLOUD_PROJECT = 'test-project';
process.env.FUNCTION_REGION = 'us-central1';

const bulkActions = require('../bulkActions');
const admin = require('firebase-admin');

describe('Bulk Actions Tests', () => {
    let db;

    beforeEach(() => {
        db = admin.firestore();
        jestMock.clearAllMocks();
    });

    afterEach(() => {
        test.cleanup();
    });

    it('should enqueue worker with correct URL in initBulkSession', async () => {
        const wrapped = test.wrap(bulkActions.initBulkSession);
        const data = {
            companyId: 'company123',
            filters: { leadType: 'global' },
            messageConfig: { method: 'sms', message: 'Hello' }
        };
        const context = {
            auth: { uid: 'user123' }
        };

        // Setup better mocks
        const mockDoc = {
            get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Test Recruiter', companyName: 'Test Company' }) }),
            set: jestMock.fn().mockResolvedValue(true),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn(),
            id: 'mock-doc-id'
        };

        const mockCollection = {
            doc: jestMock.fn().mockReturnValue(mockDoc),
            where: jestMock.fn().mockReturnThis(),
            limit: jestMock.fn().mockReturnThis(),
            get: jestMock.fn().mockResolvedValue({
                docs: [{ id: 'lead1' }, { id: 'lead2' }]
            }),
            add: jestMock.fn(),
        };

        mockDoc.collection.mockReturnValue(mockCollection);
        db.collection.mockReturnValue(mockCollection);

        await wrapped({ data, auth: context.auth });

        expect(mockCreateTask).toHaveBeenCalled();
        const taskCall = mockCreateTask.mock.calls[0][0];
        const task = taskCall.task;

        // Verify URL
        expect(task.httpRequest.url).toBe('https://us-central1-test-project.cloudfunctions.net/processBulkBatch');
    });

    it('should process batch and enqueue next batch in processBulkBatch', async () => {
        const req = {
            headers: { 'x-appengine-queuename': 'bulk-actions-queue' },
            body: { companyId: 'company123', sessionId: 'session123' }
        };
        const res = {
            status: jestMock.fn().mockReturnThis(),
            send: jestMock.fn()
        };

        const sessionData = {
            status: 'active',
            targetIds: Array.from({ length: 100 }, (_, i) => `lead${i}`),
            currentPointer: 0,
            config: { method: 'sms', message: 'Hello' },
            progress: { processedCount: 0 },
            creatorId: 'user123',
            leadSourceType: 'leads'
        };

        // Setup mocks
        const sessionRefMock = {
            get: jestMock.fn().mockResolvedValue({ exists: true, data: () => sessionData }),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn()
        };

        const attemptsCollectionMock = {
            doc: jestMock.fn(() => ({})),
        };
        sessionRefMock.collection.mockReturnValue(attemptsCollectionMock);

        // We need to handle retrieving the session doc AND the lead docs
        const mockCollection = {
            doc: jestMock.fn(),
        };

        db.collection.mockReturnValue(mockCollection);

        // Logic to return sessionRefMock when querying the session
        // db.collection('companies').doc(companyId).collection('bulk_sessions').doc(sessionId)

        const companiesDoc = { collection: jestMock.fn() };
        const bulkSessionsCollection = { doc: jestMock.fn() };

        mockCollection.doc.mockImplementation((id) => {
             // If this is the leads collection or companies collection
             // We can't easily distinguish from args alone without tracking path.
             // But the code: db.collection('companies').doc(companyId)...
             if (id === 'company123') return companiesDoc;
             if (id && id.startsWith('lead')) {
                 return {
                     get: jestMock.fn().mockResolvedValue({
                         exists: true,
                         data: () => ({ firstName: 'John', phone: '1234567890' })
                     })
                 };
             }
             return { get: jestMock.fn().mockResolvedValue({ exists: false }) };
        });

        companiesDoc.collection.mockImplementation((name) => {
            if (name === 'bulk_sessions') return bulkSessionsCollection;
            if (name === 'leads') return mockCollection; // reuse for leads lookup
            return { doc: jestMock.fn() };
        });

        bulkSessionsCollection.doc.mockReturnValue(sessionRefMock);

        // Mock adapter
        mockGetAdapterForUser.mockResolvedValue({
            sendSMS: jestMock.fn().mockResolvedValue(true)
        });

        await bulkActions.processBulkBatch(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Processed batch'));

        // Verify session update
        expect(sessionRefMock.update).toHaveBeenCalledWith(expect.objectContaining({
            currentPointer: 50, // Batch size 50
            'progress.processedCount': expect.anything(),
        }));

        // Verify next task enqueue
        expect(mockCreateTask).toHaveBeenCalled();
    });

    it('should exclude IDs in filters.excludedLeadIds', async () => {
        const wrapped = test.wrap(bulkActions.initBulkSession);
        const data = {
            companyId: 'company123',
            filters: {
                leadType: 'global',
                excludedLeadIds: ['lead1']
            },
            messageConfig: { method: 'sms', message: 'Hello' }
        };
        const context = {
            auth: { uid: 'user123' }
        };

        // Reuse mocks from previous tests (returns lead1, lead2)
        // db.collection...get() mocked in beforeEach/it block setup?
        // Wait, the mocks are set up in the `jestMock.mock` block globally or per test?
        // In the first test `should enqueue...` I set up mocks inside the test.
        // I should set up mocks here too.

        const mockDoc = {
            get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Test Recruiter', companyName: 'Test Company' }) }),
            set: jestMock.fn().mockResolvedValue(true),
            update: jestMock.fn().mockResolvedValue(true),
            collection: jestMock.fn(),
            id: 'mock-doc-id'
        };

        const mockCollection = {
            doc: jestMock.fn().mockReturnValue(mockDoc),
            where: jestMock.fn().mockReturnThis(),
            limit: jestMock.fn().mockReturnThis(),
            get: jestMock.fn().mockResolvedValue({
                docs: [{ id: 'lead1' }, { id: 'lead2' }]
            }),
            add: jestMock.fn(),
        };

        mockDoc.collection.mockReturnValue(mockCollection);
        db.collection.mockReturnValue(mockCollection);

        const result = await wrapped({ data, auth: context.auth });

        expect(result.targetCount).toBe(1);
    });

    it('should map status IDs to DB values', async () => {
        const wrapped = test.wrap(bulkActions.initBulkSession);
        const data = {
            companyId: 'company123',
            filters: {
                leadType: 'leads',
                status: ['new', 'contacted']
            },
            messageConfig: { method: 'sms', message: 'Hello' }
        };
        const context = {
            auth: { uid: 'user123' }
        };

        const mockWhere = jestMock.fn().mockReturnThis();
        const mockDocWithGet = {
            collection: jestMock.fn(),
            get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({}) })
        };
        const mockCollection = {
            doc: jestMock.fn().mockReturnValue(mockDocWithGet),
            where: mockWhere, // We want to spy on this
            limit: jestMock.fn().mockReturnThis(),
            get: jestMock.fn().mockResolvedValue({
                docs: [{ id: 'lead1' }]
            }),
            add: jestMock.fn(),
        };

        // We need to ensure db.collection returns mockCollection for the leads
        // db.collection('companies').doc(...).collection('leads')

        const companyDoc = {
            collection: jestMock.fn((colName) => {
                if (colName === 'leads') return mockCollection;
                if (colName === 'bulk_sessions') return { doc: jestMock.fn(() => ({ set: jestMock.fn(), id: 'sess1' })) };
                return { doc: jestMock.fn() };
            }),
            get: jestMock.fn().mockResolvedValue({ exists: true, data: () => ({}) })
        };

        const companiesCollection = {
            doc: jestMock.fn(() => companyDoc)
        };

        db.collection.mockImplementation((colName) => {
            if (colName === 'companies') return companiesCollection;
            return mockCollection;
        });

        await wrapped({ data, auth: context.auth });

        // Verify status mapping: 'new' -> 'New Application', 'contacted' -> 'Contacted'
        expect(mockWhere).toHaveBeenCalledWith('status', 'in', ['New Application', 'Contacted']);
    });
});
