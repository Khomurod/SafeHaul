/**
 * The dossier reads a driver record's signing documents with an equality query
 * only (no `orderBy`, so no composite index), sorted in the browser, and for an
 * application merges in the company's required post-application forms. All ids
 * and titles are artificial.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fb = vi.hoisted(() => ({ listeners: [], company: null, companyError: null, getDocCalls: [] }));

vi.mock('@lib/firebase', () => ({ db: { __db: true } }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ __path: path.join('/') }),
    doc: (_db, ...path) => ({ __path: path.join('/') }),
    where: (...args) => ({ __where: args }),
    query: (ref, ...constraints) => ({ ref, constraints }),
    getDoc: async (ref) => {
        fb.getDocCalls.push(ref.__path);
        if (fb.companyError) throw fb.companyError;
        return { exists: () => fb.company !== null, data: () => fb.company };
    },
    onSnapshot: (q, next, fail) => {
        const listener = {
            q,
            unsubscribe: vi.fn(),
            answer: (rows) => next({ docs: rows.map(({ id, ...data }) => ({ id, data: () => data })) }),
            fail,
        };
        fb.listeners.push(listener);
        return listener.unsubscribe;
    },
}));

import { useRecordSigningRequests } from './useRecordSigningRequests';

const seconds = (s) => ({ seconds: s });

beforeEach(() => {
    Object.assign(fb, { listeners: [], company: null, companyError: null, getDocCalls: [] });
});

describe('an application\'s signing documents', () => {
    it('reads its linked requests by equality alone and adds each required form no request carries', async () => {
        fb.company = {
            postApplicationTemplates: [
                { templateId: 'tpl-w9', title: 'W-9', enabled: true, required: true },
                { templateId: 'tpl-dd', title: 'Direct deposit', enabled: true, required: false },
                { templateId: 'tpl-off', title: 'Retired', enabled: false, required: true },
                'tpl-legacy',
            ],
        };
        const { result } = renderHook(() => useRecordSigningRequests({ companyId: 'co-1', recordId: 'app-1', collectionName: 'applications' }));

        const [listener] = fb.listeners;
        expect(listener.q.ref.__path).toBe('companies/co-1/signing_requests');
        expect(listener.q.constraints).toEqual([{ __where: ['sourceApplicationId', '==', 'app-1'] }]);
        listener.answer([
            { id: 'r-1', templateId: 'tpl-x', title: 'Older', status: 'signed', createdAt: seconds(100) },
            { id: 'r-2', templateId: 'tpl-y', title: 'Newer', status: 'sent', createdAt: seconds(200) },
        ]);

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(fb.getDocCalls).toEqual(['companies/co-1']);
        expect(result.current.rows.map((row) => [row.title, row.state])).toEqual([
            ['W-9', 'not_started'],
            ['Complete Form', 'not_started'],
            ['Newer', 'awaiting'],
            ['Older', 'signed'],
        ]);
        expect(result.current.error).toBeNull();
    });

    it('still lists the requests when the company\'s forms cannot be read, and says so', async () => {
        fb.companyError = new Error('offline');
        const { result } = renderHook(() => useRecordSigningRequests({ companyId: 'co-1', recordId: 'app-1', collectionName: 'applications' }));
        fb.listeners[0].answer([{ id: 'r-1', title: 'Lease', status: 'sent', createdAt: seconds(1) }]);

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(result.current.rows.map((row) => row.title)).toEqual(['Lease']);
        expect(result.current.formsError).toBe('Could not load the company\'s post-application forms.');
    });

    it('reports a list that cannot be read, and stops listening when it closes', async () => {
        fb.company = { postApplicationTemplates: [] };
        const { result, unmount } = renderHook(() => useRecordSigningRequests({ companyId: 'co-1', recordId: 'app-1', collectionName: 'applications' }));
        fb.listeners[0].fail(new Error('denied'));

        await waitFor(() => expect(result.current).toMatchObject({
            error: 'Could not load this driver\'s signing documents.',
            isLoading: false,
        }));
        unmount();
        expect(fb.listeners[0].unsubscribe).toHaveBeenCalledTimes(1);
    });
});

describe('a lead\'s signing documents', () => {
    it('reads the requests linked by sourceLeadId and no post-application forms', async () => {
        const { result } = renderHook(() => useRecordSigningRequests({ companyId: 'co-1', recordId: 'lead-1', collectionName: 'leads' }));

        expect(fb.listeners[0].q.constraints).toEqual([{ __where: ['sourceLeadId', '==', 'lead-1'] }]);
        fb.listeners[0].answer([{ id: 'r-1', templateId: 'tpl-w9', title: 'W-9', status: 'sent', createdAt: seconds(1) }]);

        await waitFor(() => expect(result.current.isLoading).toBe(false));
        expect(fb.getDocCalls).toEqual([]);
        expect(result.current.rows).toHaveLength(1);
        expect(result.current.rows[0]).toMatchObject({ kind: 'request', canSend: false });
    });
});
