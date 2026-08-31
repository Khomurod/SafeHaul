// =====================================================================
// Characterization of initBulkSession's direct-selection branch (BULK-2).
//
// When a caller passes explicit targetIds, every ID is verified server-side
// to belong to the named company before it can receive a message: the
// controller queries the company's `applications` and `leads` collections by
// document ID and keeps only the IDs it finds. Without that check, IDs from
// another company could be passed to exfiltrate sends (IDOR).
//
// Written before the FR-6 split moved this branch into its own module, so the
// behaviour is pinned by tests that passed against the original single-file
// controller.
// =====================================================================

const mockAssertCompanyAdmin = jest.fn().mockResolvedValue(true);
const mockEnqueueWorker = jest.fn().mockResolvedValue(true);
const mockCheckRateLimit = jest.fn().mockResolvedValue(true);
const mockBuildLeadQueries = jest.fn();

const mockSessionSet = jest.fn().mockResolvedValue(true);
const mockSessionUpdate = jest.fn().mockResolvedValue(true);

const mockSessionRef = {
    id: 'session-1',
    set: mockSessionSet,
    update: mockSessionUpdate,
    collection: jest.fn(() => ({
        doc: jest.fn((id) => ({ id }))
    }))
};

// Which document IDs each company collection actually contains. The
// where(documentId(), 'in', chunk) query returns the intersection.
const ownedIds = {
    applications: new Set(),
    leads: new Set(),
};

// Every `.where()` chunk the verification queries asked for, so a test can
// assert the query shape (documentId-in) rather than just the outcome.
const whereCalls = [];

function makeVerificationQuery(collectionName) {
    const chain = {
        where: jest.fn((field, op, chunk) => {
            whereCalls.push({ collectionName, field, op, chunk });
            chain.__chunk = chunk;
            return chain;
        }),
        select: jest.fn(() => chain),
        get: jest.fn(async () => {
            const found = (chain.__chunk || []).filter((id) => ownedIds[collectionName].has(id));
            return {
                size: found.length,
                forEach: (fn) => found.forEach((id) => fn({ id })),
                docs: found.map((id) => ({ id, data: () => ({}) })),
            };
        }),
    };
    return chain;
}

const mockDb = {
    getAll: jest.fn().mockResolvedValue([]),
    batch: jest.fn(() => ({
        set: jest.fn(),
        delete: jest.fn(),
        commit: jest.fn().mockResolvedValue(true),
    })),
    collection: jest.fn(() => ({
        doc: jest.fn(() => ({
            collection: jest.fn((name) => {
                if (name === 'bulk_sessions') {
                    return { doc: jest.fn(() => mockSessionRef) };
                }
                if (name === 'applications' || name === 'leads') {
                    return makeVerificationQuery(name);
                }
                return { doc: jest.fn((id) => ({ id })) };
            })
        }))
    }))
};

const mockAdmin = {
    firestore: {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true }),
        },
        Timestamp: {
            fromDate: (d) => d,
        },
        FieldPath: {
            documentId: () => '__name__',
        },
    },
};

jest.mock('firebase-functions/v2/https', () => ({
    onCall: (opts, handler) => handler,
    HttpsError: class extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }
}));

jest.mock('../../firebaseAdmin', () => ({
    admin: mockAdmin,
    db: mockDb
}));

jest.mock('../../bulkActions/helpers/auth', () => ({
    assertCompanyAdmin: (...args) => mockAssertCompanyAdmin(...args)
}));

jest.mock('../../bulkActions/services/queueService', () => ({
    enqueueWorker: (...args) => mockEnqueueWorker(...args)
}));

jest.mock('../../shared/rateLimiter', () => ({
    checkRateLimit: (...args) => mockCheckRateLimit(...args)
}));

jest.mock('../../bulkActions/helpers/queryBuilder', () => ({
    buildLeadQueries: (...args) => mockBuildLeadQueries(...args)
}));

const sessionController = require('../../bulkActions/controllers/sessionController');

function makeRequest(targetIds) {
    return {
        auth: { uid: 'admin-1' },
        data: {
            companyId: 'company-1',
            filters: {},
            config: { method: 'sms', message: 'hello' },
            sessionName: 'direct',
            targetIds,
        },
    };
}

describe('initBulkSession direct selection (BULK-2 ownership verification)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        ownedIds.applications = new Set();
        ownedIds.leads = new Set();
        whereCalls.length = 0;
    });

    it('keeps only the IDs that belong to the company, from either collection', async () => {
        ownedIds.applications = new Set(['app-1']);
        ownedIds.leads = new Set(['lead-1']);

        const result = await sessionController.initBulkSession(
            makeRequest(['app-1', 'lead-1', 'foreign-1'])
        );

        expect(result.success).toBe(true);
        expect(result.targetCount).toBe(2);
        const sessionDoc = mockSessionSet.mock.calls[0][0];
        expect(sessionDoc.targetIds.sort()).toEqual(['app-1', 'lead-1']);
        expect(sessionDoc.targetIds).not.toContain('foreign-1');
    });

    it('verifies ownership by querying document IDs, not by trusting the caller', async () => {
        ownedIds.leads = new Set(['lead-1']);

        await sessionController.initBulkSession(makeRequest(['lead-1']));

        // Both company collections were consulted with a documentId-in query.
        const collectionsAsked = new Set(whereCalls.map((c) => c.collectionName));
        expect(collectionsAsked).toEqual(new Set(['applications', 'leads']));
        for (const call of whereCalls) {
            expect(call.field).toBe('__name__');
            expect(call.op).toBe('in');
            expect(call.chunk).toEqual(['lead-1']);
        }
    });

    it('refuses outright when no provided ID belongs to the company', async () => {
        await expect(
            sessionController.initBulkSession(makeRequest(['foreign-1', 'foreign-2']))
        ).rejects.toMatchObject({ code: 'permission-denied' });
        expect(mockSessionSet).not.toHaveBeenCalled();
        expect(mockEnqueueWorker).not.toHaveBeenCalled();
    });

    it('rejects an oversized ID list before running any query', async () => {
        const tooMany = Array.from({ length: 501 }, (_, i) => `id-${i}`);
        await expect(
            sessionController.initBulkSession(makeRequest(tooMany))
        ).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(whereCalls).toHaveLength(0);
    });
});
