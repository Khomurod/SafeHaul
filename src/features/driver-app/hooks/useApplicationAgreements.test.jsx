/**
 * The consent texts Step 4 and Step 9 both show, read once for the page: a driver
 * moving between the steps, or back to them, does not ask the server again. A
 * failure is never remembered, so Try again and the next step ask afresh.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock('firebase/functions', () => ({ httpsCallable: () => (payload) => mocks.call(payload) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));

import * as agreementsModule from './useApplicationAgreements';

const { useApplicationAgreements } = agreementsModule;
const AGREEMENTS = [{ id: 'fcra-disclosure', title: 'Disclosure', body: 'Made-up text.' }];

beforeEach(() => {
    agreementsModule.resetApplicationAgreementsCache?.();
    mocks.call.mockReset();
    mocks.call.mockResolvedValue({ data: { agreements: AGREEMENTS, agreementVersion: 'v7' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('useApplicationAgreements', () => {
    it('reads a company\'s agreements once for the page, whichever step shows them', async () => {
        const stepFour = renderHook(() => useApplicationAgreements('c1'));
        await waitFor(() => expect(stepFour.result.current.agreements).toEqual(AGREEMENTS));
        stepFour.unmount();

        const stepNine = renderHook(() => useApplicationAgreements('c1'));
        await waitFor(() => expect(stepNine.result.current.agreements).toEqual(AGREEMENTS));

        expect(stepNine.result.current.agreementVersion).toBe('v7');
        expect(mocks.call).toHaveBeenCalledTimes(1);
        expect(mocks.call).toHaveBeenCalledWith({ companyId: 'c1' });
    });

    it('shares one request between two readers at once', async () => {
        const first = renderHook(() => useApplicationAgreements('c1'));
        const second = renderHook(() => useApplicationAgreements('c1'));

        await waitFor(() => expect(second.result.current.agreements).toEqual(AGREEMENTS));
        expect(first.result.current.agreements).toEqual(AGREEMENTS);
        expect(mocks.call).toHaveBeenCalledTimes(1);
    });

    it('does not remember a failure: Try again asks the server again', async () => {
        mocks.call.mockRejectedValueOnce(new Error('offline'));
        const step = renderHook(() => useApplicationAgreements('c1'));
        await waitFor(() => expect(step.result.current.error).toMatch(/could not be loaded/));

        act(() => step.result.current.retry());

        await waitFor(() => expect(step.result.current.agreements).toEqual(AGREEMENTS));
        expect(step.result.current.error).toBeNull();
        expect(mocks.call).toHaveBeenCalledTimes(2);
    });

    it('does not remember an empty set either, which is a failure', async () => {
        mocks.call.mockResolvedValueOnce({ data: { agreements: [] } });
        const first = renderHook(() => useApplicationAgreements('c1'));
        await waitFor(() => expect(first.result.current.error).toMatch(/could not be loaded/));
        first.unmount();

        const second = renderHook(() => useApplicationAgreements('c1'));
        await waitFor(() => expect(second.result.current.agreements).toEqual(AGREEMENTS));
        expect(mocks.call).toHaveBeenCalledTimes(2);
    });

    it('asks again for another company', async () => {
        const first = renderHook(() => useApplicationAgreements('c1'));
        await waitFor(() => expect(first.result.current.agreements).toEqual(AGREEMENTS));
        const other = renderHook(() => useApplicationAgreements('c2'));
        await waitFor(() => expect(other.result.current.agreements).toEqual(AGREEMENTS));

        expect(mocks.call.mock.calls).toEqual([[{ companyId: 'c1' }], [{ companyId: 'c2' }]]);
    });
});
