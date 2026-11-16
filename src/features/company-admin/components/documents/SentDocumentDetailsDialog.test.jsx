// Sent-document details dialog. With the table now showing a single quick
// action per row, this dialog is the complete home for document information
// and every permitted secondary action, so its status→action contract gets its
// own coverage. All fixtures are artificial (RFC 2606 domains, reserved
// 555-01xx numbers); no real signing token or link is ever rendered.
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, expect, it, vi } from 'vitest';

import { formatDate } from '@shared/utils/helpers';
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
        expect(within(dialog).getByText(formatDate(new Date(1700000000 * 1000)))).toBeInTheDocument();
        expect(within(dialog).getByText('Awaiting signature')).toBeInTheDocument();
    });

    it('shows the sent and expiry days in the app\'s one date style (K3)', () => {
        // Midday UTC, so the day is the same in every US time zone.
        renderDialog(makeDoc({
            createdAt: { seconds: Date.UTC(2026, 2, 7, 12) / 1000 },
            expiresAt: { seconds: Date.UTC(2099, 0, 15, 12) / 1000 },
        }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Sent', { selector: 'dt' }).closest('div')).toHaveTextContent('Mar 7, 2026');
        expect(within(dialog).getByText('Expires', { selector: 'dt' }).closest('div')).toHaveTextContent('Jan 15, 2099');
        expect(within(dialog).queryByText('3/7/2026')).not.toBeInTheDocument();
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
        expect(notice).toHaveTextContent(`stopped working on ${formatDate(new Date(EXPIRED_AT.seconds * 1000))}`);
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
        expect(statusRow(dialog)).toHaveTextContent(/^StatusAwaiting signature$/);
        expect(within(dialog).queryByRole('status')).not.toBeInTheDocument();
    });

    it('says what to do about an expired document shared by a copied link, and offers no Remind', () => {
        renderDialog(expired({ sendEmail: false, sendSms: false, deliveryMethod: 'copy' }), { onRemind: vi.fn() });
        const dialog = screen.getByRole('dialog');

        expect(within(dialog).queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('status')).toHaveTextContent('shared by a copied link');
        expect(within(dialog).getByRole('status')).toHaveTextContent('Correct it to add an email address or a phone number');
    });

    it('calls a document copied-link only when it has no email or text to go by', () => {
        renderDialog(expired({ status: 'opened', sendEmail: true }), { onRemind: vi.fn() });
        const notice = within(screen.getByRole('dialog')).getByRole('status');

        expect(notice).toHaveTextContent('Link expired');
        expect(notice).not.toHaveTextContent('copied link');
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
        expect(row).toHaveTextContent(`2 sent, the last on ${formatDate(new Date(1700500000 * 1000))}`);
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

describe('SentDocumentDetailsDialog — an open document whose send failed', () => {
    const NOT_SET_UP = 'Failed to send email: Missing email configuration for company co-artificial. Please configure SMTP settings in Company Settings > Email tab.';
    const failedOpen = (overrides = {}) => makeDoc({
        sendEmail: true,
        emailStatus: 'failed',
        emailError: NOT_SET_UP,
        ...overrides,
    });
    const fixProps = () => ({ onRemind: vi.fn(), onFixRecipient: vi.fn() });
    const rerenderWith = (rerender, document, props) => rerender(
        <SentDocumentDetailsDialog
            document={document}
            onClose={vi.fn()}
            onCopyLink={vi.fn()}
            onCorrect={vi.fn()}
            onVoid={vi.fn()}
            onDownload={vi.fn()}
            {...props}
        />,
    );
    const footerActions = (dialog) => within(dialog).getAllByRole('button')
        .map((button) => button.textContent.trim())
        .filter((name) => ['Fix recipient and resend', 'Resend', 'Void', 'Correct', 'Remind'].includes(name));

    it('says why in plain words, above the server text, and what to do about it', () => {
        renderDialog(failedOpen(), fixProps());
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent("The company's email is not set up.");
        expect(alert).toHaveTextContent('A company admin can set it up in Settings → Email, then press Resend.');
        expect(alert).toHaveTextContent(NOT_SET_UP);
        const text = alert.textContent;
        expect(text.indexOf("The company's email is not set up.")).toBeLessThan(text.indexOf(NOT_SET_UP));
    });

    it('offers Fix recipient and resend, Resend and Void, in that order, and not Correct or Remind', () => {
        renderDialog(failedOpen(), fixProps());
        expect(footerActions(screen.getByRole('dialog'))).toEqual(['Fix recipient and resend', 'Resend', 'Void']);
    });

    it('keeps Resend the Remind it is: the same handler, busy the same way', () => {
        const props = fixProps();
        const document = failedOpen();
        const { rerender } = renderDialog(document, props);
        fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
        expect(props.onRemind).toHaveBeenCalledWith(document);

        rerenderWith(rerender, document, { ...props, reminding: true });
        expect(screen.getByRole('button', { name: /Resend/ })).toBeDisabled();
    });

    it('treats a failed text the same way', () => {
        renderDialog(makeDoc({ sendSms: true, deliveryMethod: 'sms', smsStatus: 'failed', smsError: 'SMS integration is disabled for this company.' }), fixProps());
        expect(screen.getByRole('alert')).toHaveTextContent("The company's text messaging is not set up.");
        expect(footerActions(screen.getByRole('dialog'))).toEqual(['Fix recipient and resend', 'Resend', 'Void']);
    });

    it.each([
        ['signed', { status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' }],
        ['voided', { status: 'voided' }],
        ['being sealed', { status: 'pending_seal' }],
        ['whose seal failed', { status: 'error_sealing' }],
    ])('offers none of the three, and no Void, on a document %s', (_label, overrides) => {
        renderDialog(failedOpen(overrides), fixProps());
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('button', { name: /Fix recipient|Resend|^Void$/ })).not.toBeInTheDocument();
        // The reason is still told, without telling the user to do what is not offered.
        expect(within(dialog).getByRole('alert')).toHaveTextContent("The company's email is not set up.");
        expect(within(dialog).getByRole('alert')).not.toHaveTextContent('then press Resend');
    });

    it('keeps Retry seal for a seal that failed', () => {
        renderDialog(makeDoc({ status: 'error_sealing', errorLog: 'Failed (artificial)' }), { ...fixProps(), onRetrySeal: vi.fn() });
        expect(screen.getByRole('button', { name: 'Retry seal' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Void' })).not.toBeInTheDocument();
    });

    it('keeps Correct and Remind for an open document whose send did not fail', () => {
        renderDialog(makeDoc({ sendEmail: true }), fixProps());
        expect(footerActions(screen.getByRole('dialog'))).toEqual(['Correct', 'Void', 'Remind']);
    });

    it('keeps Correct where fixing in place is not offered', () => {
        renderDialog(failedOpen(), { onRemind: vi.fn() });
        expect(footerActions(screen.getByRole('dialog'))).toEqual(['Correct', 'Resend', 'Void']);
    });

    describe('Fix recipient and resend', () => {
        const openForm = (document = failedOpen(), props = fixProps()) => {
            const view = renderDialog(document, props);
            fireEvent.click(screen.getByRole('button', { name: 'Fix recipient and resend' }));
            return { props, ...view };
        };

        it('opens a short form in the dialog, filled in from the document, with focus on the name', () => {
            openForm(failedOpen({ deliveryMethod: 'both', sendSms: true }));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByLabelText(/^Name/)).toHaveValue('Pat Example');
            expect(within(dialog).getByLabelText(/^Name/)).toHaveFocus();
            expect(within(dialog).getByLabelText(/^Email/)).toHaveValue('pat@example.test');
            expect(within(dialog).getByLabelText(/^Phone/)).toHaveValue('555-0142');
            expect(within(dialog).getByRole('button', { name: 'Email + SMS' })).toHaveAttribute('aria-pressed', 'true');
            // The other actions wait until the form is saved or cancelled.
            expect(within(dialog).queryByRole('button', { name: /^(Resend|Void|Copy Link)$/ })).not.toBeInTheDocument();
        });

        it('starts at the channels the request is sent by, whatever its delivery method says', () => {
            // The server sends by `sendEmail` and `sendSms`: an email switched off stays off.
            openForm(makeDoc({
                deliveryMethod: 'both', sendEmail: false, sendSms: true, smsStatus: 'failed', smsError: 'SMS integration is disabled for this company.',
            }));
            const dialog = screen.getByRole('dialog');
            expect(within(dialog).getByRole('button', { name: 'SMS' })).toHaveAttribute('aria-pressed', 'true');
            expect(within(dialog).getByRole('button', { name: 'Email + SMS' })).toHaveAttribute('aria-pressed', 'false');
        });

        it('reads the delivery method only for a request that records no channel', () => {
            openForm(failedOpen({ sendEmail: undefined, deliveryMethod: 'both' }));
            expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Email + SMS' })).toHaveAttribute('aria-pressed', 'true');
        });

        it('asks for a usable email address before saving when the link goes by email', () => {
            const { props } = openForm();
            const dialog = screen.getByRole('dialog');
            fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'not-an-email' } });
            fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

            expect(props.onFixRecipient).not.toHaveBeenCalled();
            expect(within(dialog).getByText('Enter a full email address, such as name@example.com, or send by SMS.')).toBeInTheDocument();
            expect(within(dialog).getByLabelText(/^Email/)).toHaveValue('not-an-email');
        });

        // The server's sender refuses each of these (`functions/shared/isValidEmail.js`).
        it.each(['pat@aol..com', 'josé@example.test', 'pat@ex_ample.test', 'pat@example.test.'])(
            'asks again for %j, an address the server would not send to',
            (email) => {
                const { props } = openForm();
                const dialog = screen.getByRole('dialog');
                fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: email } });
                fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

                expect(props.onFixRecipient).not.toHaveBeenCalled();
                expect(within(dialog).getByText('Enter a full email address, such as name@example.com, or send by SMS.')).toBeInTheDocument();
            },
        );

        it('does not check the email of a correction that sends by SMS only', () => {
            const { props } = openForm();
            const dialog = screen.getByRole('dialog');
            fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: '' } });
            fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '555-0199' } });
            fireEvent.click(within(dialog).getByRole('button', { name: 'SMS' }));
            fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

            expect(props.onFixRecipient).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ recipientEmail: '', deliveryMethod: 'sms' }));
        });

        it('saves the edited recipient and channels for this document', () => {
            const document = failedOpen();
            const { props } = openForm(document);
            const dialog = screen.getByRole('dialog');

            fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: ' pat.new@example.test ' } });
            fireEvent.change(within(dialog).getByLabelText(/^Phone/), { target: { value: '555-0199' } });
            fireEvent.click(within(dialog).getByRole('button', { name: 'Email + SMS' }));
            fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

            expect(props.onFixRecipient).toHaveBeenCalledTimes(1);
            expect(props.onFixRecipient).toHaveBeenCalledWith(document, {
                recipientName: 'Pat Example',
                recipientEmail: 'pat.new@example.test',
                recipientPhone: '555-0199',
                deliveryMethod: 'both',
            });
        });

        it('says to use Resend when nothing changed, and saves nothing', () => {
            const { props } = openForm();
            fireEvent.click(screen.getByRole('button', { name: 'Save and resend' }));
            expect(props.onFixRecipient).not.toHaveBeenCalled();
            expect(within(screen.getByRole('dialog')).getByText('Nothing changed. To send the link again to the same details, use Resend.')).toBeInTheDocument();
        });

        it('goes back to the actions on Cancel, with focus on the button that opened it', () => {
            const { props } = openForm();
            fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
            expect(props.onFixRecipient).not.toHaveBeenCalled();
            expect(screen.queryByLabelText(/^Name/)).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Fix recipient and resend' })).toHaveFocus();
        });

        it('is busy, and cannot be saved again or cancelled, while the correction is saved', () => {
            const document = failedOpen();
            const { props, rerender } = openForm(document);
            rerenderWith(rerender, document, { ...props, fixingRecipient: true });
            expect(screen.getByRole('button', { name: /Save and resend/ })).toBeDisabled();
            expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        });

        it('has no accessibility violations with the reason, the actions and the form', async () => {
            const view = renderDialog(failedOpen(), fixProps());
            expect((await axe(view.container)).violations).toEqual([]);
            fireEvent.click(screen.getByRole('button', { name: 'Fix recipient and resend' }));
            expect((await axe(view.container)).violations).toEqual([]);
        });
    });
});

