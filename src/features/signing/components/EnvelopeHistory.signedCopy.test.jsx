// EnvelopeHistory: the approved signed copy. A signed document with a company
// signature waits for an employee to review it and approve sending; only then
// does the driver get the PDF by email, once. The callable decides; this table
// offers the action only where it can succeed and shows what the server
// recorded (`signedCopy`). All fixtures are artificial (see the support's
// PRIVACY note).
import React from 'react';
import { act, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('./EnvelopeHistory.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeHistory.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvelopeHistory.support')).libFirebaseMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeHistory.support')).feedbackMock());

import EnvelopeHistory from './EnvelopeHistory';
import {
    makeRenderHistory,
    resetHarness,
    restoreHarness,
    makeDoc,
    emit,
    openDetails,
    callables,
    fnMocks,
    toast,
} from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

const SIGNED_PDF = 'secure_documents/co-1/signed/req-1.pdf';
const FIELDS = [
    { id: 'sig1', type: 'signature', pageNumber: 1 },
    { id: 'cs1', type: 'company_signature', pageNumber: 1, companySignaturePath: 'secure_documents/co-1/originals/company-signatures/a.png' },
];
const NOV_4 = { seconds: Date.parse('2026-11-04T15:00:00Z') / 1000 };

const signed = (overrides = {}) => makeDoc({ status: 'signed', signedPdfUrl: SIGNED_PDF, fields: FIELDS, ...overrides });
const sendAction = () => screen.queryByRole('button', { name: 'Send signed copy of Offer Letter' });
const approvalDialog = () => screen.findByRole('dialog', { name: 'Send the signed copy?' });

beforeEach(resetHarness);
afterEach(restoreHarness);

describe('EnvelopeHistory — when Send signed copy is offered', () => {
    it('offers it for a signed document with a company signature, the driver\'s signature and an email', () => {
        renderHistory();
        emit([signed()]);
        expect(sendAction()).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Download Offer Letter' })).not.toBeInTheDocument();
    });

    it.each([
        ['not signed yet', { status: 'sent' }],
        ['voided', { status: 'voided' }],
        ['a failed seal', { status: 'error_sealing' }],
        ['still sealing', { status: 'pending_seal' }],
        ['no company signature', { fields: [FIELDS[0]] }],
        ['no driver signature', { fields: [FIELDS[1]] }],
        ['no email', { recipientEmail: '', recipientPhone: '(555) 010-0101' }],
        ['a copy being sent', { signedCopy: { state: 'sending', sentTo: 'pat@example.test', approvedAt: new Date() } }],
        ['a copy already sent', { signedCopy: { state: 'sent', sentTo: 'pat@example.test', sentAt: NOV_4 } }],
    ])('does not offer it with %s', (_label, overrides) => {
        renderHistory();
        emit([signed(overrides)]);
        expect(sendAction()).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();
    });

    it('leaves a signed document without a company signature exactly as it was', () => {
        renderHistory();
        emit([signed({ fields: [FIELDS[0]] })]);
        expect(screen.getByRole('button', { name: 'Download Offer Letter' })).toBeInTheDocument();
        expect(screen.queryByText(/Copy sent|Sending copy|Copy not sent/)).not.toBeInTheDocument();
    });
});

