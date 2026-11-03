/**
 * A name search starts at two letters. One letter would run five prefix reads
 * of up to 30 whole applications each, so it keeps the list as it is and reads
 * nothing; a second letter searches.
 *
 * All ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ reads: [] }));

vi.mock('firebase/firestore', () => {
    const record = (kind) => (...args) => ({ kind, args });
    return {
        collection: (_db, ...path) => ({ path: path.join('/') }),
        doc: (_db, ...path) => ({ path: path.join('/') }),
        query: (base, ...constraints) => ({ path: base.path, constraints }),
        where: record('where'),
        orderBy: record('orderBy'),
        limit: record('limit'),
        startAt: record('startAt'),
        startAfter: record('startAfter'),
        endAt: record('endAt'),
        endBefore: record('endBefore'),
        documentId: () => '__name__',
        getDoc: async (ref) => {
            fx.reads.push({ kind: 'doc', path: ref.path });
            throw new Error('Missing or insufficient permissions.');
        },
        getDocs: async (q) => {
            fx.reads.push({ kind: 'docs', path: q.path, constraints: q.constraints });
            return { docs: [] };
        },
        getCountFromServer: async (q) => {
            fx.reads.push({ kind: 'count', path: q.path });
            return { data: () => ({ count: 0 }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ currentCompanyProfile: { id: 'co-1', teamMembers: [] }, currentUserClaims: null }) }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => true }));

import { useCompanyDashboard } from './useCompanyDashboard';

afterEach(() => {
    fx.reads = [];
});

/** Longer than the list's 400 ms pause in typing. */
const pastTheDebounce = () => act(() => new Promise((resolve) => { setTimeout(resolve, 450); }));

const listReads = () => fx.reads.filter((read) => read.kind === 'docs');
const lowerBounds = (read) => read.constraints
    .filter((constraint) => constraint.kind === 'where' && constraint.args[1] === '>=')
    .map((constraint) => [constraint.args[0], constraint.args[2]]);

describe('a candidate list name search', () => {
    it('reads nothing for one letter and searches from the second', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));
        await waitFor(() => expect(listReads()).toHaveLength(1));
        await waitFor(() => expect(result.current.loading).toBe(false));
        fx.reads = [];

        act(() => result.current.setSearchQuery('m'));
        await pastTheDebounce();
        expect(fx.reads).toEqual([]);
        expect(result.current.searchQuery).toBe('m');
        expect(result.current.loading).toBe(false);

        act(() => result.current.setSearchQuery('ma'));
        await waitFor(() => expect(listReads()).toHaveLength(5));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const reads = listReads();
        expect(reads.every((read) => read.path === 'companies/co-1/applications')).toBe(true);
        expect(reads.every((read) => lowerBounds(read).length === 1)).toBe(true);
        const bounds = reads.flatMap(lowerBounds);
        expect(bounds).toContainEqual(['firstNameNormalized', 'ma']);
        expect(bounds).toContainEqual(['lastName', 'Ma']);
    });

    it('goes back to the whole list when the box is cut back to one letter', async () => {
        const { result } = renderHook(() => useCompanyDashboard('co-1'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        act(() => result.current.setSearchQuery('ma'));
        await waitFor(() => expect(listReads().length).toBeGreaterThan(1));
        await waitFor(() => expect(result.current.loading).toBe(false));
        fx.reads = [];

        act(() => result.current.setSearchQuery('m'));
        await waitFor(() => expect(listReads()).toHaveLength(1));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const [browse] = listReads();
        expect(lowerBounds(browse)).toEqual([]);
        expect(browse.constraints).toContainEqual({ kind: 'limit', args: [20] });
    });
});
