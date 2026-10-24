import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const e2e = vi.hoisted(() => ({ on: false, param: '' }));
vi.mock('@lib/runtime/e2eMode', () => ({
    get isE2ETestMode() { return e2e.on; },
    getE2EQueryParam: () => e2e.param,
}));
const getDocs = vi.fn(async () => ({ docs: [] }));
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), query: vi.fn(), where: vi.fn(), getDocs: (...args) => getDocs(...args),
}));

import { useAnalytics } from './useAnalytics';
import { mockAnalyticsStats } from './analyticsMock';

afterEach(() => {
    e2e.on = false;
    e2e.param = '';
    vi.clearAllMocks();
});

describe('useAnalytics — the e2eAnalytics fixture', () => {
    it('returns the made-up figures, reading nothing, only in E2E test mode with e2eAnalytics=mock', async () => {
        e2e.on = true;
        e2e.param = 'mock';
        const { result } = renderHook(() => useAnalytics());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.stats).toEqual(mockAnalyticsStats());
        expect(getDocs).not.toHaveBeenCalled();
    });

    it('reads Firestore as usual outside E2E test mode, whatever the address says', async () => {
        e2e.param = 'mock';
        const { result } = renderHook(() => useAnalytics());
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(getDocs).toHaveBeenCalled();
        expect(result.current.stats.companyPerformance).toEqual([]);
    });

    it('keeps each fixture company either side of the 20-call High/Low line', () => {
        const calls = mockAnalyticsStats().companyPerformance.map((company) => company.callsMade);
        expect(calls.some((n) => n > 20)).toBe(true);
        expect(calls.some((n) => n <= 20)).toBe(true);
    });
});
