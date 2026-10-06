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
    {
        id: 'fcraDisclosure', version: 'v1', title: 'BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION', body: 'FCRA disclosure full text.', requiresSignature: true,
        links: [{ label: 'A Summary of Your Rights Under the Fair Credit Reporting Act', url: 'https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09.pdf', note: 'Provided with this disclosure.' }],
    },
    { id: 'pspDisclosure', version: 'v1', title: 'FMCSA PSP DISCLOSURE AND AUTHORIZATION', body: 'PSP disclosure full text.', requiresSignature: true },
    { id: 'clearinghouseConsent', version: 'v1', title: 'FMCSA DRUG AND ALCOHOL CLEARINGHOUSE CONSENT', body: 'Clearinghouse consent full text.', requiresSignature: true },
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
const nextButton = () => screen.getByRole('button', { name: /^(Next document|Continue to signature)$/ });
const box = (id) => document.getElementById(`agreement-${id}`);
const CERTIFICATION = 'This certifies that this application was completed by me, and that all entries on it and information in it are true and complete to the best of my knowledge.';

/** Accept each document on its own page and go on, ending on the signature page. */
async function acceptAll() {
    for (const a of AGREEMENTS) {
        await waitFor(() => expect(box(a.id)).toBeInTheDocument());
        fireEvent.click(box(a.id));
        fireEvent.click(nextButton());
    }
    await waitFor(() => expect(screen.getByText('Final Certification & Signature')).toBeInTheDocument());
}

const accepted = (version) => Object.fromEntries(AGREEMENTS.map((a) => [a.id, { accepted: true, version }]));

