// The upload screen's count. Its "Exclude Previously Messaged" select shows
// "Last 7 Days" until the recruiter picks another window, so a list whose
// filters carry no window is counted with those 7 days, as the launch is.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({ checkImportPhones: vi.fn(), getFilterCount: vi.fn() }));
const { checkImportPhones, getFilterCount } = callables;
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn((_functions, name) => callables[name]) }));
vi.mock('@/lib/firebase/config', () => ({ functions: {} }));

import { useCampaignTargeting } from './useCampaignTargeting';
import { ERROR_MESSAGES } from '../constants/campaignConstants';

const ROWS = [
    { firstName: 'Alice', normalizedPhone: '5551110001' },
    { firstName: 'Bob', normalizedPhone: '5551110002' },
];
const USER = { uid: 'u1' };
const UPLOAD = { leadType: 'import', rawData: ROWS };
const UPLOAD_OFF = { ...UPLOAD, excludeRecentDays: 'off' };

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
        const { result } = renderHook(() => useCampaignTargeting('co-1', UPLOAD, USER));
        await settle();

        expect(result.current.matchCount).toBe(1);
        expect(checkImportPhones).toHaveBeenCalledWith(expect.objectContaining({ excludeRecentDays: '7' }));
        expect([...result.current.excludedPhones]).toEqual(['5551110001']);
    });

    it('counts every row when the recruiter turned the window off', async () => {
        const { result } = renderHook(() => useCampaignTargeting('co-1', UPLOAD_OFF, USER));
        await settle();

        expect(result.current.matchCount).toBe(2);
        expect(checkImportPhones).not.toHaveBeenCalled();
    });

    it('keeps the count for the window picked last when an earlier answer comes back late', async () => {
        let answerSevenDays;
        checkImportPhones.mockImplementation(() => new Promise((resolve) => { answerSevenDays = resolve; }));
        const { result, rerender } = renderHook(({ filters }) => useCampaignTargeting('co-1', filters, USER), {
            initialProps: { filters: UPLOAD },
        });
        await settle(); // the 7-day check is now in flight

        rerender({ filters: UPLOAD_OFF });
        await settle();
        expect(result.current.matchCount).toBe(2);

        // The 7-day answer arrives after the recruiter chose "No Exclusion".
        await act(async () => { answerSevenDays({ data: { excludedPhones: ['5551110001'] } }); });

        expect(result.current.matchCount).toBe(2);
        expect([...result.current.excludedPhones]).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });
});

describe('useCampaignTargeting — a CRM audience', () => {
    const CRM = { leadType: 'leads', status: ['new'] };

    it('says the count failed, rather than that nobody matches, and counts again on retry', async () => {
        getFilterCount.mockRejectedValue(new Error('internal'));
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useCampaignTargeting('co-1', CRM, USER));
        await settle();

        expect(result.current.error).toBe(ERROR_MESSAGES.COUNT_FAILED);
        expect(result.current.matchCount).toBe(0);

        getFilterCount.mockResolvedValue({ data: { count: 42 } });
        act(() => { result.current.retry(); });
        await settle();

        expect(getFilterCount).toHaveBeenCalledTimes(2);
        expect(result.current.error).toBeNull();
        expect(result.current.matchCount).toBe(42);
    });
});
