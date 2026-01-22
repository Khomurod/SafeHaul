/**
 * Unit tests for Submission Queue Service
 * 
 * Tests IndexedDB operations using fake-indexeddb
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';

// Import the queue service
import {
    initQueue,
    enqueueSubmission,
    dequeueSubmission,
    getQueueEntry,
    getAllPending,
    getAllEntries,
    getQueueCount,
    updateQueueEntry,
    processEntry,
    processQueue,
    clearQueue,
    closeQueue,
    isSupported,
} from './submissionQueue';

describe('Submission Queue Service', () => {
    beforeEach(async () => {
        // Initialize fresh database for each test
        await initQueue();
    });

    afterEach(async () => {
        // Clean up after each test
        await clearQueue();
        closeQueue();
    });

    describe('isSupported', () => {
        it('should return true when IndexedDB is available', () => {
            expect(isSupported()).toBe(true);
        });
    });

    describe('initQueue', () => {
        it('should initialize the database successfully', async () => {
            // Already initialized in beforeEach, but let's test idempotency
            const result = await initQueue();
            expect(result).toBeDefined();
        });
    });

    describe('enqueueSubmission', () => {
        it('should add a submission to the queue and return an ID', async () => {
            const data = { firstName: 'John', lastName: 'Doe', email: 'john@example.com' };
            const companyId = 'company-123';

            const queueId = await enqueueSubmission(data, companyId);

            expect(queueId).toBeDefined();
            expect(typeof queueId).toBe('string');
            expect(queueId.length).toBeGreaterThan(0);
        });

        it('should store all submission data correctly', async () => {
            const data = {
                firstName: 'Jane',
                lastName: 'Smith',
                email: 'jane@example.com',
                phone: '555-1234',
                signature: 'data:image/png;base64,abc123'
            };
            const companyId = 'company-456';

            const queueId = await enqueueSubmission(data, companyId, {
                type: 'guest',
                userId: null
            });

            const entry = await getQueueEntry(queueId);

            expect(entry).toBeDefined();
            expect(entry.companyId).toBe(companyId);
            expect(entry.data.firstName).toBe('Jane');
            expect(entry.data.email).toBe('jane@example.com');
            expect(entry.type).toBe('guest');
            expect(entry.status).toBe('pending');
            expect(entry.attempts).toBe(0);
        });

        it('should set default values for options', async () => {
            const data = { firstName: 'Test' };
            const queueId = await enqueueSubmission(data, 'company-1');

            const entry = await getQueueEntry(queueId);

            expect(entry.type).toBe('authenticated');
            expect(entry.userId).toBeNull();
        });

        it('should handle multiple enqueues', async () => {
            await enqueueSubmission({ name: 'A' }, 'company-1');
            await enqueueSubmission({ name: 'B' }, 'company-2');
            await enqueueSubmission({ name: 'C' }, 'company-1');

            const count = await getQueueCount();
            expect(count).toBe(3);
        });
    });

    describe('dequeueSubmission', () => {
        it('should remove a submission from the queue', async () => {
            const queueId = await enqueueSubmission({ test: true }, 'company-1');

            const countBefore = await getQueueCount();
            expect(countBefore).toBe(1);

            await dequeueSubmission(queueId);

            const countAfter = await getQueueCount();
            expect(countAfter).toBe(0);

            const entry = await getQueueEntry(queueId);
            expect(entry).toBeNull();
        });
    });

    describe('getQueueEntry', () => {
        it('should return null for non-existent entry', async () => {
            const entry = await getQueueEntry('non-existent-id');
            expect(entry).toBeNull();
        });

        it('should return the correct entry', async () => {
            const queueId = await enqueueSubmission({ unique: 'data-123' }, 'company-x');

            const entry = await getQueueEntry(queueId);
            expect(entry.data.unique).toBe('data-123');
        });
    });

    describe('getAllPending', () => {
        it('should return empty array when queue is empty', async () => {
            const pending = await getAllPending();
            expect(pending).toEqual([]);
        });

        it('should return only pending entries', async () => {
            const id1 = await enqueueSubmission({ n: 1 }, 'c1');
            const id2 = await enqueueSubmission({ n: 2 }, 'c2');

            // Mark one as failed
            await updateQueueEntry(id1, { status: 'failed' });

            const pending = await getAllPending();
            expect(pending.length).toBe(1);
            expect(pending[0].id).toBe(id2);
        });
    });

    describe('updateQueueEntry', () => {
        it('should update entry fields', async () => {
            const queueId = await enqueueSubmission({ test: true }, 'c1');

            await updateQueueEntry(queueId, {
                status: 'processing',
                attempts: 1,
                lastAttemptAt: Date.now(),
            });

            const entry = await getQueueEntry(queueId);
            expect(entry.status).toBe('processing');
            expect(entry.attempts).toBe(1);
            expect(entry.lastAttemptAt).toBeDefined();
        });

        it('should reject for non-existent entry', async () => {
            await expect(
                updateQueueEntry('fake-id', { status: 'failed' })
            ).rejects.toThrow();
        });
    });

    describe('processEntry', () => {
        it('should process and dequeue on successful submission', async () => {
            const queueId = await enqueueSubmission({ data: 'test' }, 'c1');
            const entry = await getQueueEntry(queueId);

            const mockSubmit = vi.fn().mockResolvedValue(true);

            const result = await processEntry(entry, mockSubmit);

            expect(result.success).toBe(true);
            expect(mockSubmit).toHaveBeenCalledWith(entry.data, entry.companyId, expect.any(Object));

            // Should be removed from queue
            const afterEntry = await getQueueEntry(queueId);
            expect(afterEntry).toBeNull();
        });

        it('should increment attempts and set next retry on failure', async () => {
            const queueId = await enqueueSubmission({ data: 'test' }, 'c1');
            let entry = await getQueueEntry(queueId);

            const mockSubmit = vi.fn().mockRejectedValue(new Error('Network error'));

            const result = await processEntry(entry, mockSubmit);

            expect(result.success).toBe(false);
            expect(result.error.message).toBe('Network error');

            entry = await getQueueEntry(queueId);
            expect(entry.status).toBe('pending');
            expect(entry.attempts).toBe(1);
            expect(entry.lastError).toBe('Network error');
            expect(entry.nextRetryAt).toBeGreaterThan(Date.now());
        });

        it('should mark as failed after max retries', async () => {
            const queueId = await enqueueSubmission({ data: 'test' }, 'c1');

            // Set to max retries
            await updateQueueEntry(queueId, { attempts: 10 });
            let entry = await getQueueEntry(queueId);

            const mockSubmit = vi.fn();
            const result = await processEntry(entry, mockSubmit);

            expect(result.success).toBe(false);
            expect(mockSubmit).not.toHaveBeenCalled(); // Shouldn't even try

            entry = await getQueueEntry(queueId);
            expect(entry.status).toBe('failed');
        });

        it('should not process if not time to retry yet', async () => {
            const queueId = await enqueueSubmission({ data: 'test' }, 'c1');

            // Set next retry far in future
            await updateQueueEntry(queueId, { nextRetryAt: Date.now() + 60000 });
            const entry = await getQueueEntry(queueId);

            const mockSubmit = vi.fn();
            const result = await processEntry(entry, mockSubmit);

            expect(result.success).toBe(false);
            expect(mockSubmit).not.toHaveBeenCalled();
        });
    });

    describe('processQueue', () => {
        it('should process all pending submissions', async () => {
            await enqueueSubmission({ n: 1 }, 'c1');
            await enqueueSubmission({ n: 2 }, 'c2');
            await enqueueSubmission({ n: 3 }, 'c3');

            const mockSubmit = vi.fn().mockResolvedValue(true);

            const results = await processQueue(mockSubmit);

            expect(results.processed).toBe(3);
            expect(results.succeeded).toBe(3);
            expect(results.failed).toBe(0);
            expect(mockSubmit).toHaveBeenCalledTimes(3);

            const remaining = await getQueueCount();
            expect(remaining).toBe(0);
        });

        it('should handle mixed success and failure', async () => {
            await enqueueSubmission({ n: 1 }, 'c1');
            await enqueueSubmission({ n: 2 }, 'c2');

            let callCount = 0;
            const mockSubmit = vi.fn().mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve(true);
                } else {
                    return Promise.reject(new Error('Failed'));
                }
            });

            const results = await processQueue(mockSubmit);

            expect(results.processed).toBe(2);
            expect(results.succeeded).toBe(1);
            expect(results.failed).toBe(1);

            // One should remain in queue
            const remaining = await getQueueCount();
            expect(remaining).toBe(1);
        });
    });

    describe('clearQueue', () => {
        it('should remove all entries', async () => {
            await enqueueSubmission({ n: 1 }, 'c1');
            await enqueueSubmission({ n: 2 }, 'c2');

            await clearQueue();

            const all = await getAllEntries();
            expect(all.length).toBe(0);
        });
    });

    describe('getQueueCount', () => {
        it('should return correct count of pending items', async () => {
            expect(await getQueueCount()).toBe(0);

            await enqueueSubmission({ n: 1 }, 'c1');
            expect(await getQueueCount()).toBe(1);

            const id2 = await enqueueSubmission({ n: 2 }, 'c2');
            expect(await getQueueCount()).toBe(2);

            await updateQueueEntry(id2, { status: 'failed' });
            expect(await getQueueCount()).toBe(1);
        });
    });
});
