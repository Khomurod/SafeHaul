// The audience count, for the campaign's channel: "already messaged" is a
// recipient a campaign of the same channel reached inside the window. The
// upload screen's "Exclude Previously Messaged" select shows "Last 7 Days"
// until the recruiter picks another window, so a list whose filters carry no
// window is counted with those 7 days, as the launch is.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const callables = vi.hoisted(() => ({ checkImportPhones: vi.fn(), getFilterCount: vi.fn() }));
const { checkImportPhones, getFilterCount } = callables;
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn((_functions, name) => callables[name]) }));
vi.mock('@/lib/firebase/config', () => ({ functions: {} }));

import { useCampaignTargeting } from './useCampaignTargeting';
import { ERROR_MESSAGES } from '../constants/campaignConstants';

const ROWS = [
    { firstName: 'Alice', normalizedPhone: '5551110001', email: 'alice@example.com' },
    { id: 'row-bob', firstName: 'Bob', phone: '(555) 111-0002', email: 'bob@example.com' },
];
const USER = { uid: 'u1' };
const UPLOAD = { leadType: 'import', rawData: ROWS };
const UPLOAD_OFF = { ...UPLOAD, excludeRecentDays: 'off' };

// The count waits 500 ms after the last change before it asks the server.
const settle = () => act(() => vi.advanceTimersByTimeAsync(500));

beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    checkImportPhones.mockResolvedValue({ data: { excludedKeys: ['import_0'] } });
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
        expect([...result.current.alreadyMessagedKeys]).toEqual(['import_0']);
        expect(result.current.alreadyMessaged).toBe(1);
    });

    it('asks about each row by its preview key, for the campaign\'s channel', async () => {
        renderHook(() => useCampaignTargeting('co-1', UPLOAD, USER, 'email'));
        await settle();

        expect(checkImportPhones).toHaveBeenCalledWith({
            companyId: 'co-1',
            method: 'email',
            excludeRecentDays: '7',
            recipients: [
                { key: 'import_0', phone: '5551110001', email: 'alice@example.com' },
                { key: 'row-bob', phone: '(555) 111-0002', email: 'bob@example.com' },
            ],
        });
    });

    it('counts again when the channel changes', async () => {
        const { rerender } = renderHook(({ method }) => useCampaignTargeting('co-1', UPLOAD, USER, method), {
            initialProps: { method: 'sms' },
        });
        await settle();
        rerender({ method: 'email' });
        await settle();

        expect(checkImportPhones.mock.calls.map(([args]) => args.method)).toEqual(['sms', 'email']);
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
        await act(async () => { answerSevenDays({ data: { excludedKeys: ['import_0'] } }); });

        expect(result.current.matchCount).toBe(2);
        expect([...result.current.alreadyMessagedKeys]).toEqual([]);
        expect(result.current.isLoading).toBe(false);
    });
});

describe('useCampaignTargeting — a CRM audience', () => {
    const CRM = { leadType: 'leads', status: ['new'] };

    it('counts for the campaign\'s channel and says how many were already messaged', async () => {
        getFilterCount.mockResolvedValue({ data: { count: 40, alreadyMessaged: 2 } });
        const { result } = renderHook(() => useCampaignTargeting('co-1', CRM, USER, 'email'));
        await settle();

        expect(getFilterCount).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'co-1', method: 'email' }));
        expect(result.current.matchCount).toBe(40);
        expect(result.current.alreadyMessaged).toBe(2);
    });

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
