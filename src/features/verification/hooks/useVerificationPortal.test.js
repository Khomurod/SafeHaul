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

import { LINK_PROBLEM } from '@shared/components/public-link';
import { useVerificationPortal } from './useVerificationPortal';

const VALID = {
    status: 'pending',
    requestNumber: '9f8e7d6c',
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
    act(() => result.current.updateSignature({ data: 'data:image/png;base64,artificial', method: 'drawn' }));
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
        expect(result.current.linkProblem).toBeNull();
    });

    it('marks a completed-status token as already completed', async () => {
        callables.getVerificationRequest.mockResolvedValue({ data: { status: 'completed' } });
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.alreadyCompleted).toBe(true);
        expect(result.current.verificationData).toBeNull();
    });

    it('reads a not-found refusal as a link that is not valid', async () => {
        const err = new Error('Verification request not found. The link may be invalid.');
        err.code = 'functions/not-found';
        callables.getVerificationRequest.mockRejectedValue(err);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.linkProblem).toEqual({ reason: LINK_PROBLEM.NOT_FOUND });
        consoleError.mockRestore();
    });

    it("reads the server's words for a request a newer one replaced", async () => {
        const err = new Error('This request was replaced by a newer one. Please use the most recent email you received.');
        err.code = 'functions/not-found';
        callables.getVerificationRequest.mockRejectedValue(err);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.linkProblem).toEqual({ reason: LINK_PROBLEM.REPLACED });
        consoleError.mockRestore();
    });

    it('reads a deadline-exceeded refusal in the server\'s words as an expired link', async () => {
        const err = new Error('This verification request has expired. Please contact the requesting company.');
        err.code = 'functions/deadline-exceeded';
        callables.getVerificationRequest.mockRejectedValue(err);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.linkProblem).toEqual({ reason: LINK_PROBLEM.EXPIRED });
        consoleError.mockRestore();
    });

    it('says plainly that a link it could not check could not be loaded', async () => {
        callables.getVerificationRequest.mockRejectedValue(new Error('offline'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        // A plain sentence, never the error's own text; who to contact is the screen's.
        expect(result.current.linkProblem).toEqual({
            reason: LINK_PROBLEM.UNAVAILABLE,
            detail: 'This verification request could not be loaded. Please try again.',
        });
        consoleError.mockRestore();
    });

    it('loads the link again on retry', async () => {
        let calls = 0;
        callables.getVerificationRequest.mockImplementation(() => {
            calls += 1;
            return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ data: VALID });
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.linkProblem?.reason).toBe(LINK_PROBLEM.UNAVAILABLE));

        act(() => result.current.retry());
        await waitFor(() => expect(result.current.verificationData).toEqual(VALID));
        expect(result.current.linkProblem).toBeNull();
        expect(result.current.loading).toBe(false);
        expect(callables.getVerificationRequest).toHaveBeenCalledTimes(2);
        consoleError.mockRestore();
    });

    it('reads a link with no token as not valid, without calling the load callable', async () => {
        const { result } = renderHook(() => useVerificationPortal(undefined));
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.linkProblem).toEqual({ reason: LINK_PROBLEM.NOT_FOUND });
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
                rehireExplanation: '',
                subjectToFmcsrs: null,
                subjectToDotTesting: null,
                hadDrugAlcoholViolations: null,
                violationDetails: '',
                completedReturnToDuty: '',
                followUpTestingPlan: '',
                hadAccidents: null,
                accidentDetails: '',
                hadNonRecordableAccidents: null,
                nonRecordableAccidentDetails: '',
                additionalComments: '',
                respondentName: 'Artificial Respondent',
                respondentTitle: 'Safety Director',
                respondentPhone: '555-000-1111',
                respondentEmail: '',
                signatureData: 'data:image/png;base64,artificial',
                signatureMethod: 'drawn',
            },
        });
        expect(result.current.completed).toBe(true);
        scrollTo.mockRestore();
    });

    it('refuses a reported violation without its details, blank or spaces only', async () => {
        const { result } = renderHook(() => useVerificationPortal('token-abc'));
        await waitFor(() => expect(result.current.loading).toBe(false));
        const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        fillMinimumValidForm(result);
        act(() => result.current.updateField('wasEmployed', true));
        for (const [field, value] of Object.entries({
            confirmedStartDate: '2020-02-02',
            confirmedEndDate: '2023-03-03',
            positionHeld: 'Driver',
            reasonForLeaving: 'Laid Off',
            subjectToFmcsrs: true,
            subjectToDotTesting: true,
            hadDrugAlcoholViolations: true,
            hadAccidents: false,
            violationDetails: '   ',
        })) {
            act(() => result.current.updateField(field, value));
        }

        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} });
        });
        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
        expect(result.current.formErrors).toEqual({ violationDetails: 'Required' });

        act(() => result.current.updateField('violationDetails', 'Positive test, 2023.'));
        expect(result.current.formErrors).toEqual({});
        await act(async () => {
            await result.current.handleSubmit({ preventDefault: () => {} });
        });
        expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1);
        scrollTo.mockRestore();
    });

    it('surfaces a submission failure on the form, without completing or leaving it', async () => {
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
        expect(result.current.linkProblem).toBeNull();
        expect(result.current.submitError).toBe(
            'Your response was not sent. Your answers are still on this page: check your connection and try again.',
        );
        consoleError.mockRestore();
        scrollTo.mockRestore();
    });
});
