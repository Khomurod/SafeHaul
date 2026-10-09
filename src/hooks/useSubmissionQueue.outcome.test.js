/**
 * How a replayed guest submission ends, as the queue hook tells it: a refusal
 * stops the entry instead of being retried, each end reaches the page of the
 * application it was (with a sent one's confirmation kept for this tab), a
 * dropped one reaches nobody, and the queue sends what is due while a page of
 * the site stays open, without waiting for the connection to drop and return.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubmissionQueue } from './useSubmissionQueue';
import { QUEUED_APPLICATION_EVENT } from '../features/driver-app/components/application/queuedApplicationOutcome';
import { readPostApplySession } from '../features/driver-app/components/application/postApplyDocsStorage';

const queue = vi.hoisted(() => ({ pending: [], run: null }));
const callable = vi.hoisted(() => ({ answer: null, calls: [] }));

vi.mock('@lib/submissionQueue', () => ({
    initQueue: async () => undefined,
    getAllPending: async () => queue.pending,
    getAllEntries: async () => queue.pending,
    getQueueCount: async () => queue.pending.length,
    dequeueSubmission: async () => true,
    processQueue: async (submitFn) => queue.run(submitFn),
    isSupported: () => true,
}));
vi.mock('@lib/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
    httpsCallable: () => async (payload) => {
        callable.calls.push(payload);
        return callable.answer(payload);
    },
}));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), setDoc: async () => undefined, getDoc: async () => ({ exists: () => false }) }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: () => {}, captureException: () => {}, captureMessage: () => {} }));

const ENTRY = { id: 'q1', type: 'guest', companyId: 'co-1', applySlug: 'acme', applyDraftId: 'draft-a', applyDiscardMark: null, data: {} };

function heardEnds() {
    const ends = [];
    const listener = (event) => ends.push(event.detail);
    window.addEventListener(QUEUED_APPLICATION_EVENT, listener);
    return { ends, stop: () => window.removeEventListener(QUEUED_APPLICATION_EVENT, listener) };
}

async function runQueueOnce() {
    const { result } = renderHook(() => useSubmissionQueue());
    // The queue is ready once it has counted what waits.
    await waitFor(() => expect(result.current.pendingCount).toBe(queue.pending.length));
    await act(async () => { await result.current.processQueueNow(); });
    return result;
}

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    queue.pending = [{ ...ENTRY }];
    callable.calls = [];
    callable.answer = async () => ({ data: { applicationId: 'app-9', confirmationNumber: 'CONF-9' } });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('a replayed guest submission', () => {
    it('is refused for good when the server refuses it, not retried', async () => {
        callable.answer = async () => { throw Object.assign(new Error('Missing required uploaded documents: CDL Front.'), { code: 'functions/invalid-argument' }); };
        let thrown;
        queue.run = async (submitFn) => {
            thrown = await submitFn(ENTRY.data, ENTRY.companyId, ENTRY).catch((error) => error);
            return { processed: 1, succeeded: 0, failed: 1, settled: [] };
        };
        await runQueueOnce();
        expect(thrown.final).toBe(true);
    });

    it('is retried when it never reached the server', async () => {
        callable.answer = async () => { throw Object.assign(new Error('internal'), { code: 'functions/internal' }); };
        let thrown;
        queue.run = async (submitFn) => {
            thrown = await submitFn(ENTRY.data, ENTRY.companyId, ENTRY).catch((error) => error);
            return { processed: 1, succeeded: 0, failed: 1, settled: [] };
        };
        await runQueueOnce();
        expect(thrown.final).toBeUndefined();
    });

    it('sends the revision of the Company Admin edits the page had taken', async () => {
        queue.run = async (submitFn) => {
            await submitFn(ENTRY.data, ENTRY.companyId, { ...ENTRY, seenRevision: 2 });
            return { processed: 1, succeeded: 1, failed: 0, settled: [] };
        };
        await runQueueOnce();
        expect(callable.calls[0].seenRevision).toBe(2);
    });
});

describe('the end of a replayed guest submission', () => {
    it('reaches the page, and a sent one keeps its confirmation for this tab', async () => {
        const heard = heardEnds();
        queue.run = async (submitFn) => {
            const result = await submitFn(ENTRY.data, ENTRY.companyId, ENTRY);
            return { processed: 1, succeeded: 1, failed: 0, settled: [{ entry: ENTRY, outcome: 'sent', result }] };
        };
        await runQueueOnce();
        heard.stop();

        expect(heard.ends).toEqual([expect.objectContaining({
            slug: 'acme', outcome: 'sent', applyDraftId: 'draft-a', applicationId: 'app-9', confirmationNumber: 'CONF-9',
        })]);
        expect(readPostApplySession('co-1')).toMatchObject({ applicationId: 'app-9', confirmationNumber: 'CONF-9', slug: 'acme' });
    });

    it('reaches the page with the server\'s sentence and the page it names when refused', async () => {
        const heard = heardEnds();
        const refusal = Object.assign(new Error('Missing required uploaded documents: CDL Front.'), {
            details: { issues: [{ code: 'missing-upload', semanticStep: 'license', fieldId: null }] },
        });
        queue.run = async () => ({ processed: 1, succeeded: 0, failed: 1, settled: [{ entry: ENTRY, outcome: 'refused', error: refusal }] });
        await runQueueOnce();
        heard.stop();

        expect(heard.ends).toEqual([expect.objectContaining({
            outcome: 'refused',
            message: 'Missing required uploaded documents: CDL Front.',
            issues: [{ code: 'missing-upload', semanticStep: 'license', fieldId: null }],
        })]);
        expect(readPostApplySession('co-1')).toBeNull();
    });

    it('reaches nobody when the application was discarded and nothing was sent', async () => {
        localStorage.setItem('apply_discarded_acme', 'discard:after-queueing');
        const heard = heardEnds();
        queue.run = async (submitFn) => {
            const result = await submitFn(ENTRY.data, ENTRY.companyId, ENTRY);
            return { processed: 1, succeeded: 1, failed: 0, settled: [{ entry: ENTRY, outcome: 'sent', result }] };
        };
        await runQueueOnce();
        heard.stop();

        expect(callable.calls).toHaveLength(0);
        expect(heard.ends).toEqual([]);
    });
});

describe('while a page of the site stays open', () => {
    it('sends what is due without waiting for the connection to drop and return', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        queue.pending = [{ ...ENTRY, nextRetryAt: Date.now() + 90_000 }];
        queue.run = vi.fn(async () => ({ processed: 1, succeeded: 0, failed: 1, settled: [] }));
        renderHook(() => useSubmissionQueue());
        // On load it looks once, as it always has.
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        const atLoad = queue.run.mock.calls.length;

        // Not yet due: the looks every 30 s leave it alone.
        await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
        expect(queue.run.mock.calls.length).toBe(atLoad);

        // Its time has come: the next look sends it.
        await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
        expect(queue.run.mock.calls.length).toBe(atLoad + 1);
    });
});
