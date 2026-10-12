// The upload screen's count. Its "Exclude Previously Messaged" select shows
// "Last 7 Days" until the recruiter picks another window, so a list whose
// filters carry no window is counted with those 7 days, as the launch is.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const checkImportPhones = vi.hoisted(() => vi.fn());
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn(() => checkImportPhones) }));
vi.mock('@/lib/firebase/config', () => ({ functions: {} }));

import { useCampaignTargeting } from './useCampaignTargeting';

const ROWS = [
    { firstName: 'Alice', normalizedPhone: '5551110001' },
    { firstName: 'Bob', normalizedPhone: '5551110002' },
];

// The count waits 500 ms after the last change before it asks the server.
const settle = () => act(() => vi.advanceTimersByTimeAsync(500));

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    checkImportPhones.mockResolvedValue({ data: { excludedPhones: ['5551110001'] } });
});

afterEach(() => {
    vi.useRealTimers();
});

describe('useCampaignTargeting — an uploaded list', () => {
    it('counts with the 7-day window the screen shows when none was picked', async () => {
        const { result } = renderHook(() => useCampaignTargeting('co-1', { leadType: 'import', rawData: ROWS }, { uid: 'u1' }));
        await settle();

        expect(result.current.matchCount).toBe(1);
        expect(checkImportPhones).toHaveBeenCalledWith(expect.objectContaining({ excludeRecentDays: '7' }));
        expect([...result.current.excludedPhones]).toEqual(['5551110001']);
    });

    it('counts every row when the recruiter turned the window off', async () => {
        const { result } = renderHook(() => useCampaignTargeting('co-1', { leadType: 'import', rawData: ROWS, excludeRecentDays: 'off' }, { uid: 'u1' }));
        await settle();

        expect(result.current.matchCount).toBe(2);
        expect(checkImportPhones).not.toHaveBeenCalled();
    });
});
