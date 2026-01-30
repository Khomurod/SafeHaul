const { checkRateLimit } = require('../../shared/rateLimiter');
const admin = require('firebase-admin');

// Mock Firebase Admin
jest.mock('../../firebaseAdmin', () => {
    const firestoreMock = {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        runTransaction: jest.fn()
    };
    return {
        admin: {
            firestore: {
                Timestamp: {
                    now: () => ({ toMillis: () => Date.now() }),
                    fromMillis: (ms) => ({ toMillis: () => ms })
                },
                FieldValue: {
                    increment: jest.fn()
                }
            }
        },
        db: firestoreMock
    };
});

const { db } = require('../../firebaseAdmin');

describe('Rate Limiter', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should allow request if no record exists', async () => {
        db.runTransaction.mockImplementation(async textCallback => {
            const mockDoc = { exists: false, data: () => ({}) };
            const mockT = {
                get: jest.fn().mockResolvedValue(mockDoc),
                set: jest.fn(),
                update: jest.fn()
            };
            await textCallback(mockT);
        });

        const result = await checkRateLimit('test_key', 5, 60);
        expect(result).toBe(true);
    });

    it('should block request if limit exceeded in window', async () => {
        db.runTransaction.mockImplementation(async textCallback => {
            const mockDoc = {
                exists: true,
                data: () => ({
                    count: 5,
                    windowStart: { toMillis: () => Date.now() - 1000 } // Window started 1s ago
                })
            };
            const mockT = {
                get: jest.fn().mockResolvedValue(mockDoc),
                set: jest.fn(),
                update: jest.fn()
            };

            // Allow the callback (which contains logic to throw error) to run
            await textCallback(mockT);
        });

        const result = await checkRateLimit('test_key', 5, 60);
        expect(result).toBe(false);
    });
});
