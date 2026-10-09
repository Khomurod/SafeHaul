/**
 * The queue loads a replay's draft close-out and its announcement only when it
 * needs them, since every page of the site carries the hook. A part that cannot
 * be loaded (an old tab after a release) must not turn an application the server
 * accepted into a failed attempt, nor stop the queue counting what still waits.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSubmissionQueue } from './useSubmissionQueue';

const queue = vi.hoisted(() => ({ pending: [], run: null }));

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
    httpsCallable: () => async () => ({ data: { applicationId: 'app-9', confirmationNumber: 'CONF-9' } }),
}));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), setDoc: async () => undefined, getDoc: async () => ({ exists: () => false }) }));
vi.mock('@sentry/react', () => ({ addBreadcrumb: () => {}, captureException: () => {}, captureMessage: () => {} }));
// Neither part can be loaded, as for a tab still running the release before.
vi.mock('../features/driver-app/services/applicationDraftService', () => { throw new Error('Failed to fetch dynamically imported module'); });
vi.mock('../features/driver-app/components/application/queuedApplicationOutcome', () => { throw new Error('Failed to fetch dynamically imported module'); });

const ENTRY = { id: 'q1', type: 'guest', companyId: 'co-1', applySlug: 'acme', applyDraftId: 'draft-a', applyDiscardMark: null, data: {} };

beforeEach(() => {
    localStorage.clear();
    queue.pending = [{ ...ENTRY }];
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('a part of the queue that cannot be loaded', () => {
    it('leaves a replay the server accepted sent, and the queue still counts what waits', async () => {
        let sent;
        queue.run = async (submitFn) => {
            sent = await submitFn(ENTRY.data, ENTRY.companyId, ENTRY);
            queue.pending = [];
            return { processed: 1, succeeded: 1, failed: 0, settled: [{ entry: ENTRY, outcome: 'sent', result: sent }] };
        };
        const { result } = renderHook(() => useSubmissionQueue());
        await waitFor(() => expect(result.current.pendingCount).toBe(1));

        let outcome;
        await act(async () => { outcome = await result.current.processQueueNow(); });

        expect(sent.data.confirmationNumber).toBe('CONF-9');
        expect(outcome).toMatchObject({ succeeded: 1 });
        expect(result.current.pendingCount).toBe(0);
        expect(result.current.error).toBeNull();
    });
});