describe('Step9_Consent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCall.mockResolvedValue({ data: { agreementVersion: 'v1', companyName: 'Blue Line Freight', agreements: AGREEMENTS } });
    });

    it('shows each agreement in full on a page of its own, the Clearinghouse consent included', async () => {
        render(<Harness />);

        for (const [index, a] of AGREEMENTS.entries()) {
            await waitFor(() => expect(screen.getByText(a.title)).toBeInTheDocument());
            // The full body, not a one-line summary standing in for it ...
            expect(screen.getByText(a.body)).toBeInTheDocument();
            expect(screen.getByText(`Document ${index + 1} of ${AGREEMENTS.length}`)).toBeInTheDocument();
            // ... and nothing else on the page: no other agreement, no certification.
            for (const other of AGREEMENTS.filter((o) => o.id !== a.id)) {
                expect(screen.queryByText(other.body)).not.toBeInTheDocument();
            }
            expect(screen.queryByText(/release employers, schools/)).not.toBeInTheDocument();
            fireEvent.click(box(a.id));
            fireEvent.click(nextButton());
        }
        expect(await screen.findByText('Final Certification & Signature')).toBeInTheDocument();
    });

    it("lists a document's companions under it, outside its text, opening in a new tab", async () => {
        render(<Harness />);
        await waitFor(() => expect(box('electronicSignature')).toBeInTheDocument());
        fireEvent.click(box('electronicSignature'));
        fireEvent.click(nextButton());

        const summary = await screen.findByRole('link', { name: /A Summary of Your Rights Under the Fair Credit Reporting Act/ });
        expect(summary).toHaveAttribute('href', 'https://files.consumerfinance.gov/f/documents/bcfp_consumer-rights-summary_2018-09.pdf');
        expect(summary).toHaveAttribute('target', '_blank');
        // Beside the disclosure, never inside it: the document consists solely of itself.
        const document_ = screen.getByRole('group', { name: 'BACKGROUND CHECK DISCLOSURE AND AUTHORIZATION full text' });
        expect(document_).not.toContainElement(summary);
    });

    it('requests agreements for the company being applied to', async () => {
        render(<Harness />);
        await waitFor(() => expect(mockCall).toHaveBeenCalledWith({ companyId: 'co1' }));
    });

    it('moves on only once the document on screen is acknowledged, and ticking does not turn the page', async () => {
        render(<Harness />);
        await waitFor(() => expect(box('electronicSignature')).toBeInTheDocument());

        // Pressable, and it explains itself: the box is named, flagged and focused.
        expect(nextButton()).toBeEnabled();
        fireEvent.click(nextButton());
        expect(box('electronicSignature')).toBeInTheDocument();
        expect(screen.getByText('Tick "I have read and agree" to go on.')).toBeInTheDocument();
        expect(box('electronicSignature')).toHaveAttribute('aria-invalid', 'true');
        expect(box('electronicSignature')).toHaveFocus();

        fireEvent.click(box('electronicSignature'));
        // Still the same document until the driver goes on, and the message is gone.
        expect(box('electronicSignature')).toBeChecked();
        expect(screen.getByText(AGREEMENTS[0].body)).toBeInTheDocument();
        expect(screen.queryByText('Tick "I have read and agree" to go on.')).not.toBeInTheDocument();

        fireEvent.click(nextButton());
        await waitFor(() => expect(box('fcraDisclosure')).toBeInTheDocument());
        expect(box('electronicSignature')).toBeNull();
    });

    it('goes back a document with Back, keeping what was acknowledged', async () => {
        render(<Harness />);
        await waitFor(() => expect(box('electronicSignature')).toBeInTheDocument());
        fireEvent.click(box('electronicSignature'));
        fireEvent.click(nextButton());
        await waitFor(() => expect(box('fcraDisclosure')).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        await waitFor(() => expect(box('electronicSignature')).toBeChecked());
    });

    it('blocks submission until every agreement is acknowledged', async () => {
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);
        await acceptAll();
        await waitFor(() => expect(submitButton()).toBeEnabled());
    });

    it('opens on the signature page when every agreement is already accepted at the version shown', async () => {
        render(<Harness initial={{ agreementAcceptances: accepted('v1') }} />);
        expect(await screen.findByText('Final Certification & Signature')).toBeInTheDocument();
        expect(box('electronicSignature')).toBeNull();
    });

    it('asks again for an agreement accepted at a version since replaced', async () => {
        // A draft that agreed to earlier wording has not agreed to this wording.
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig', agreementAcceptances: accepted('v0') }} />);
        await waitFor(() => expect(box('electronicSignature')).toBeInTheDocument());
        expect(box('electronicSignature')).not.toBeChecked();
        fireEvent.click(nextButton());
        expect(box('electronicSignature')).toBeInTheDocument();
        expect(box('electronicSignature')).toHaveAttribute('aria-invalid', 'true');
    });

    it('records per-agreement acceptance evidence with the version accepted', async () => {
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);
        await waitFor(() => expect(box('electronicSignature')).toBeInTheDocument());

        fireEvent.click(box('electronicSignature'));
        await waitFor(() => expect(box('electronicSignature').checked).toBe(true));
        // Accepted at the version shown, so the page opens on the next document
        // when the step is shown again.
        fireEvent.click(nextButton());
        await waitFor(() => expect(box('fcraDisclosure')).toBeInTheDocument());
    });

    it('withdrawing an acknowledgement re-blocks submission', async () => {
        render(<Harness initial={{ 'final-certification': 'agreed', signature: 'sig' }} />);
        await acceptAll();
        await waitFor(() => expect(submitButton()).toBeEnabled());

        // Back to the last document and a change of mind: a stale acceptedAt must
        // not survive it.
        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        await waitFor(() => expect(box('clearinghouseConsent')).toBeChecked());
        fireEvent.click(box('clearinghouseConsent'));
        fireEvent.click(nextButton());
        expect(box('clearinghouseConsent')).toBeInTheDocument();
        expect(screen.queryByText('Final Certification & Signature')).not.toBeInTheDocument();
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
        await acceptAll();
        // Agreements alone must not unlock submission.
        expect(submitButton()).toBeDisabled();
    });

    it('replaces Save with a new Clear button once signed, rather than restyling it in place', async () => {
        render(<Harness />);
        await acceptAll();
        const save = screen.getByRole('button', { name: /Save Signature/ });

        fireEvent.click(save);

        const clear = await screen.findByRole('button', { name: /Clear \/ Re-draw Signature/ });
        // A reused element would carry the primary button's colours into a
        // transition towards the secondary's, unreadable half-way.
        expect(clear).not.toBe(save);
        expect(save).not.toBeInTheDocument();
    });

    it('ends the certification with the 391.21(b)(12) sentence, word for word, and certifies against it', async () => {
        render(<Harness />);
        await acceptAll();

        const certification = screen.getByRole('group', { name: 'Certification of applicant' });
        const paragraphs = certification.querySelectorAll('p');
        expect(paragraphs[paragraphs.length - 1]).toHaveTextContent(CERTIFICATION);
        expect(screen.getAllByText(CERTIFICATION)).toHaveLength(2);
    });

    it('gives each document a keyboard-reachable full-text group', async () => {
        render(<Harness />);
        for (const a of AGREEMENTS) {
            const region = await screen.findByRole('group', { name: `${a.title} full text` });
            expect(region).toHaveAttribute('tabindex', '0');
            fireEvent.click(box(a.id));
            fireEvent.click(nextButton());
        }
    });
});
