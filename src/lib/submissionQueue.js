/**
 * Submission Queue Service
 * 
 * Provides guaranteed delivery for driver applications using IndexedDB.
 * If a submission fails, it's stored locally and retried automatically
 * when connectivity is restored.
 * 
 * @module submissionQueue
 */

import { v4 as uuidv4 } from 'uuid';

// Database configuration
const DB_NAME = 'SafeHaulSubmissionQueue';
const DB_VERSION = 1;
const STORE_NAME = 'pending_submissions';

// Retry configuration
const MAX_RETRIES = 10;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 60000; // 1 minute max

/** @type {IDBDatabase | null} */
let db = null;

/**
 * Initialize the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export async function initQueue() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            console.error('[SubmissionQueue] Failed to open database:', request.error);
            reject(new Error('Failed to initialize submission queue'));
        };

        request.onsuccess = () => {
            db = request.result;
            console.log('[SubmissionQueue] Database initialized');
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('status', 'status', { unique: false });
                store.createIndex('companyId', 'companyId', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
                console.log('[SubmissionQueue] Object store created');
            }
        };
    });
}

/**
 * Ensure database is initialized
 * @returns {Promise<IDBDatabase>}
 */
async function ensureDb() {
    if (!db) {
        await initQueue();
    }
    return db;
}

/**
 * Add a submission to the queue
 * @param {Object} data - Full form data to submit
 * @param {string} companyId - Target company ID
 * @param {Object} options - Additional options
 * @param {string} [options.type='authenticated'] - 'authenticated' or 'guest'
 * @param {string} [options.userId] - User ID for authenticated submissions
 * @returns {Promise<string>} Queue entry ID
 */
export async function enqueueSubmission(data, companyId, options = {}) {
    await ensureDb();

    const entry = {
        id: uuidv4(),
        companyId,
        data: { ...data }, // Deep copy to avoid mutations
        type: options.type || 'authenticated',
        userId: options.userId || null,
        createdAt: Date.now(),
        attempts: 0,
        lastAttemptAt: null,
        nextRetryAt: null,
        status: 'pending', // pending, processing, failed, completed
        lastError: null,
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(entry);

        request.onsuccess = () => {
            console.log(`[SubmissionQueue] Enqueued submission ${entry.id}`);
            resolve(entry.id);
        };

        request.onerror = () => {
            console.error('[SubmissionQueue] Failed to enqueue:', request.error);
            reject(new Error('Failed to queue submission'));
        };
    });
}

/**
 * Remove a submission from the queue (after successful submission)
 * @param {string} id - Queue entry ID
 * @returns {Promise<boolean>}
 */
export async function dequeueSubmission(id) {
    await ensureDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log(`[SubmissionQueue] Dequeued submission ${id}`);
            resolve(true);
        };

        request.onerror = () => {
            console.error('[SubmissionQueue] Failed to dequeue:', request.error);
            reject(new Error('Failed to remove from queue'));
        };
    });
}

/**
 * Update a queue entry
 * @param {string} id - Queue entry ID
 * @param {Object} updates - Fields to update
 * @returns {Promise<boolean>}
 */
export async function updateQueueEntry(id, updates) {
    await ensureDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const entry = getRequest.result;
            if (!entry) {
                reject(new Error(`Queue entry ${id} not found`));
                return;
            }

            const updated = { ...entry, ...updates };
            const putRequest = store.put(updated);

            putRequest.onsuccess = () => resolve(true);
            putRequest.onerror = () => reject(new Error('Failed to update queue entry'));
        };

        getRequest.onerror = () => reject(new Error('Failed to get queue entry'));
    });
}

/**
 * Get a single queue entry by ID
 * @param {string} id - Queue entry ID
 * @returns {Promise<Object|null>}
 */
export async function getQueueEntry(id) {
    await ensureDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(new Error('Failed to get queue entry'));
    });
}

/**
 * Get all pending submissions
 * @returns {Promise<Array>}
 */
