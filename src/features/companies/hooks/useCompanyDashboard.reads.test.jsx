/**
 * A candidate list reads its own records and their counts, and not the
 * dashboard's four counts, which it never shows: a failed dashboard count can
 * no longer turn the list into an error.
 *
 * All ids below are artificial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ reads: [], listError: null, countError: null }));

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
            if (fx.listError) throw fx.listError;
            return { docs: [] };
        },
        getCountFromServer: async (q) => {
            fx.reads.push({ kind: 'count', path: q.path });
            if (fx.countError) throw fx.countError;
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
    fx.listError = null;
    fx.countError = null;
    vi.restoreAllMocks();
});

const pathsRead = () => [...new Set(fx.reads.map((read) => read.path))];

describe('a candidate list', () => {
    it.each([
        ['applications', 'companies/co-1/applications'],
        ['company_leads', 'companies/co-1/leads'],
        ['my_leads', 'companies/co-1/leads'],
        ['unassigned_leads', 'companies/co-1/leads'],
    ])('on %s reads only its own collection', async (tab, own) => {
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialTab: tab }));

        await waitFor(() => expect(fx.reads.some((read) => read.kind === 'docs')).toBe(true));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(pathsRead()).toEqual([own]);
        expect(result.current.error).toBe('');
        expect(result.current.listCountError).toBe('');
    });
});

// The list once said "Missing Index: Please check the browser console…". The
// person reads a plain sentence; the index's creation link stays in the console.
describe('a candidate list that cannot be read', () => {
    const missingIndex = () => Object.assign(
        new Error('The query requires an index. You can create it here: https://console.firebase.google.com/example'),
        { code: 'failed-precondition' },
    );

    it('says the list could not be loaded, in a plain sentence', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
        fx.listError = missingIndex();
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialTab: 'applications' }));

        await waitFor(() => expect(result.current.error).not.toBe(''));
        expect(result.current.error).toBe(
            'The list could not be loaded. Please try again. If it keeps happening, contact support.',
        );
        expect(result.current.error).not.toMatch(/index|console/i);
        expect(errors).toHaveBeenCalledWith('Dashboard fetch error:', fx.listError);
        expect(warnings).toHaveBeenCalledWith('CLICK THIS LINK TO CREATE INDEX:', fx.listError);
    });

    it('says the total could not be counted, in a plain sentence', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        fx.countError = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        const { result } = renderHook(() => useCompanyDashboard('co-1', { initialTab: 'applications' }));

        await waitFor(() => expect(result.current.listCountError).not.toBe(''));
        expect(result.current.listCountError).toBe(
            'The total count could not be loaded. You do not have permission to do this. If you think you should, ask your company admin.',
        );
    });
});
