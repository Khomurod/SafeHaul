/**
 * Analytics reads each company's daily stats side by side: the screen waits
 * for the slowest company, not for every company in turn. What it adds up is
 * unchanged — the totals, each company's calls, and each recruiter's calls
 * under the first company (in the companies' order) that counted them.
 *
 * All names and ids below are artificial.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ statsReads: [] }));

vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: (_db, ...path) => ({ path: path.join('/') }),
    where: (field, op, value) => ({ field, op, value }),
    query: (ref, ...clauses) => ({ path: ref.path, clauses }),
    getDocs: (ref) => {
        if (ref.path === 'companies') {
            return Promise.resolve({
                docs: [
                    { id: 'co-a', data: () => ({ companyName: 'Artificial Carrier A' }) },
                    { id: 'co-b', data: () => ({ companyName: 'Artificial Carrier B' }) },
                ],
            });
        }
        return new Promise((resolve) => { fx.statsReads.push({ path: ref.path, resolve }); });
    },
}));

import { useAnalytics } from './useAnalytics';

/** A stats_daily snapshot of `[dateKey, data]` pairs. */
const days = (...entries) => ({
    forEach: (visit) => entries.forEach(([id, data]) => visit({ id, data: () => data })),
});

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
        const { summary, companyPerformance, userPerformance } = result.current.stats;
        expect(summary.totalCalls).toBe(12);
        expect(summary.activeRecruiters).toBe(2);
        expect(companyPerformance.map(({ companyId, callsMade }) => [companyId, callsMade]))
            .toEqual([['co-a', 7], ['co-b', 5]]);
        expect(userPerformance).toEqual([
            { userId: 'u-shared', userName: 'Shared Recruiter', companyName: 'Artificial Carrier A', callsMade: 9 },
            { userId: 'u-b', userName: 'Recruiter B', companyName: 'Artificial Carrier B', callsMade: 3 },
        ]);
    });
});
