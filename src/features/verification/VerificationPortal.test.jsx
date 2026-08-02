import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Artificial data only — no real tokens, drivers, or employers.
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
import {
    LoadingScreen,
    ErrorScreen,
    ExpiredScreen,
    AlreadyCompletedScreen,
    CompletedScreen,
} from './components/PortalStatusScreens';

const VALID = {
    status: 'pending',
    applicantName: 'Artificial Applicant',
    companyName: 'Artificial Requesting Carrier',
    employmentStartDate: '2020-02-02',
    employmentEndDate: '2023-03-03',
    expiresAt: '2099-01-01T00:00:00.000Z',
};

function renderPortal(token = 'token-xyz') {
    return render(
        <MemoryRouter initialEntries={[`/verify/${token}`]}>
            <Routes>
                <Route path="/verify/:token" element={<VerificationPortal />} />
            </Routes>
        </MemoryRouter>,
    );
}

async function renderLoadedForm() {
    const utils = renderPortal();
    expect(await screen.findByRole('heading', { level: 1, name: /Previous Employment Verification/i }))
        .toBeInTheDocument();
    return utils;
}

describe('VerificationPortal', () => {
    beforeEach(() => {
        callables.getVerificationRequest.mockReset();
        callables.submitVerificationResponse.mockReset();
        callables.getVerificationRequest.mockResolvedValue({ data: VALID });
        callables.submitVerificationResponse.mockResolvedValue({ data: { ok: true } });
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    });

    it('reads the token from the route and shows the loading state first', async () => {
        renderPortal('token-xyz');
        expect(screen.getByText('Loading verification request...')).toBeInTheDocument();
        await screen.findByRole('heading', { level: 1, name: /Previous Employment Verification/i });
        expect(callables.getVerificationRequest).toHaveBeenCalledWith({ token: 'token-xyz' });
    });

    it('renders exactly one h1 and the applicant details', async () => {
        await renderLoadedForm();
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByText('Artificial Applicant')).toBeInTheDocument();
        expect(screen.getByText('Artificial Requesting Carrier')).toBeInTheDocument();
        expect(screen.getByText('2020-02-02 to 2023-03-03')).toBeInTheDocument();
    });

    it('groups the employment radios with an accessible legend and preserved option labels', async () => {
        await renderLoadedForm();
        const group = screen.getByRole('group', { name: /Was this individual employed by your company\?/i });
        expect(within(group).getByRole('radio', { name: 'Yes' })).toBeInTheDocument();
        expect(within(group).getByRole('radio', { name: 'No / No Record Found' })).toBeInTheDocument();
    });

    it('reveals employment sub-fields with associated labels only after selecting Yes', async () => {
        await renderLoadedForm();
        expect(screen.queryByRole('textbox', { name: /Position \/ Title Held/i })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));

        expect(screen.getByRole('textbox', { name: /Position \/ Title Held/i })).toBeInTheDocument();
        // Section 2 (Safety) is conditional on employment.
        expect(screen.getByRole('group', { name: /Federal Motor Carrier Safety Regulations/i }))
            .toBeInTheDocument();
    });

    it('reveals the drug/alcohol violation follow-up only when DOT testing is Yes', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('radio', { name: 'Yes' }));

        expect(screen.queryByRole('group', { name: /DOT drug or alcohol violations/i })).not.toBeInTheDocument();

        const dotGroup = screen.getByRole('group', { name: /DOT drug & alcohol testing/i });
        fireEvent.click(within(dotGroup).getByRole('radio', { name: 'Yes' }));

        expect(screen.getByRole('group', { name: /DOT drug or alcohol violations/i })).toBeInTheDocument();
    });

    it('shows the error summary and moves focus on a validation failure without submitting', async () => {
        await renderLoadedForm();
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary).not.toBeNull();
        await waitFor(() => expect(summary).toHaveFocus());
        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
    });

    it('submits and transitions to the success state', async () => {
        await renderLoadedForm();
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

        await waitFor(() => expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1));
        expect(callables.submitVerificationResponse.mock.calls[0][0]).toMatchObject({
            token: 'token-xyz',
            response: expect.objectContaining({
                wasEmployed: false,
                respondentName: 'Artificial Respondent',
                respondentTitle: 'HR Manager',
                respondentPhone: '555-000-1111',
                signatureData: 'data:image/png;base64,artificial-sig',
            }),
        });
        expect(await screen.findByText('Verification Submitted Successfully')).toBeInTheDocument();
    });

    it('shows the invalid-link error screen for a not-found token', async () => {
        const err = new Error('nf');
        err.code = 'functions/not-found';
        callables.getVerificationRequest.mockRejectedValue(err);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderPortal();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('This verification link is invalid or has been removed.');
        expect(screen.getByRole('heading', { level: 1, name: 'Verification Error' })).toBeInTheDocument();
        consoleError.mockRestore();
    });

    it('has no accessibility violations in the loaded form', async () => {
        const { container } = await renderLoadedForm();
        expect((await axe(container)).violations).toEqual([]);
    });

    describe('status screens', () => {
        const cases = [
            [<LoadingScreen key="l" />, 'Loading verification request...'],
            [<ErrorScreen key="e" error="Artificial failure" />, 'Verification Error'],
            [<ExpiredScreen key="x" />, 'Link Expired'],
            [<AlreadyCompletedScreen key="a" />, 'Already Completed'],
            [
                <CompletedScreen key="c" verificationData={{ applicantName: 'Artificial Applicant' }} token="token-xyz" />,
                'Verification Submitted Successfully',
            ],
        ];

        it.each(cases)('renders a single h1 with no axe violations (%s)', async (element, heading) => {
            const { container } = render(element);
            const h1s = screen.getAllByRole('heading', { level: 1 });
            expect(h1s).toHaveLength(1);
            expect(h1s[0]).toHaveTextContent(heading);
            expect((await axe(container)).violations).toEqual([]);
        });
    });
});
