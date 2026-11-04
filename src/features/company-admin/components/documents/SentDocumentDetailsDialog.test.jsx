// Sent-document details dialog. With the table now showing a single quick
// action per row, this dialog is the complete home for document information
// and every permitted secondary action, so its status→action contract gets its
// own coverage. All fixtures are artificial (RFC 2606 domains, reserved
// 555-01xx numbers); no real signing token or link is ever rendered.
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

import { SentDocumentDetailsDialog } from './SentDocumentDetailsDialog';

const SECRET_TOKEN = 'artificial-secret-signing-token';

const makeDoc = (overrides = {}) => ({
    id: 'req-1',
    title: 'Offer Letter',
    recipientName: 'Pat Example',
    recipientEmail: 'pat@example.test',
    recipientPhone: '555-0142',
    deliveryMethod: 'email',
    status: 'sent',
    createdAt: { seconds: 1700000000 },
    // A link that still works (2100-01-01), so the default document is one waiting for its signer.
    expiresAt: { seconds: 4102444800 },
    // Fields a stored request may carry that must never reach the DOM.
    signingToken: SECRET_TOKEN,
    signingLink: `https://sign.example.test/${SECRET_TOKEN}`,
    ...overrides,
});

function renderDialog(docFixture, props = {}) {
    const handlers = {
        onClose: vi.fn(),
        onCopyLink: vi.fn(),
        onCorrect: vi.fn(),
        onVoid: vi.fn(),
        onDownload: vi.fn(),
    };
    const utils = render(
        <SentDocumentDetailsDialog document={docFixture} {...handlers} {...props} />,
    );
    return { handlers, ...utils };
}

