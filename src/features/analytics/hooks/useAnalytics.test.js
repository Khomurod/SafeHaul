/**
 * Analytics reads each company's daily stats side by side: the screen waits
 * for the slowest company, not for every company in turn. What it adds up is
 * unchanged — the totals, each company's calls, and each recruiter's calls
 * under the first company (in the companies' order) that counted them.
 *
 * It reports only figures `stats_daily` actually holds. That collection counts
 * logged calls and nothing else, so there is no separate "actions" figure; a
 * recruiter's Last Active is the last day in the period they logged one; and a
 * read that fails is an error, never a screen of zeros.
 *
 * All names and ids below are artificial.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ statsReads: [], companiesError: null, companiesReads: 0 }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    where: (field, op, value) => ({ field, op, value }),
    query: (ref, ...clauses) => ({ path: ref.path, clauses }),
    getDocs: (ref) => {
        if (ref.path === 'companies') {
            fx.companiesReads += 1;
            if (fx.companiesError) return Promise.reject(fx.companiesError);
            return Promise.resolve({
                docs: [
                    { id: 'co-a', data: () => ({ companyName: 'Artificial Carrier A' }) },
                    { id: 'co-b', data: () => ({ companyName: 'Artificial Carrier B' }) },
                ],
            });
        }
        return new Promise((resolve, reject) => { fx.statsReads.push({ path: ref.path, resolve, reject }); });
    },
}));

import { useAnalytics } from './useAnalytics';

/** A stats_daily snapshot of `[dateKey, data]` pairs. */
const days = (...entries) => ({
    forEach: (visit) => entries.forEach(([id, data]) => visit({ id, data: () => data })),
});

beforeEach(() => {
    fx.statsReads = [];
    fx.companiesError = null;
    fx.companiesReads = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** Waits for both companies' stats reads to be asked for, and returns them. */
async function bothStatsReads() {
    await waitFor(() => expect(fx.statsReads).toHaveLength(2));
    return fx.statsReads;
}

describe('useAnalytics', () => {
    it("reads every company's stats at once and adds them up as before", async () => {
        const { result } = renderHook(() => useAnalytics());

        await waitFor(() => expect(fx.statsReads.map((read) => read.path)).toEqual([
            'companies/co-a/stats_daily',
            'companies/co-b/stats_daily',
        ]));
        expect(result.current.loading).toBe(true);

        const [readA, readB] = fx.statsReads;
        readB.resolve(days(['2026-10-14', {
            totalDials: 5,
            byUser: { 'u-shared': { name: 'Shared Recruiter', dials: 2 }, 'u-b': { name: 'Recruiter B', dials: 3 } },
        }]));
        readA.resolve(days(['2026-10-13', {
            totalDials: 7,
            byUser: { 'u-shared': { name: 'Shared Recruiter', dials: 7 }, system: { name: 'System', dials: 0 } },
        }]));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        const { summary, companyPerformance, userPerformance } = result.current.stats;
        expect(summary.totalCalls).toBe(12);
        expect(summary.activeRecruiters).toBe(2);
        expect(companyPerformance.map(({ companyId, callsMade }) => [companyId, callsMade]))
            .toEqual([['co-a', 7], ['co-b', 5]]);
        expect(userPerformance).toEqual([
            { userId: 'u-shared', userName: 'Shared Recruiter', companyName: 'Artificial Carrier A', callsMade: 9, lastActive: '2026-10-14' },
            { userId: 'u-b', userName: 'Recruiter B', companyName: 'Artificial Carrier B', callsMade: 3, lastActive: '2026-10-14' },
        ]);
    });
});

describe('useAnalytics — only figures stats_daily holds (defects)', () => {
    it('gives each company its calls and no "actions" figure, which only ever repeated the calls', async () => {
        const { result } = renderHook(() => useAnalytics());
        const [readA, readB] = await bothStatsReads();
        readA.resolve(days(['2026-10-13', { totalDials: 4, connected: 2, byUser: {} }]));
        readB.resolve(days());

        await waitFor(() => expect(result.current.loading).toBe(false));
        // `actions` was `totalDials` added a second time: stats_daily counts
        // logged calls and nothing else, so there is no other figure to show.
        expect(result.current.stats.companyPerformance).toEqual([
            { companyId: 'co-a', companyName: 'Artificial Carrier A', callsMade: 4 },
        ]);
    });

    it("fills a recruiter's Last Active with the last day in the period they logged a call", async () => {
        const { result } = renderHook(() => useAnalytics());
        const [readA, readB] = await bothStatsReads();
        // Days arrive in any order; a day without a call is not activity.
        readA.resolve(days(
            ['2026-10-14', { totalDials: 1, byUser: { 'u-1': { name: 'Recruiter One', dials: 1 } } }],
            ['2026-10-12', { totalDials: 2, byUser: { 'u-1': { name: 'Recruiter One', dials: 2 }, 'u-2': { name: 'Recruiter Two', dials: 3 } } }],
            ['2026-10-15', { totalDials: 0, byUser: { 'u-2': { name: 'Recruiter Two', dials: 0 } } }],
        ));
        readB.resolve(days(
            ['2026-10-13', { totalDials: 4, byUser: { 'u-2': { name: 'Recruiter Two', dials: 4 } } }],
        ));

        await waitFor(() => expect(result.current.loading).toBe(false));
        const lastActive = Object.fromEntries(
            result.current.stats.userPerformance.map((user) => [user.userId, user.lastActive]),
        );
        // It was never set, so the table said "Unknown" for every recruiter.
        expect(lastActive).toEqual({ 'u-1': '2026-10-14', 'u-2': '2026-10-13' });
    });

    it('reports a failed read of the companies as an error, not as zeros', async () => {
        fx.companiesError = new Error('unavailable');
        const { result } = renderHook(() => useAnalytics());

        await waitFor(() => expect(result.current.loading).toBe(false));
        // It used to clear `loading` and leave the zeroed figures to be shown.
        expect(result.current.error).toBe(fx.companiesError);
    });

    it("reports one company's failed stats read as an error too", async () => {
        const { result } = renderHook(() => useAnalytics());
        const [readA, readB] = await bothStatsReads();
        readA.resolve(days(['2026-10-13', { totalDials: 4, byUser: {} }]));
        readB.reject(new Error('permission-denied'));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeInstanceOf(Error);
    });

    it('reads again when asked, and clears the error once the read succeeds', async () => {
        fx.companiesError = new Error('unavailable');
        const { result } = renderHook(() => useAnalytics());
        await waitFor(() => expect(result.current.error).not.toBeNull());

        fx.companiesError = null;
        act(() => result.current.reload());
        expect(result.current.loading).toBe(true);
        expect(result.current.error).toBeNull();

        const [readA, readB] = await bothStatsReads();
        readA.resolve(days());
        readB.resolve(days());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBeNull();
        expect(fx.companiesReads).toBe(2);
    });
});