describe('EnvelopeHistory — what the row says about the copy', () => {
    it('says where and when a copy was sent, and offers Download again', () => {
        renderHistory();
        emit([signed({ signedCopy: { state: 'sent', sentTo: 'pat@example.test', sentAt: NOV_4 } })]);
        expect(screen.getByText('Copy sent to pat@example.test on Nov 4, 2026')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download Offer Letter' })).toBeInTheDocument();
    });

    it('says a copy is on its way, and offers no second send', () => {
        renderHistory();
        emit([signed({ signedCopy: { state: 'sending', sentTo: 'pat@example.test', approvedAt: new Date() } })]);
        expect(screen.getByText('Sending copy…')).toBeInTheDocument();
        expect(sendAction()).not.toBeInTheDocument();
    });

    it.each([
        ['approved over ten minutes ago', { approvedAt: new Date(Date.now() - 11 * 60 * 1000) }],
        ['with no approval time', {}],
    ])('offers to try again once a send %s never finished, as the server allows', (_label, claim) => {
        renderHistory();
        emit([signed({ signedCopy: { state: 'sending', sentTo: 'pat@example.test', ...claim } })]);
        expect(screen.getByText('Copy may not have been sent')).toBeInTheDocument();
        expect(screen.queryByText('Sending copy…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Try again: send signed copy of Offer Letter' })).toHaveTextContent('Try again');
    });

    it('turns "Sending copy…" into Try again by itself when the claim lapses', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            // Approved five seconds short of ten minutes ago.
            const approvedAt = new Date(Date.now() - (10 * 60 * 1000 - 5000));
            const { unmount } = renderHistory();
            emit([signed({ signedCopy: { state: 'sending', sentTo: 'pat@example.test', approvedAt } })]);
            expect(screen.getByText('Sending copy…')).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();

            act(() => { vi.advanceTimersByTime(4000); });
            expect(screen.getByText('Sending copy…')).toBeInTheDocument();

            act(() => { vi.advanceTimersByTime(3000); });
            expect(screen.getByText('Copy may not have been sent')).toBeInTheDocument();
            expect(screen.queryByText('Sending copy…')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Try again: send signed copy of Offer Letter' })).toHaveTextContent('Try again');

            unmount();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('clears the claim\'s timer when the table unmounts before it lapses', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            const { unmount } = renderHistory();
            emit([signed({ signedCopy: { state: 'sending', sentTo: 'pat@example.test', approvedAt: new Date() } })]);
            expect(vi.getTimerCount()).toBeGreaterThan(0);
            unmount();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('says a copy was not sent, and offers to try again', () => {
        renderHistory();
        emit([signed({ signedCopy: { state: 'failed', sentTo: 'pat@example.test', error: 'Mailbox unavailable' } })]);
        expect(screen.getByText('Copy not sent')).toBeInTheDocument();
        const retry = screen.getByRole('button', { name: 'Try again: send signed copy of Offer Letter' });
        expect(retry).toHaveTextContent('Try again');
    });
});

describe('EnvelopeHistory — approving the send', () => {
    it('shows the document, the address, the signed PDF and what will happen', async () => {
        const openSpy = vi.fn();
        vi.stubGlobal('open', openSpy);
        renderHistory();
        emit([signed()]);
        fireEvent.click(sendAction());

        const dialog = await approvalDialog();
        expect(within(dialog).getByText('Offer Letter')).toBeInTheDocument();
        expect(within(dialog).getByText('pat@example.test')).toBeInTheDocument();
        expect(dialog).toHaveAccessibleDescription(
            'The driver gets the signed PDF, with your company signature, at this address. This is sent once.',
        );
        expect(within(dialog).getByRole('button', { name: 'Approve and send' })).toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', { name: 'View signed PDF' }));
        await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://files.example.test/artificial-signed.pdf', '_blank'));
        expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: SIGNED_PDF });
        // Viewing is not approving: the dialog stays and nothing is sent.
        expect(screen.getByRole('dialog', { name: 'Send the signed copy?' })).toBeInTheDocument();
        expect(callables.sendSignedDocumentCopy).not.toHaveBeenCalled();
    });

    it('sends nothing on Cancel', async () => {
        renderHistory();
        emit([signed()]);
        fireEvent.click(sendAction());
        fireEvent.click(within(await approvalDialog()).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(callables.sendSignedDocumentCopy).not.toHaveBeenCalled();
    });

    it('calls the server once, is disabled and labelled while it waits, then says it went', async () => {
        let finish;
        callables.sendSignedDocumentCopy.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        renderHistory();
        emit([signed()]);
        fireEvent.click(sendAction());
        const dialog = await approvalDialog();

        const approve = within(dialog).getByRole('button', { name: 'Approve and send' });
        fireEvent.click(approve);
        fireEvent.click(approve);
        const pending = await within(dialog).findByRole('button', { name: /Sending/ });
        expect(pending).toBeDisabled();
        fireEvent.click(pending);

        expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'sendSignedDocumentCopy');
        expect(callables.sendSignedDocumentCopy).toHaveBeenCalledTimes(1);
        expect(callables.sendSignedDocumentCopy).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1', recipientEmail: 'pat@example.test' });

        finish({ data: { success: true, sentTo: 'pat@example.test', sentAt: '2026-11-04T15:00:00.000Z' } });

        await waitFor(() => expect(screen.getByText('Copy sent to pat@example.test on Nov 4, 2026')).toBeInTheDocument());
        expect(toast.showSuccess).toHaveBeenCalledWith('Signed copy sent to pat@example.test');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(sendAction()).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Download Offer Letter' })).toBeInTheDocument();
    });

    it('shows the server\'s own reason when it refuses, and keeps the dialog open', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.sendSignedDocumentCopy.mockImplementation(async () => {
            throw Object.assign(new Error('Only a company admin or HR user can approve this.'), { code: 'functions/permission-denied' });
        });
        renderHistory();
        emit([signed()]);
        fireEvent.click(sendAction());
        const dialog = await approvalDialog();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send' }));

        await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Only a company admin or HR user can approve this.'));
        expect(toast.showSuccess).not.toHaveBeenCalled();
        expect(within(dialog).getByRole('button', { name: 'Approve and send' })).not.toBeDisabled();
        consoleError.mockRestore();
    });

    it('approves the address it showed, even after a correction changes it, and shows the server\'s refusal', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const changed = 'The signer\'s email changed after you opened this. Close it and review the document again.';
        callables.sendSignedDocumentCopy.mockImplementation(async () => {
            throw Object.assign(new Error(changed), { code: 'functions/aborted' });
        });
        renderHistory();
        emit([signed()]);
        fireEvent.click(sendAction());
        const dialog = await approvalDialog();
        // A correction saved while the approval is open.
        emit([signed({ recipientEmail: 'pat.new@example.test' })]);
        expect(within(dialog).getByText('pat@example.test')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Approve and send' }));

        await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent(changed));
        expect(callables.sendSignedDocumentCopy).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1', recipientEmail: 'pat@example.test' });
        expect(toast.showSuccess).not.toHaveBeenCalled();
        consoleError.mockRestore();
    });

    it('starts again from a failed copy', async () => {
        renderHistory();
        emit([signed({ signedCopy: { state: 'failed', sentTo: 'pat@example.test' } })]);
        fireEvent.click(screen.getByRole('button', { name: 'Try again: send signed copy of Offer Letter' }));
        fireEvent.click(within(await approvalDialog()).getByRole('button', { name: 'Approve and send' }));

        await waitFor(() => expect(screen.getByText('Copy sent to pat@example.test on Nov 4, 2026')).toBeInTheDocument());
        expect(callables.sendSignedDocumentCopy).toHaveBeenCalledTimes(1);
    });
});

describe('EnvelopeHistory — the signed copy in the details dialog', () => {
    it('says the copy is not sent yet and offers to send it', async () => {
        renderHistory();
        emit([signed()]);
        const details = await openDetails();
        expect(within(details).getByText('Signed copy')).toBeInTheDocument();
        expect(within(details).getByText('Not sent yet')).toBeInTheDocument();

        fireEvent.click(within(details).getByRole('button', { name: 'Send signed copy' }));
        expect(await approvalDialog()).toBeInTheDocument();
    });

    it('says where a sent copy went, with no second send', async () => {
        renderHistory();
        emit([signed({ signedCopy: { state: 'sent', sentTo: 'pat@example.test', sentAt: NOV_4 } })]);
        const details = await openDetails();
        expect(within(details).getByText('Copy sent to pat@example.test on Nov 4, 2026')).toBeInTheDocument();
        expect(within(details).queryByRole('button', { name: /Send signed copy|Try again/ })).not.toBeInTheDocument();
    });

    it('shows nothing about a copy for a document without a company signature', async () => {
        renderHistory();
        emit([signed({ fields: [FIELDS[0]] })]);
        const details = await openDetails();
        expect(within(details).queryByText('Signed copy')).not.toBeInTheDocument();
    });
});
