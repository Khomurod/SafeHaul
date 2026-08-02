import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@shared/services/fmcsaEmployerSocrata', () => ({
    fetchFmcsaCarrierCandidatesForPev: vi.fn(),
}));

import { fetchFmcsaCarrierCandidatesForPev } from '@shared/services/fmcsaEmployerSocrata';
import { useFmcsaEmployerLookup } from './useFmcsaEmployerLookup';

const ROWS = [{ dot_number: '42', legal_name: 'Swift LLC' }];

describe('useFmcsaEmployerLookup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchFmcsaCarrierCandidatesForPev.mockResolvedValue(ROWS);
    });

    it('skips the lookup when there is no Socrata token', async () => {
        const { result } = renderHook(() =>
            useFmcsaEmployerLookup({ companyLabel: 'Swift Transportation', employerStateRaw: '', socrataToken: '' }));
        await Promise.resolve();
        expect(fetchFmcsaCarrierCandidatesForPev).not.toHaveBeenCalled();
        expect(result.current.fmcsaRows).toEqual([]);
        expect(result.current.fmcsaLoading).toBe(false);
    });

    it('skips the lookup when the company label is too short', async () => {
        renderHook(() =>
            useFmcsaEmployerLookup({ companyLabel: 'S', employerStateRaw: '', socrataToken: 'tok' }));
        await Promise.resolve();
        expect(fetchFmcsaCarrierCandidatesForPev).not.toHaveBeenCalled();
    });

    it('fetches rows and calls onRowsLoaded on success', async () => {
        const onRowsLoaded = vi.fn();
        const { result } = renderHook(() =>
            useFmcsaEmployerLookup({
                companyLabel: 'Swift Transportation',
                employerStateRaw: 'AZ',
                socrataToken: 'tok',
                onRowsLoaded,
            }));

        await waitFor(() => expect(result.current.fmcsaRows).toEqual(ROWS));
        expect(fetchFmcsaCarrierCandidatesForPev).toHaveBeenCalledWith(
            'Swift Transportation',
            expect.objectContaining({ appToken: 'tok', employerState: 'AZ' }),
        );
        expect(onRowsLoaded).toHaveBeenCalledTimes(1);
        expect(result.current.fmcsaLoading).toBe(false);
        expect(result.current.fmcsaError).toBeNull();
    });

    it('surfaces an error (and empty rows) when the lookup throws', async () => {
        fetchFmcsaCarrierCandidatesForPev.mockRejectedValueOnce(new Error('boom'));
        const { result } = renderHook(() =>
            useFmcsaEmployerLookup({ companyLabel: 'Swift Transportation', employerStateRaw: '', socrataToken: 'tok' }));

        await waitFor(() => expect(result.current.fmcsaError).toMatch(/Could not load FMCSA/i));
        expect(result.current.fmcsaRows).toEqual([]);
        expect(result.current.fmcsaLoading).toBe(false);
    });

    it('ignores AbortError (no error surfaced)', async () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        fetchFmcsaCarrierCandidatesForPev.mockRejectedValueOnce(abort);
        const { result } = renderHook(() =>
            useFmcsaEmployerLookup({ companyLabel: 'Swift Transportation', employerStateRaw: '', socrataToken: 'tok' }));
        await new Promise((r) => setTimeout(r, 0));
        expect(result.current.fmcsaError).toBeNull();
    });
});
