/**
 * A response the server did not take keeps the form.
 *
 * A failed submission used to replace the whole page with "Verification Error"
 * and the server's words, with no way back to the answers: the respondent had
 * to reload the link and fill everything in again. Now the form stays, says why
 * the response was not sent and offers Try again. Only an answer the link can
 * no longer take (already on file, expired, removed) ends on its own screen.
 *
 * Artificial data only — no real tokens, drivers or employers.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@shared/components/signature/SignaturePad', () => ({
    SignaturePad: ({ onSignatureChange }) => (
        <button type="button" onClick={() => onSignatureChange('data:image/png;base64,artificial-sig')}>
            Mock sign
        </button>
    ),
}));

import { VerificationPortal } from './VerificationPortal';

const VALID = {
    status: 'pending',
    applicantName: 'Artificial Applicant',
    companyName: 'Artificial Requesting Carrier',
    employmentStartDate: '2020-02-02',
    employmentEndDate: '2023-03-03',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

/** A callable failure as the web SDK delivers it: the code, and the server's sentence or the bare code. */
const callableError = (code, message) => Object.assign(new Error(message), { code: `functions/${code}` });

/** Answers the respondent gives on every attempt, by count: a failure, then whatever comes next. */
function submitAnswers(...outcomes) {
    let attempt = 0;
    callables.submitVerificationResponse.mockImplementation(() => {
        const outcome = outcomes[Math.min(attempt, outcomes.length - 1)];
        attempt += 1;
        return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    });
}

function renderPortal() {
    return render(
        <MemoryRouter initialEntries={['/verify/token-xyz']}>
            <Routes>
                <Route path="/verify/:token" element={<VerificationPortal />} />
            </Routes>
        </MemoryRouter>,
    );
}

async function fillAndSubmit() {
    await screen.findByRole('heading', { level: 1, name: /Previous Employment Verification/i });
    fireEvent.click(screen.getByRole('radio', { name: 'No / No Record Found' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Your Full Name/i }), {
        target: { value: 'Artificial Respondent' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Your Title \/ Position/i }), {
        target: { value: 'HR Manager' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: /Phone Number/i }), {
        target: { value: '555-000-1111' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mock sign' }));
    fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
}

const expectAnswersKept = () => {
    expect(screen.getByRole('radio', { name: 'No / No Record Found' })).toBeChecked();
    expect(screen.getByRole('textbox', { name: /Your Full Name/i })).toHaveValue('Artificial Respondent');
    expect(screen.getByRole('textbox', { name: /Your Title \/ Position/i })).toHaveValue('HR Manager');
    expect(screen.queryByRole('heading', { name: 'Verification Error' })).not.toBeInTheDocument();
};

beforeEach(() => {
    callables.getVerificationRequest.mockReset();
    callables.submitVerificationResponse.mockReset();
    callables.getVerificationRequest.mockResolvedValue({ data: VALID });
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('a response that is not sent', () => {
    it('keeps the form and every answer, and Try again sends the same answers', async () => {
        submitAnswers(callableError('internal', 'internal'), { data: { success: true } });
        renderPortal();
        await fillAndSubmit();

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent('Your response was not sent.');
        expect(notice).toHaveTextContent('Your answers are still on this page');
        expectAnswersKept();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        expect(await screen.findByText('Verification Submitted Successfully')).toBeInTheDocument();
        const [first, second] = callables.submitVerificationResponse.mock.calls;
        expect(second[0]).toEqual(first[0]);
        expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(2);
    });

    it("says the server's own reason, such as too many attempts", async () => {
        submitAnswers(callableError('resource-exhausted', 'Too many submission attempts. Please wait.'));
        renderPortal();
        await fillAndSubmit();

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent('Too many submission attempts. Please wait.');
        expect(notice).toHaveTextContent('Your answers are still on this page');
        expectAnswersKept();
    });

    it('keeps the form when no reply came in time, because the response may have arrived', async () => {
        submitAnswers(callableError('deadline-exceeded', 'deadline-exceeded'));
        renderPortal();
        await fillAndSubmit();

        const notice = await screen.findByRole('alert');
        expect(notice).toHaveTextContent('We did not hear back in time');
        expect(screen.queryByRole('heading', { name: 'Link Expired' })).not.toBeInTheDocument();
        expectAnswersKept();
    });

    it('shows Already Completed when the retry finds the first response on file', async () => {
        submitAnswers(
            callableError('deadline-exceeded', 'deadline-exceeded'),
            callableError('already-exists', 'This verification has already been completed.'),
        );
        renderPortal();
        await fillAndSubmit();

        fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
        expect(await screen.findByRole('heading', { name: 'Already Completed' })).toBeInTheDocument();
    });

    it('shows Link Expired when the link ran out while the form was open', async () => {
        submitAnswers(callableError('deadline-exceeded', 'This verification request has expired.'));
        renderPortal();
        await fillAndSubmit();

        expect(await screen.findByRole('heading', { name: 'Link Expired' })).toBeInTheDocument();
    });

    it('shows the invalid-link screen when the request is gone', async () => {
        submitAnswers(callableError('not-found', 'Verification request not found.'));
        renderPortal();
        await fillAndSubmit();

        expect(await screen.findByRole('heading', { name: 'Verification Error' })).toBeInTheDocument();
        expect(screen.getByText('This verification link is invalid or has been removed.')).toBeInTheDocument();
    });
});
