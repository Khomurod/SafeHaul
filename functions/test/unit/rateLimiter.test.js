// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkRateLimit } from '../../shared/rateLimiter';
import { db } from '../../firebaseAdmin';

vi.mock('../../firebaseAdmin', () => {
    const firestoreMock = {
        collection: vi.fn().mockReturnThis(),
        doc: vi.fn().mockReturnThis(),
        runTransaction: vi.fn(),
        settings: vi.fn()
    };
    return {
        admin: {
            firestore: {
                Timestamp: {
                    now: () => ({ toMillis: () => Date.now() }),
                    fromMillis: (ms) => ({ toMillis: () => ms })
                },
                FieldValue: {
                    increment: vi.fn()
                }
            }
        },
        db: firestoreMock
    };
});

describe('Rate Limiter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should allow request if no record exists', async () => {
        db.runTransaction.mockImplementation(async textCallback => {
            const mockDoc = { exists: false, data: () => ({}) };
            const mockT = {
                get: vi.fn().mockResolvedValue(mockDoc),
                set: vi.fn(),
                update: vi.fn()
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
                get: vi.fn().mockResolvedValue(mockDoc),
                set: vi.fn(),
                update: vi.fn()
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
