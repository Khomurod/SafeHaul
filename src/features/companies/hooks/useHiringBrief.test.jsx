import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * The dashboard's hiring brief: three server counts on the company's
 * applications, each the very query of the list its link opens, read once. No
 * record is downloaded, and nothing reads 0 that was not counted.
 */
const fs = vi.hoisted(() => ({ counts: [], fail: false, gate: null }));

vi.mock('firebase/firestore', () => {
    const record = (kind) => (...args) => ({ kind, args });
    return {
        collection: (_db, ...path) => ({ path: path.join('/') }),
        query: (base, ...constraints) => ({ path: base.path, constraints }),
        where: record('where'),
        orderBy: record('orderBy'),
        limit: record('limit'),
        startAt: record('startAt'),
        startAfter: record('startAfter'),
        endAt: record('endAt'),
        endBefore: record('endBefore'),
        documentId: () => '__name__',
        doc: record('doc'),
        getDoc: async () => ({ exists: () => false }),
        getDocs: async () => { throw new Error('the brief reads no records'); },
        getCountFromServer: async (q) => {
            fs.counts.push(q);
            if (fs.gate) await fs.gate;
            if (fs.fail) throw new Error('unavailable');
            const fields = q.constraints.filter((c) => c.kind === 'where').map((c) => c.args[0]);
            if (fields.includes('hiredAt')) return { data: () => ({ count: 3 }) };
            if (fields.includes('status')) return { data: () => ({ count: 42 }) };
            return { data: () => ({ count: 18 }) };
        },
    };
});
vi.mock('@lib/firebase', () => ({ db: {}, auth: { currentUser: { uid: 'recruiter-1' } } }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@lib/runtime/dashboardRollup', () => ({ shouldPreferDashboardRollup: () => false }));

import { useHiringBrief } from './useHiringBrief';
import { buildDashboardConstraints } from './dashboardQueries';
import { periodRange } from './dashboardPeriods';

const constraintsOf = (q) => q.constraints;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
});

afterEach(() => {
    vi.useRealTimers();
    Object.assign(fs, { counts: [], fail: false, gate: null });
});

describe('the hiring brief', () => {
    it("counts this month's applications, those in process and this month's hires, with the lists' own queries", async () => {
        vi.setSystemTime(new Date(2026, 10, 20, 12));
        const { result } = renderHook(() => useHiringBrief('co-1'));

        await waitFor(() => expect(result.current.brief).toEqual({ applications: 18, inProcess: 42, hired: 3 }));
        expect(result.current.month).toBe('2026-11');
        expect(fs.counts.map((q) => q.path)).toEqual(Array(3).fill('companies/co-1/applications'));

        const hires = periodRange({ field: 'hiredAt', month: '2026-11' });
        expect(fs.counts.map(constraintsOf)).toEqual([
            buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'all', filters: { period: { field: 'createdAt', month: '2026-11' } } }),
            buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'in_process', filters: {} }),
            [{ kind: 'where', args: ['hiredAt', '>=', hires.start] }, { kind: 'where', args: ['hiredAt', '<', hires.end] }],
        ]);
        // Hires count from the day hire dates began, not the first of the month.
        expect(hires.start).toEqual(new Date(2026, 10, 6));
    });

    it('is no number while the counts load', async () => {
        let open;
        fs.gate = new Promise((resolve) => { open = resolve; });
        vi.setSystemTime(new Date(2026, 11, 3, 12));
        const { result } = renderHook(() => useHiringBrief('co-1'));

        expect(result.current.isLoading).toBe(true);
        expect(result.current.brief).toBeNull();
        open();
        await waitFor(() => expect(result.current.brief).not.toBeNull());
        expect(result.current.month).toBe('2026-12');
    });

    it('is no number after a failed count, but an error to retry', async () => {
        fs.fail = true;
        vi.setSystemTime(new Date(2026, 10, 20, 12));
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useHiringBrief('co-1'));

        await waitFor(() => expect(result.current.error).toBeTruthy());
        expect(result.current.brief).toBeNull();

        fs.fail = false;
        result.current.refresh();
        await waitFor(() => expect(result.current.brief).toEqual({ applications: 18, inProcess: 42, hired: 3 }));
        errors.mockRestore();
    });

    it('asks nothing of hires for a month before hire dates began', async () => {
        vi.setSystemTime(new Date(2026, 9, 15, 12));
        const { result } = renderHook(() => useHiringBrief('co-1'));

        await waitFor(() => expect(result.current.brief).toEqual({ applications: 18, inProcess: 42, hired: 0 }));
        expect(fs.counts).toHaveLength(2);
    });

    it('reads nothing without a company', () => {
        const { result } = renderHook(() => useHiringBrief(undefined));

        expect(result.current.brief).toBeNull();
        expect(fs.counts).toEqual([]);
    });
});
