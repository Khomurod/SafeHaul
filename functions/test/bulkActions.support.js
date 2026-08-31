// =====================================================================
// Shared harness for the bulkActions suites.
//
// `jest.mock` is hoisted per file and cannot be registered from here, so each
// suite keeps its own one-line registration and the factory bodies live below.
// Every factory returns the same object each call, so the doubles a suite
// imports are the ones the code under test is talking to.
//
// No suite here queues a `*Once` value and none calls `jest.resetModules()`
// (both checked before the split). `resetBulkState` is the original
// `beforeEach` body, unchanged, including the note it already carried about
// resetting `runTransaction`.
//
// Four-space indentation and the banner-comment style are the original file's.
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

const mockCreateTask = jest.fn().mockResolvedValue([{}]);
const mockGetAdapterForUser = jest.fn();

const firebaseAdminMock = () => ({
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
});

const sharedFirebaseAdminMock = () => ({
    admin: require('firebase-admin'),
    db: require('firebase-admin').firestore()
});

const firestoreModuleMock = () => ({
    getFirestore: jest.fn(() => require('firebase-admin').firestore())
});

const storageMock = () => ({ getStorage: jest.fn() });

const httpsMock = () => ({
    onRequest: jest.fn((opts, handler) => handler),
    onCall: jest.fn((opts, handler) => handler),
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
});

const cloudTasksMock = () => ({
    CloudTasksClient: jest.fn(() => ({
        queuePath: jest.fn((project, location, queue) =>
            `projects/${project}/locations/${location}/queues/${queue}`),
        createTask: mockCreateTask
    }))
});

const integrationsFactoryMock = () => ({
    getAdapterForUser: mockGetAdapterForUser
});

const blacklistMock = () => ({
    isBlacklisted: jest.fn().mockResolvedValue(false)
});

const encryptionMock = () => ({
    decrypt: jest.fn(text => text)
});

const phoneUtilsMock = () => ({
    normalizePhone: jest.fn(phone => phone ? phone.replace(/\D/g, '') : '')
});

// --- Environment ---
process.env.GCLOUD_PROJECT = 'test-project';
process.env.FUNCTION_REGION = 'us-central1';
process.env.PROCESS_BULK_BATCH_URL = 'https://us-central1-test-project.cloudfunctions.net/processBulkBatch';
process.env.BULK_WORKER_SECRET = 'test-secret-for-unit-tests';

/**
 * The original `beforeEach` body, unchanged, returning the `db` it resolves so
 * each suite can keep its own `let db`.
 */
function resetBulkState() {
    const admin = require('firebase-admin');
    const db = admin.firestore();
    jest.clearAllMocks();
    // Re-apply default mocks after clearAllMocks
    firestoreMock.collection.mockImplementation(mockCollectionFn);
    firestoreMock.getAll = jest.fn().mockResolvedValue([]);
    // AUDIT FIX: Reset runTransaction mock to prevent Test 2 from poisoning Test 3 & 4.
    // Those tests now live in separate files with separate module registries, so
    // that particular poisoning is impossible — but the reset stays, because it is
    // what every test in either file starts from and this split does not change that.
    firestoreMock.runTransaction.mockImplementation(async (cb) => {
        const mockT = {
            get: jest.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
            set: jest.fn(),
            update: jest.fn(),
            delete: jest.fn()
        };
        return await cb(mockT);
    });
    return db;
}

module.exports = {
    firebaseAdminMock,
    sharedFirebaseAdminMock,
    firestoreModuleMock,
    storageMock,
    httpsMock,
    cloudTasksMock,
    integrationsFactoryMock,
    blacklistMock,
    encryptionMock,
    phoneUtilsMock,
    firestoreMock,
    mockCollectionFn,
    mockDocFn,
    mockFirestoreFn,
    mockCreateTask,
    mockGetAdapterForUser,
    resetBulkState,
};