describe('SentDocumentDetailsDialog — who voided it', () => {
    it('says when a voided document was voided, and by whom', () => {
        renderDialog(makeDoc({ status: 'voided', voidedAt: { seconds: 1700500000 }, voidedBy: 'user-1', voidedByName: 'Dana Admin' }));
        // The row's label, not the status badge, which reads Voided too.
        const row = within(screen.getByRole('dialog')).getByText('Voided', { selector: 'dt' }).closest('div');
        expect(row).toHaveTextContent(`${formatDate(new Date(1700500000 * 1000))} by Dana Admin`);
    });

    it('keeps the delivery error a voided document recorded', () => {
        renderDialog(makeDoc({ status: 'voided', emailStatus: 'failed', emailError: 'Mailbox unavailable' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Mailbox unavailable');
    });
});

describe('SentDocumentDetailsDialog — a text not sent to an opted-out number', () => {
    it('says so as a note, not as a failure, when the email went', () => {
        renderDialog(makeDoc({
            sendEmail: true,
            sendSms: true,
            deliveryMethod: 'both',
            emailStatus: 'sent',
            smsStatus: 'skipped',
            // Where the sender records why (`functions/notifySignerSMS.js`).
            smsNote: 'Not texted: this number opted out of texts.',
        }));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
        const row = within(dialog).getByText('Text message').closest('div');
        expect(row).toHaveTextContent('Not sent: this number opted out of text messages.');
    });
});
