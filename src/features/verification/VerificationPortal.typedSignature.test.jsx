/**
 * The typed signature path through the real form (audit step J, 2026-09-06):
 * a respondent who cannot use a pointer can still sign — by choosing "Type" and
 * typing their name — and what reaches the callable says so.
 *
 * `SignaturePad` is stubbed (happy-dom has no canvas); `SignatureInput` is real.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const callables = vi.hoisted(() => ({
    getVerificationRequest: vi.fn(),
    submitVerificationResponse: vi.fn(),
}));
vi.mock('firebase/functions', () => ({
    httpsCallable: (_functions, name) => (...args) => callables[name](...args),
}));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => '' }));
vi.mock('@shared/components/signature/SignaturePad', () => ({
    SIGNATURE_CANVAS_HEIGHT: 150,
    SignaturePad: ({ onSignatureChange }) => (
        <button type="button" onClick={() => onSignatureChange('data:image/png;base64,artificial-sig')}>Mock sign</button>
    ),
}));

import { VerificationPortal } from './VerificationPortal';

const PENDING = {
    data: {
        status: 'pending',
        applicantName: 'Artificial Driver',
        employerName: 'Artificial Freight Co',
        companyName: 'Artificial Carrier',
        employmentStartDate: '2021-01-01',
        employmentEndDate: '2024-01-01',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    },
};

async function renderLoadedForm() {
    render(
        <MemoryRouter initialEntries={['/verify/token-typed']}>
            <Routes><Route path="/verify/:token" element={<VerificationPortal />} /></Routes>
        </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: /Previous Employment Verification/i });
}

function fillRespondent() {
    fireEvent.click(screen.getByRole('radio', { name: 'No / No Record Found' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Your Full Name/i }), { target: { value: 'Artificial Respondent' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Your Title \/ Position/i }), { target: { value: 'HR Manager' } });
    fireEvent.change(screen.getByRole('textbox', { name: /Phone Number/i }), { target: { value: '555-000-1111' } });
}

beforeEach(() => {
    vi.resetAllMocks();
    callables.getVerificationRequest.mockResolvedValue(PENDING);
    callables.submitVerificationResponse.mockResolvedValue({ data: { success: true } });
});

describe('typed signature on the verification portal', () => {
    it('offers Draw and Type under the Electronic Signature label, Draw first', async () => {
        await renderLoadedForm();
        const group = screen.getByRole('group', { name: /Electronic Signature/ });
        expect(group).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Draw', pressed: true })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Mock sign' })).toBeInTheDocument();
    });

    it('submits a typed name as TEXT_SIGNATURE with method "typed"', async () => {
        await renderLoadedForm();
        fillRespondent();
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        fireEvent.change(screen.getByRole('textbox', { name: /Type your full name to sign/ }), { target: { value: 'Artificial Respondent' } });
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));

        await waitFor(() => expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1));
        expect(callables.submitVerificationResponse.mock.calls[0][0].response).toMatchObject({
            signatureData: 'TEXT_SIGNATURE:Artificial Respondent',
            signatureMethod: 'typed',
        });
        expect(await screen.findByText('Verification Submitted Successfully')).toBeInTheDocument();
    });

    it('sends method "drawn" with a drawn mark', async () => {
        await renderLoadedForm();
        fillRespondent();
        fireEvent.click(screen.getByRole('button', { name: 'Mock sign' }));
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
        await waitFor(() => expect(callables.submitVerificationResponse).toHaveBeenCalledTimes(1));
        expect(callables.submitVerificationResponse.mock.calls[0][0].response).toMatchObject({
            signatureData: 'data:image/png;base64,artificial-sig',
            signatureMethod: 'drawn',
        });
    });

    it('still requires a signature when the typed name is too short, and clears it on switching methods', async () => {
        await renderLoadedForm();
        fillRespondent();
        fireEvent.click(screen.getByRole('button', { name: 'Type' }));
        fireEvent.change(screen.getByRole('textbox', { name: /Type your full name to sign/ }), { target: { value: 'A' } });
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
        const summary = (await screen.findByText('Please fix the following errors:')).closest('[role="alert"]');
        expect(summary.textContent).toContain('Please provide your electronic signature');
        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();

        fireEvent.change(screen.getByRole('textbox', { name: /Type your full name to sign/ }), { target: { value: 'Artificial Respondent' } });
        fireEvent.click(screen.getByRole('button', { name: 'Draw' }));
        fireEvent.click(screen.getByRole('button', { name: /Submit Verification Response/i }));
        await screen.findByText('Please fix the following errors:');
        expect(callables.submitVerificationResponse).not.toHaveBeenCalled();
    });
});
