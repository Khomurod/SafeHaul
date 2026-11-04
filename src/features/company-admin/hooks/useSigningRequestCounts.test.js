import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Builders return inspectable objects; `getCountFromServer` answers by the
// filter it is given. All numbers are artificial.
const fs = vi.hoisted(() => ({
    collection: vi.fn((_db, ...segments) => ({ __collection: segments.join('/') })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    where: vi.fn((field, op, value) => ({ kind: 'where', field, op, value })),
    or: vi.fn((...filters) => ({ kind: 'or', filters })),
    and: vi.fn((...filters) => ({ kind: 'and', filters })),
    orderBy: vi.fn((field, direction) => ({ kind: 'orderBy', field, direction })),
    getCountFromServer: vi.fn(),
}));

vi.mock('firebase/firestore', () => fs);
vi.mock('@lib/firebase', () => ({ db: {} }));

import { useSigningRequestCounts } from './useSigningRequestCounts';

const COUNTS = { total: 412, awaiting: 60, awaitingFailed: 7, completed: 300, needsAttention: 19 };

/** Which of the five counts a query is, from its one filter. */
function countName(countQuery) {
    const [filter] = countQuery.constraints;
    if (!filter) return 'total';
    if (filter.kind === 'and') return 'awaitingFailed';
    if (filter.kind === 'or') return 'needsAttention';
    return filter.value.includes('sent') ? 'awaiting' : 'completed';
}

beforeEach(() => {
    vi.resetAllMocks();
    fs.collection.mockImplementation((_db, ...segments) => ({ __collection: segments.join('/') }));
    fs.query.mockImplementation((ref, ...constraints) => ({ ref, constraints }));
    fs.where.mockImplementation((field, op, value) => ({ kind: 'where', field, op, value }));
    fs.or.mockImplementation((...filters) => ({ kind: 'or', filters }));
    fs.and.mockImplementation((...filters) => ({ kind: 'and', filters }));
    fs.getCountFromServer.mockImplementation(async (q) => ({ data: () => ({ count: COUNTS[countName(q)] }) }));
});

describe('useSigningRequestCounts', () => {
    it('reads five counts of the company’s signing requests, without an orderBy', async () => {
        const { result } = renderHook(() => useSigningRequestCounts({ companyId: 'co-1', enabled: true, refreshKey: '0:0' }));
        await waitFor(() => expect(result.current.summary).not.toBe(null));

        expect(fs.collection).toHaveBeenCalledWith({}, 'companies', 'co-1', 'signing_requests');
        const queries = fs.getCountFromServer.mock.calls.map(([q]) => q);
        expect(queries.map(countName)).toEqual(['total', 'awaiting', 'awaitingFailed', 'completed', 'needsAttention']);
        expect(queries.every((q) => q.ref.__collection === 'companies/co-1/signing_requests')).toBe(true);
        expect(fs.orderBy).not.toHaveBeenCalled();
    });

    it('leaves the awaiting documents whose send failed out of Awaiting signature', async () => {
        const { result } = renderHook(() => useSigningRequestCounts({ companyId: 'co-1', enabled: true, refreshKey: '0:0' }));
        await waitFor(() => expect(result.current.summary).toEqual({
            total: 412,
            awaitingSignature: 53,
            completed: 300,
            needsAttention: 19,
        }));
        expect(result.current.error).toBe(null);
    });

    it('reads nothing while disabled', async () => {
        const { result } = renderHook(() => useSigningRequestCounts({ companyId: 'co-1', enabled: false, refreshKey: '0:0' }));
        await act(async () => {});
        expect(fs.getCountFromServer).not.toHaveBeenCalled();
        expect(result.current.summary).toBe(null);
    });

    it('has no summary, and an error, when a count fails', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.getCountFromServer.mockImplementation(async (q) => {
            if (countName(q) === 'awaitingFailed') throw new Error('failed-precondition');
            return { data: () => ({ count: 1 }) };
        });
        const { result } = renderHook(() => useSigningRequestCounts({ companyId: 'co-1', enabled: true, refreshKey: '0:0' }));
        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.summary).toBe(null);

        fs.getCountFromServer.mockImplementation(async (q) => ({ data: () => ({ count: COUNTS[countName(q)] }) }));
        act(() => { result.current.refresh(); });
        await waitFor(() => expect(result.current.summary?.total).toBe(412));
        expect(result.current.error).toBe(null);
        consoleError.mockRestore();
    });
});
