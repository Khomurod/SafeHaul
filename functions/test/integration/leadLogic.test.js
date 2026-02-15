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
                arrayUnion: (val) => ['ARRAY_UNION', val]
            }
        },
        auth: () => ({}),
        apps: ['mockApp'],
        initializeApp: jest.fn()
    };

    return {
        admin: mockAdmin,
        db: mockFirestore,
        auth: {},
        storage: {}
    };
});

const { db: mockFirestore, admin: mockAdmin } = require('../../firebaseAdmin');
const { dealLeadsToCompany } = require('../../leadLogic');

describe('Integration: Dealer Logic (dealLeadsToCompany)', () => {

    beforeEach(() => {
        jest.clearAllMocks();

        const genericSnapshot = {
            docs: [],
            empty: true,
            forEach: (fn) => [].forEach(fn)
        };

        const queryMock = {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(genericSnapshot)
        };

        const docMock = {
            collection: jest.fn().mockReturnValue(queryMock),
            update: jest.fn().mockResolvedValue(),
            set: jest.fn().mockResolvedValue(),
            get: jest.fn().mockResolvedValue({ exists: true, data: () => ({}) })
        };

        mockFirestore.collection.mockImplementation((name) => {
            if (name === 'companies') return { doc: jest.fn().mockReturnValue(docMock) };
            if (name === 'leads') return queryMock;
            return queryMock;
        });

        mockFirestore.batch.mockReturnValue({
            delete: jest.fn(),
            update: jest.fn(),
            commit: jest.fn().mockResolvedValue()
        });
    });

    it('should return "Full" if company has reached quota (cleanup returns max)', async () => {
        // Status 'Hired' + distributedAt prevents cleanup deletion
        const activeDocSnap = {
            data: () => ({
                status: 'Hired',
                isPlatformLead: true,
                distributedAt: mockAdmin.firestore.Timestamp.now() // Required to pass 'distributedAt' check
            }),
            ref: { collection: jest.fn().mockReturnValue({ get: jest.fn().mockResolvedValue({ forEach: () => { } }) }) }
        };
        const activeDocs = Array(50).fill(activeDocSnap);

        const activeSnapshot = {
            docs: activeDocs,
            empty: false,
            forEach: (fn) => activeDocs.forEach(fn)
        };

        const queryMock = {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(activeSnapshot)
        };

        const docMock = {
            collection: jest.fn().mockReturnValue(queryMock)
        };

        mockFirestore.collection.mockImplementation((name) => {
            if (name === 'companies') return { doc: jest.fn().mockReturnValue(docMock) };
            return queryMock;
        });

        const company = { id: 'comp1', companyName: 'Test Co' };
        const result = await dealLeadsToCompany(company, 50, false);

        expect(result).toContain('Full');
        expect(result).toContain('(50/50)');
    });

    it('should add leads if company is below quota', async () => {
        // 1. Mock Cleanup: 0 active leads
        const emptySnapshot = {
            docs: [],
            empty: true,
            forEach: (fn) => [].forEach(fn)
        };

        const emptyQueryMock = {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(emptySnapshot)
        };

        // 2. Global Leads: 1 candidate
        const candidateDoc = {
            id: 'lead1',
            data: () => ({ firstName: 'John', phone: '123' }),
            ref: { id: 'lead1' }
        };
        const candidateSnapshot = {
            docs: [candidateDoc],
            empty: false,
            forEach: (fn) => [candidateDoc].forEach(fn)
        };

        const candidateQueryMock = {
            where: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue(candidateSnapshot)
        };

        mockFirestore.collection.mockImplementation((name) => {
            if (name === 'companies') return {
                doc: jest.fn().mockReturnValue({ collection: jest.fn().mockReturnValue(emptyQueryMock) })
            };
            if (name === 'leads') return candidateQueryMock;
            return emptyQueryMock;
        });

        // 3. Transaction
        mockFirestore.runTransaction.mockImplementation(async (callback) => {
            const t = {
                get: jest.fn().mockResolvedValue({
                    exists: true,
                    id: 'lead1',
                    data: () => ({ firstName: 'John', phone: '123' })
                }),
                set: jest.fn(),
                update: jest.fn()
            };
            try {
                await callback(t);
                return true;
            } catch (e) {
                return false;
            }
        });

        const company = { id: 'comp1', companyName: 'Test Co' };
        const result = await dealLeadsToCompany(company, 10, false);

        expect(result).toContain('Added');
    });
});
