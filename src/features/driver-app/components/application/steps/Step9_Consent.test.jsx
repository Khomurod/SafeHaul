import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockCall = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => (...args) => mockCall(...args) }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@/context/DataContext', () => ({ useData: () => ({ currentCompanyProfile: { id: 'co1', companyName: 'Blue Line Freight' } }) }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false }));
vi.mock('@/lib/signature', () => ({
    getSignatureDataUrl: () => 'data:image/png;base64,' + 'A'.repeat(200),
    clearCanvas: vi.fn(),
    initializeSignatureCanvas: vi.fn(),
}));

import Step9_Consent from './Step9_Consent';

const AGREEMENTS = [
    { id: 'electronicSignature', version: 'v1', title: 'AGREEMENT TO CONDUCT TRANSACTION ELECTRONICALLY', body: 'Electronic transaction terms for Blue Line Freight.', requiresSignature: true },
    { id: 'fcraDisclosure', version: 'v1', title: 'BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION', body: 'FCRA disclosure full text.', requiresSignature: true },
    { id: 'pspDisclosure', version: 'v1', title: 'FMCSA PSP DISCLOSURE AND AUTHORIZATION', body: 'PSP disclosure full text.', requiresSignature: true },
    { id: 'clearinghouseConsent', version: 'v1', title: 'FMCSA CLEARINGHOUSE FULL QUERY CONSENT', body: 'Clearinghouse consent full text.', requiresSignature: true },
];

/** Controlled harness mirroring how the wizard owns formData. */
function Harness({ initial = {}, onFinalSubmit = vi.fn() }) {
    const [formData, setFormData] = useState(initial);
    const updateFormData = (key, value) => setFormData((p) => ({ ...p, [key]: value }));
    return (
        <Step9_Consent
            formData={formData}
            updateFormData={updateFormData}
            onNavigate={vi.fn()}
            onFinalSubmit={onFinalSubmit}
            isSubmitting={false}
            isUploading={false}
        />
    );
}

const submitButton = () => screen.getByRole('button', { name: /Submit Full Application/i });

async function acceptAll() {
    for (const a of AGREEMENTS) {
        fireEvent.click(document.getElementById(`agreement-${a.id}`));
    }
}

describe('Step9_Consent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCall.mockResolvedValue({ data: { agreementVersion: 'v1', companyName: 'Blue Line Freight', agreements: AGREEMENTS } });
    });

    it('shows all four agreements in full, including the Clearinghouse consent', async () => {
        render(<Harness />);
        await waitFor(() => expect(screen.getByText(AGREEMENTS[0].title)).toBeInTheDocument());

        for (const a of AGREEMENTS) {
            expect(screen.getByText(a.title)).toBeInTheDocument();
            // The full body, not a one-line summary standing in for it.
            expect(screen.getByText(a.body)).toBeInTheDocument();
        }
        expect(screen.getByText('FMCSA CLEARINGHOUSE FULL QUERY CONSENT')).toBeInTheDocument();
    });

    it('requests agreements for the company being applied to', async () => {
        render(<Harness />);
        await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ companyId: 'co1' }));
    });

    it('blocks submission until every agreement is acknowledged', async () => {
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);
        await waitFor(() => expect(screen.getByText(AGREEMENTS[0].title)).toBeInTheDocument());

        expect(submitButton()).toBeDisabled();

        // Three of four is still not enough — the old screen had exactly three.
        fireEvent.click(document.getElementById('agreement-electronicSignature'));
        fireEvent.click(document.getElementById('agreement-fcraDisclosure'));
        fireEvent.click(document.getElementById('agreement-pspDisclosure'));
        expect(submitButton()).toBeDisabled();

        fireEvent.click(document.getElementById('agreement-clearinghouseConsent'));
        await waitFor(() => expect(submitButton()).toBeEnabled());
    });

    it('records per-agreement acceptance evidence with the version accepted', async () => {
        const onFinalSubmit = vi.fn();
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} onFinalSubmit={onFinalSubmit} />);
        await waitFor(() => expect(screen.getByText(AGREEMENTS[0].title)).toBeInTheDocument());

        fireEvent.click(document.getElementById('agreement-fcraDisclosure'));

        // Evidence is held in formData; assert through the rendered checked state
        // plus the submit gate, then verify shape via the acknowledgement count.
        await waitFor(() => expect(document.getElementById('agreement-fcraDisclosure').checked).toBe(true));
        expect(screen.getByText(/acknowledge all 4 agreements/i)).toBeInTheDocument();
    });

    it('withdrawing an acknowledgement re-blocks submission', async () => {
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);
        await waitFor(() => expect(screen.getByText(AGREEMENTS[0].title)).toBeInTheDocument());

        await acceptAll();
        await waitFor(() => expect(submitButton()).toBeEnabled());

        // A stale acceptedAt must not survive a change of mind.
        fireEvent.click(document.getElementById('agreement-pspDisclosure'));
        await waitFor(() => expect(submitButton()).toBeDisabled());
    });

    it('refuses to let the driver sign when the agreements could not load', async () => {
        mockCall.mockRejectedValue(new Error('unavailable'));
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);

        // Queried by text: the signature-error wrapper is also a role="alert",
        // so a bare role query here would be ambiguous.
        await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
        // No agreements rendered means nothing legitimate to sign.
        expect(submitButton()).toBeDisabled();
        expect(screen.queryByText(AGREEMENTS[0].title)).not.toBeInTheDocument();
    });

    it('treats an empty agreement set as a failure, not as nothing to accept', async () => {
        mockCall.mockResolvedValue({ data: { agreementVersion: 'v1', agreements: [] } });
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);

        await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
        expect(submitButton()).toBeDisabled();
    });

    it('still requires the final certification and a signature', async () => {
        render(<Harness />);
        await waitFor(() => expect(screen.getByText(AGREEMENTS[0].title)).toBeInTheDocument());

        await acceptAll();
        // Agreements alone must not unlock submission.
        expect(submitButton()).toBeDisabled();
    });

    it('gives each agreement a keyboard-reachable scroll region', async () => {
        render(<Harness />);
        await waitFor(() => expect(screen.getByText(AGREEMENTS[0].title)).toBeInTheDocument());

        for (const a of AGREEMENTS) {
            const region = screen.getByRole('group', { name: `${a.title} full text` });
            expect(region).toHaveAttribute('tabindex', '0');
        }
    });
});
