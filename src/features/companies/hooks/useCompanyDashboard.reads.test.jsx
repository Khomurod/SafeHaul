/**
 * A candidate list reads its own records and their counts, and not the
 * dashboard's four counts, which it never shows: a failed dashboard count can
 * no longer turn the list into an error.
 *
 * All ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

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
            fx.reads.push({ kind: 'docs', path: q.path });
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

const pathsRead = () => [...new Set(fx.reads.map((read) => read.path))];

describe('a candidate list', () => {
    it.each([
        ['applications', 'companies/co-1/applications'],
        ['company_leads', 'companies/co-1/leads'],
        ['my_leads', 'companies/co-1/leads'],
    ])('on %s reads only its own collection', async (tab, own) => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialTab: tab }));

        await waitFor(() => expect(fx.reads.some((read) => read.kind === 'docs')).toBe(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(pathsRead()).toEqual([own]);
        expect(result.current.error).toBe('');
        expect(result.current.listCountError).toBe('');
    });
});
