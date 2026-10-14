const { checkRateLimit } = require('../../shared/rateLimiter');
const { db } = require('../../firebaseAdmin');

jest.mock('../../firebaseAdmin', () => {
    const firestoreMock = {
        collection: jest.fn().mockReturnThis(),
        doc: jest.fn().mockReturnThis(),
        runTransaction: jest.fn(),
        settings: jest.fn()
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

    it('should deny on system error when failBehavior is closed (H6)', async () => {
        db.runTransaction.mockRejectedValue(new Error('Firestore unavailable'));

        const result = await checkRateLimit('test_key', 5, 60, 'closed');
        expect(result).toBe(false);
    });

    it('should allow on system error when failBehavior is open/default (H6)', async () => {
        db.runTransaction.mockRejectedValue(new Error('Firestore unavailable'));

        const result = await checkRateLimit('test_key', 5, 60, 'open');
        expect(result).toBe(true);
    });
});

describe('rate_limits retention', () => {
    const fs = require('fs');
    const path = require('path');
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../firestore.indexes.json'), 'utf8'));

    beforeEach(() => {
        jest.clearAllMocks();
        // The mocked Timestamp reads the clock whenever it is asked.
        jest.useFakeTimers({ now: Date.parse('2026-10-14T12:00:00Z') });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('declares the TTL policy that deletes a window once it has ended', () => {
        const override = (config.fieldOverrides || []).find((entry) => (
            entry.collectionGroup === 'rate_limits' && entry.fieldPath === 'expiresAt'
        ));

        expect(override).toBeDefined();
        expect(override.ttl).toBe(true);
    });

    it('stamps expiresAt at the end of the window, for a first request and for a new window', async () => {
        const writes = [];
        const run = (doc) => db.runTransaction.mockImplementation(async (callback) => {
            await callback({ get: jest.fn().mockResolvedValue(doc), set: (_ref, data) => writes.push(data), update: jest.fn() });
        });
        const before = Date.now();

        run({ exists: false, data: () => undefined });
        await checkRateLimit('test_key', 5, 60);
        run({ exists: true, data: () => ({ count: 5, windowStart: { toMillis: () => before - 120000 } }) });
        await checkRateLimit('test_key', 5, 60);

        expect(writes).toHaveLength(2);
        for (const data of writes) {
            expect(data.expiresAt.toMillis() - data.windowStart.toMillis()).toBe(60000);
        }
    });
});
