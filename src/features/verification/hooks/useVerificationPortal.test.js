import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Freeze the verification token-load and submission contracts at the callable
// boundary. Artificial data only — no real tokens, drivers, or employers.
const callables = vi.hoisted(() => ({
    getVerificationRequest: vi.fn(),
    submitVerificationResponse: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => callables[name],
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({
    isE2ETestMode: false,
    getE2EQueryParam: () => '',
}));

import { useVerificationPortal } from './useVerificationPortal';

const VALID = {
    status: 'pending',
    applicantName: 'Artificial Applicant',
    employerName: 'Artificial Prior Employer',
    companyName: 'Artificial Requesting Carrier',
    employmentStartDate: '2020-02-02',
    employmentEndDate: '2023-03-03',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

function fillMinimumValidForm(result) {
    // wasEmployed=false skips the employment/safety required block; respondent
    // fields + signature are always required.
    act(() => result.current.updateField('wasEmployed', false));
    act(() => result.current.updateField('respondentName', 'Artificial Respondent'));
    act(() => result.current.updateField('respondentTitle', 'Safety Director'));
    act(() => result.current.updateField('respondentPhone', '555-000-1111'));
    act(() => result.current.updateField('signatureData', 'data:image/png;base64,artificial'));
}

describe('useVerificationPortal — token-load and submission contract', () => {
    beforeEach(() => {
        callables.getVerificationRequest.mockReset();
        callables.submitVerificationResponse.mockReset();
        callables.getVerificationRequest.mockResolvedValue({ data: VALID });
        callables.submitVerificationResponse.mockResolvedValue({ data: { ok: true } });
    });

    it('requests the load callable with the exact token and exposes the loading state', async () => {
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(callables.getVerificationRequest).toHaveBeenCalledWith({ token: 'token-abc' });
    });

    it('stores a valid pending verification', async () => {
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.verificationData).toEqual(VALID);
        expect(result.current.alreadyCompleted).toBe(false);
        expect(result.current.error).toBeNull();
    });

    it('marks a completed-status token as already completed', async () => {
        callables.getVerificationRequest.mockResolvedValue({ data: { status: 'completed' } });
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.alreadyCompleted).toBe(true);
        expect(result.current.verificationData).toBeNull();
    });

    it('maps a not-found error to the invalid-link message', async () => {
        const err = new Error('nf');
        err.code = 'functions/not-found';
        callables.getVerificationRequest.mockRejectedValue(err);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('This verification link is invalid or has been removed.');
        consoleError.mockRestore();
    });

    it('maps a deadline-exceeded error to the expired state', async () => {
        const err = new Error('exp');
        err.code = 'functions/deadline-exceeded';
        callables.getVerificationRequest.mockRejectedValue(err);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.expired).toBe(true);
        consoleError.mockRestore();
    });

    it('surfaces a generic load failure message', async () => {
        callables.getVerificationRequest.mockRejectedValue(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('offline');
        consoleError.mockRestore();
    });

    it('errors without calling the load callable when no token is provided', async () => {
        const { result } = renderHook(() => useVerificationPortal(undefined));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.error).toBe('No verification token provided.');
        expect(callables.getVerificationRequest).not.toHaveBeenCalled();
    });

    it('blocks submission and records errors when required fields are missing', async () => {
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} });
        });

        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
        expect(result.current.completed).toBe(false);
        expect(result.current.formErrors).toMatchObject({
            wasEmployed: 'Required',
            respondentName: 'Required',
            respondentTitle: 'Required',
            respondentPhone: 'Required',
            signatureData: 'Please provide your electronic signature',
        });
        scrollTo.mockRestore();
    });

    it('submits the exact token and response payload and completes', async () => {
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        fillMinimumValidForm(result);

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} });
        });

        expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1);
        expect(callables.submitVerificationResponse).toHaveBeenCalledWith({
            token: 'token-abc',
            response: {
                wasEmployed: false,
                confirmedStartDate: '',
                confirmedEndDate: '',
                positionHeld: '',
                reasonForLeaving: '',
                eligibleForRehire: null,
                subjectToFmcsrs: null,
                subjectToDotTesting: null,
                hadDrugAlcoholViolations: null,
                violationDetails: '',
                completedReturnToDuty: '',
                hadAccidents: null,
                accidentDetails: '',
                additionalComments: '',
                respondentName: 'Artificial Respondent',
                respondentTitle: 'Safety Director',
                respondentPhone: '555-000-1111',
                respondentEmail: '',
                signatureData: 'data:image/png;base64,artificial',
            },
        });
        expect(result.current.completed).toBe(true);
        scrollTo.mockRestore();
    });

    it('surfaces a submission failure without completing', async () => {
        callables.submitVerificationResponse.mockRejectedValue(new Error('submit down'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        fillMinimumValidForm(result);

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} });
        });

        expect(result.current.completed).toBe(false);
        expect(result.current.error).toBe('submit down');
        consoleError.mockRestore();
        scrollTo.mockRestore();
    });
});