describe('SentDocumentDetailsDialog — content', () => {
    it('renders nothing without a document', () => {
        renderDialog(null);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('is a dialog named after the document showing the stored details', () => {
        // 'both' maps to a delivery label that cannot collide with the "Email" row label.
        renderDialog(makeDoc({ deliveryMethod: 'both' }));
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAccessibleName('Offer Letter');
        expect(within(dialog).getByText('Pat Example')).toBeInTheDocument();
        expect(within(dialog).getByText('pat@example.test')).toBeInTheDocument();
        expect(within(dialog).getByText('555-0142')).toBeInTheDocument();
        expect(within(dialog).getByText('Email + SMS')).toBeInTheDocument();
        expect(within(dialog).getByText(new Date(1700000000 * 1000).toLocaleDateString())).toBeInTheDocument();
        expect(within(dialog).getByText('sent')).toBeInTheDocument();
    });

    it('uses the Untitled fallback and em dashes for missing values', () => {
        renderDialog(makeDoc({
            title: undefined,
            recipientName: undefined,
            recipientEmail: undefined,
            recipientPhone: undefined,
            deliveryMethod: undefined,
            createdAt: undefined,
            expiresAt: undefined,
        }));
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAccessibleName('Untitled');
        expect(within(dialog).getAllByText('—').length).toBeGreaterThanOrEqual(6);
    });

    it('shows the full delivery error for a failed delivery', () => {
        renderDialog(makeDoc({ emailStatus: 'failed', emailError: 'SMTP 550 mailbox unavailable (artificial)' }));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('Email delivery error');
        expect(alert).toHaveTextContent('SMTP 550 mailbox unavailable (artificial)');
    });

    it('shows a failed text the same way, naming it', () => {
        renderDialog(makeDoc({ sendSms: true, smsStatus: 'failed', smsError: 'Line unavailable (artificial)' }));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent('SMS delivery error');
        expect(alert).toHaveTextContent('Line unavailable (artificial)');
    });

    it('shows the sealing error, with the exact fallback when no detail exists', () => {
        renderDialog(makeDoc({ status: 'error_sealing', errorLog: 'PDF seal step failed (artificial)' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Sealing error');
        expect(screen.getByRole('alert')).toHaveTextContent('PDF seal step failed (artificial)');
    });

    it('uses the recorded fallback when a failure carries no detail', () => {
        renderDialog(makeDoc({ emailStatus: 'failed', emailError: undefined }));
        expect(screen.getByRole('alert')).toHaveTextContent('No further detail was recorded.');
    });

    it('never renders the signing token or raw signing link', () => {
        const { container } = renderDialog(makeDoc());
        expect(container.innerHTML).not.toContain(SECRET_TOKEN);
    });
});

describe('SentDocumentDetailsDialog — status-dependent actions', () => {
    it('offers Copy Link, Correct and Void for a sent document', () => {
        const { handlers } = renderDialog(makeDoc({ status: 'sent' }));
        const dialog = screen.getByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Copy Link' }));
        expect(handlers.onCopyLink).toHaveBeenCalledTimes(1);
        expect(handlers.onCopyLink.mock.calls[0][0]).toMatchObject({ id: 'req-1', status: 'sent' });

        fireEvent.click(within(dialog).getByRole('button', { name: 'Correct' }));
        expect(handlers.onCorrect).toHaveBeenCalledTimes(1);
        expect(handlers.onCorrect.mock.calls[0][0]).toMatchObject({ id: 'req-1' });

        fireEvent.click(within(dialog).getByRole('button', { name: 'Void' }));
        expect(handlers.onVoid).toHaveBeenCalledTimes(1);
        expect(handlers.onVoid.mock.calls[0][0]).toMatchObject({ id: 'req-1' });
    });

    it('hides Correct when no handler is supplied', () => {
        renderDialog(makeDoc({ status: 'sent' }), { onCorrect: undefined });
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Void' })).toBeInTheDocument();
    });

    it('offers only Download for a signed document, using the stored path', () => {
        const { handlers } = renderDialog(makeDoc({
            status: 'signed',
            signedPdfUrl: 'companies/co-1/signed/artificial.pdf',
        }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('button', { name: /Copy Link|Correct|Void/ })).not.toBeInTheDocument();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
        expect(handlers.onDownload).toHaveBeenCalledWith('companies/co-1/signed/artificial.pdf');
    });

    it('falls back to storagePath when a signed document has no signedPdfUrl', () => {
        const { handlers } = renderDialog(makeDoc({
            status: 'signed',
            signedPdfUrl: undefined,
            storagePath: 'companies/co-1/raw/artificial.pdf',
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Download' }));
        expect(handlers.onDownload).toHaveBeenCalledWith('companies/co-1/raw/artificial.pdf');
    });

    it('keeps a voided document read-only', () => {
        renderDialog(makeDoc({ status: 'voided' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('button', { name: /Copy Link|Correct|Void|Download/ })).not.toBeInTheDocument();
        expect(within(dialog).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThanOrEqual(1);
    });

    it('offers Copy Link but not Correct or Void for a processing document', () => {
        renderDialog(makeDoc({ status: 'processing' }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Copy Link' })).toBeInTheDocument();
        expect(within(dialog).queryByRole('button', { name: /Correct|^Void$/ })).not.toBeInTheDocument();
    });

    it('marks Copy Link busy while the link is being retrieved', () => {
        renderDialog(makeDoc({ status: 'sent' }), { copying: true });
        expect(screen.getByRole('button', { name: 'Copy Link' })).toBeDisabled();
    });
});

describe('SentDocumentDetailsDialog — dialog behaviour', () => {
    it('closes from the footer button, the icon button and Escape', () => {
        const { handlers } = renderDialog(makeDoc());
        const dialog = screen.getByRole('dialog');
        const closeButtons = within(dialog).getAllByRole('button', { name: 'Close' });
        expect(closeButtons.length).toBeGreaterThanOrEqual(2);
        fireEvent.click(closeButtons[0]);
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(handlers.onClose).toHaveBeenCalledTimes(2);
    });

    it('has no accessibility violations across representative states', async () => {
        const sent = renderDialog(makeDoc({ status: 'sent' }));
        expect((await axe(sent.container)).violations).toEqual([]);
        sent.unmount();

        const failed = renderDialog(makeDoc({
            status: 'error_sealing',
            emailStatus: 'failed',
            emailError: 'SMTP 550 (artificial)',
        }));
        expect((await axe(failed.container)).violations).toEqual([]);
    });
});

describe('SentDocumentDetailsDialog — a link that ran out, and Remind', () => {
    const EXPIRED_AT = { seconds: 1702592000 };
    const expired = (overrides = {}) => makeDoc({ sendEmail: true, expiresAt: EXPIRED_AT, ...overrides });
    const statusRow = (dialog) => within(dialog).getByText('Status').closest('div');

    it('says the link expired, when, and that Remind sends it again', () => {
        renderDialog(expired(), { onRemind: vi.fn() });
        const dialog = screen.getByRole('dialog');

        expect(statusRow(dialog)).toHaveTextContent('Link expired');
        const notice = within(dialog).getByRole('status');
        expect(notice).toHaveTextContent('Link expired');
        expect(notice).toHaveTextContent(`stopped working on ${new Date(EXPIRED_AT.seconds * 1000).toLocaleDateString()}`);
        expect(notice).toHaveTextContent('Remind sends it again with seven more days.');
    });

    it('offers Remind, which asks for this document', () => {
        const onRemind = vi.fn();
        const document = expired();
        renderDialog(document, { onRemind });

        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remind' }));
        expect(onRemind).toHaveBeenCalledWith(document);
    });

    it('is busy, and cannot be pressed again, while the reminder is on its way', () => {
        renderDialog(expired(), { onRemind: vi.fn(), reminding: true });
        expect(screen.getByRole('button', { name: /Remind/ })).toBeDisabled();
    });

    it('offers Remind on a document whose link still works, and calls it neither expired nor anything new', () => {
        renderDialog(makeDoc({ sendEmail: true }), { onRemind: vi.fn() });
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('button', { name: 'Remind' })).toBeInTheDocument();
        expect(statusRow(dialog)).toHaveTextContent(/^Statussent$/);
        expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    });

    it('says what to do about an expired document shared by a copied link, and offers no Remind', () => {
        renderDialog(expired({ sendEmail: false, sendSms: false, deliveryMethod: 'copy' }), { onRemind: vi.fn() });
        const dialog = screen.getByRole('dialog');

        expect(within(dialog).queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('status')).toHaveTextContent('shared by a copied link');
        expect(within(dialog).getByRole('status')).toHaveTextContent('Correct it to add an email address or a phone number');
    });

    it.each(['signed', 'voided', 'processing', 'error_sealing'])('offers no Remind on a %s document', (status) => {
        renderDialog(expired({ status }), { onRemind: vi.fn() });
        expect(screen.queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
        expect(statusRow(screen.getByRole('dialog'))).not.toHaveTextContent('Link expired');
    });

    it('offers no Remind where no handler is given', () => {
        renderDialog(expired());
        expect(screen.queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
    });

    it('shows how many reminders went, and when the last did', () => {
        renderDialog(makeDoc({ sendEmail: true, reminders: { count: 2, lastAt: { seconds: 1700500000 }, lastBy: 'user-1' } }));
        const row = within(screen.getByRole('dialog')).getByText('Reminders').closest('div');
        expect(row).toHaveTextContent(`2 sent, the last on ${new Date(1700500000 * 1000).toLocaleDateString()}`);
    });

    it('shows no reminders row before the first', () => {
        renderDialog(makeDoc());
        expect(screen.queryByText('Reminders')).not.toBeInTheDocument();
    });

    it('has no accessibility violations with an expired link and Remind offered', async () => {
        const view = renderDialog(expired(), { onRemind: vi.fn() });
        expect((await axe(view.container)).violations).toEqual([]);
    });
});

describe('SentDocumentDetailsDialog — a signed copy whose send never finished', () => {
    const FIELDS = [
        { id: 'sig1', type: 'signature', pageNumber: 1 },
        { id: 'cs1', type: 'company_signature', pageNumber: 1, companySignaturePath: 'secure_documents/co-1/originals/company-signatures/a.png' },
    ];

    it('turns "Sending copy…" into Try again by itself when the claim lapses, and clears its timer', () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
        try {
            // Approved five seconds short of ten minutes ago.
            const record = { state: 'sending', sentTo: 'pat@example.test', approvedAt: new Date(Date.now() - (10 * 60 * 1000 - 5000)) };
            const { unmount } = renderDialog(makeDoc({ status: 'signed', fields: FIELDS, signedCopy: record }), {
                signedCopyRecord: record,
                onSendSignedCopy: vi.fn(),
            });
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByText('Sending copy…')).toBeInTheDocument();
            expect(within(dialog).queryByRole('button', { name: /Try again/ })).not.toBeInTheDocument();

            act(() => { vi.advanceTimersByTime(7000); });
            expect(within(dialog).getByText('Copy may not have been sent')).toBeInTheDocument();
            expect(within(dialog).getByRole('button', { name: /Try again/ })).toHaveTextContent('Try again');

            unmount();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('SentDocumentDetailsDialog — Retry seal', () => {
    const MINUTE = 60 * 1000;
    const signedAgo = (minutes) => ({ seconds: Math.floor((Date.now() - minutes * MINUTE) / 1000), nanoseconds: 0 });

    it('offers Retry seal under the sealing error, and asks for this document', () => {
        const failed = makeDoc({ status: 'error_sealing', errorLog: 'Company signature image missing or unreadable: cs1' });
        const onRetrySeal = vi.fn();
        renderDialog(failed, { onRetrySeal });

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Company signature image missing or unreadable: cs1');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Retry seal' }));
        expect(onRetrySeal).toHaveBeenCalledWith(failed);
    });

    it('is busy, and cannot be pressed again, while the retry is asked for', () => {
        renderDialog(makeDoc({ status: 'error_sealing' }), { onRetrySeal: vi.fn(), retryingSeal: true });
        expect(screen.getByRole('button', { name: /Retry seal/ })).toBeDisabled();
    });

    it('says a seal left unfinished did not finish, and offers to seal it again', () => {
        const onRetrySeal = vi.fn();
        renderDialog(makeDoc({ status: 'pending_seal', signedAt: signedAgo(11) }), { onRetrySeal });

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('status')).toHaveTextContent('Sealing did not finish');
        expect(within(dialog).getByRole('button', { name: 'Retry seal' })).toBeEnabled();
    });

    it.each([
        ['a document still sealing', { status: 'pending_seal', signedAt: signedAgo(2) }],
        ['a signed document', { status: 'signed', signedPdfUrl: 'secure_documents/co-1/completed/req-1_signed.pdf' }],
        ['a sent document', { status: 'sent' }],
        ['a voided document', { status: 'voided' }],
    ])('offers no retry for %s', (_label, overrides) => {
        renderDialog(makeDoc(overrides), { onRetrySeal: vi.fn() });
        expect(screen.queryByRole('button', { name: /Retry seal/ })).not.toBeInTheDocument();
        expect(screen.queryByText('Sealing did not finish')).not.toBeInTheDocument();
    });

    it('offers no retry where no handler is given', () => {
        renderDialog(makeDoc({ status: 'error_sealing' }));
        expect(screen.queryByRole('button', { name: /Retry seal/ })).not.toBeInTheDocument();
    });

    it('has no accessibility violations with the retry offered', async () => {
        const failed = renderDialog(makeDoc({ status: 'error_sealing', errorLog: 'Failed (artificial)' }), { onRetrySeal: vi.fn() });
        expect((await axe(failed.container)).violations).toEqual([]);
        failed.unmount();

        const unfinished = renderDialog(makeDoc({ status: 'pending_seal', signedAt: signedAgo(30) }), { onRetrySeal: vi.fn() });
        expect((await axe(unfinished.container)).violations).toEqual([]);
    });
});