export async function getAllPending() {
    await ensureDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index('status');
        const request = index.getAll('pending');

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(new Error('Failed to get pending submissions'));
    });
}

/**
 * Get all queue entries (any status)
 * @returns {Promise<Array>}
 */
export async function getAllEntries() {
    await ensureDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(new Error('Failed to get all entries'));
    });
}

/**
 * Get the count of pending submissions
 * @returns {Promise<number>}
 */
export async function getQueueCount() {
    const pending = await getAllPending();
    return pending.length;
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Attempt number (0-based)
 * @returns {number} Delay in milliseconds
 */
function calculateBackoff(attempt) {
    const delay = Math.min(
        INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt),
        MAX_RETRY_DELAY_MS
    );
    // Add jitter (±25%)
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
}

/**
 * Process a single queue entry
 * @param {Object} entry - Queue entry
 * @param {Function} submitFn - Async function that performs the actual submission
 * @returns {Promise<{success: boolean, error?: Error}>}
 */
export async function processEntry(entry, submitFn) {
    if (!entry || entry.status !== 'pending') {
        return { success: false, error: new Error('Invalid entry or not pending') };
    }

    // Check if it's time to retry
    if (entry.nextRetryAt && Date.now() < entry.nextRetryAt) {
        return { success: false, error: new Error('Not time to retry yet') };
    }

    // Check max retries
    if (entry.attempts >= MAX_RETRIES) {
        await updateQueueEntry(entry.id, {
            status: 'failed',
            lastError: 'Max retries exceeded'
        });
        return { success: false, error: new Error('Max retries exceeded') };
    }

    // Mark as processing
    await updateQueueEntry(entry.id, {
        status: 'processing',
        lastAttemptAt: Date.now(),
        attempts: entry.attempts + 1,
    });

    try {
        // Attempt submission
        await submitFn(entry.data, entry.companyId, entry);

        // Success - remove from queue
        await dequeueSubmission(entry.id);
        console.log(`[SubmissionQueue] Successfully processed ${entry.id}`);
        return { success: true };

    } catch (error) {
        console.error(`[SubmissionQueue] Attempt ${entry.attempts + 1} failed:`, error);

        const nextDelay = calculateBackoff(entry.attempts);
        await updateQueueEntry(entry.id, {
            status: 'pending',
            lastError: error.message,
            nextRetryAt: Date.now() + nextDelay,
        });

        return { success: false, error };
    }
}

/**
 * Process all pending submissions in the queue
 * @param {Function} submitFn - Async function that performs the actual submission
 * @returns {Promise<{processed: number, succeeded: number, failed: number}>}
 */
export async function processQueue(submitFn) {
    const pending = await getAllPending();
    console.log(`[SubmissionQueue] Processing ${pending.length} pending submissions`);

    const results = { processed: 0, succeeded: 0, failed: 0 };

    for (const entry of pending) {
        const result = await processEntry(entry, submitFn);
        results.processed++;

        if (result.success) {
            results.succeeded++;
        } else {
            results.failed++;
        }
    }

    console.log(`[SubmissionQueue] Processed: ${results.processed}, Succeeded: ${results.succeeded}, Failed: ${results.failed}`);
    return results;
}

/**
 * Clear all entries from the queue (use with caution!)
 * @returns {Promise<void>}
 */
export async function clearQueue() {
    await ensureDb();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
            console.log('[SubmissionQueue] Queue cleared');
            resolve();
        };

        request.onerror = () => reject(new Error('Failed to clear queue'));
    });
}

/**
 * Close the database connection (mainly for testing)
 */
export function closeQueue() {
    if (db) {
        db.close();
        db = null;
        console.log('[SubmissionQueue] Database closed');
    }
}

/**
 * Check if the browser supports IndexedDB
 * @returns {boolean}
 */
export function isSupported() {
    return typeof indexedDB !== 'undefined';
}
