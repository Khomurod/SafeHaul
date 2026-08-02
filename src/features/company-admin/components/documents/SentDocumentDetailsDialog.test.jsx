// Sent-document details dialog. With the table now showing a single quick
// action per row, this dialog is the complete home for document information
// and every permitted secondary action, so its status→action contract gets its
// own coverage. All fixtures are artificial (RFC 2606 domains, reserved
// 555-01xx numbers); no real signing token or link is ever rendered.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    expiresAt: { seconds: 1702592000 },
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
        expect(alert).toHaveTextContent('Delivery error');
        expect(alert).toHaveTextContent('SMTP 550 mailbox unavailable (artificial)');
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
