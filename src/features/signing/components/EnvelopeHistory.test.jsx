import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// PRIVACY: recipient names, emails, phone numbers, signing links and document
// URLs are sensitive. Every fixture below is artificial — reserved example
// domains (RFC 2606) and fictional 555-01xx numbers (NANP reserved range). No
// real signing link or document URL is ever asserted, logged or snapshotted.
const fs = vi.hoisted(() => ({
    collection: vi.fn((_db, ...segments) => ({ __path: segments.join('/') })),
    query: vi.fn((ref, ...constraints) => ({ ref, constraints })),
    orderBy: vi.fn((field, dir) => ({ __orderBy: [field, dir] })),
    onSnapshot: vi.fn(),
    doc: vi.fn((_db, ...segments) => ({ __docPath: segments.join('/') })),
    updateDoc: vi.fn(),
    serverTimestamp: vi.fn(() => '__serverTimestamp__'),
}));
const callables = vi.hoisted(() => ({ getSigningLink: vi.fn(), getSignedDocumentUrl: vi.fn() }));
const fnMocks = vi.hoisted(() => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn((_fns, name) => callables[name]),
}));
const toast = vi.hoisted(() => ({ showSuccess: vi.fn(), showError: vi.fn() }));

vi.mock('firebase/firestore', () => fs);
vi.mock('firebase/functions', () => fnMocks);
vi.mock('@lib/firebase', () => ({ db: {} }));
vi.mock('@shared/components/feedback', () => ({ useToast: () => toast }));

import EnvelopeHistory from './EnvelopeHistory';

let snapshotCb;
let errorCb;
let unsubSpy;

const SIGNING_LINK = 'https://sign.example.test/artificial-token';
const DOC_URL = 'https://files.example.test/artificial-signed.pdf';

function makeDoc(overrides = {}) {
    return {
        id: 'req-1',
        title: 'Offer Letter',
        recipientName: 'Pat Example',
        recipientEmail: 'pat@example.test',
        status: 'sent',
        sendEmail: true,
        createdAt: { seconds: 1700000000 },
        ...overrides,
    };
}

// Snapshot callbacks originate outside React, so they must be flushed in act().
function emit(docsArray) {
    React.act(() => {
        snapshotCb({
            docs: docsArray.map((d) => ({
                id: d.id,
                // Firestore's data() excludes the document id.
                data: () => Object.fromEntries(Object.entries(d).filter(([key]) => key !== 'id')),
            })),
        });
    });
}

function emitError(err) {
    React.act(() => { errorCb(err); });
}

function renderHistory(props = {}) {
    const onCorrect = props.onCorrect;
    // `companyId` is only omitted when the key is explicitly absent, so a test
    // can pass `companyId: undefined` to exercise the no-subscription guard.
    const companyId = 'companyId' in props ? props.companyId : 'co-1';
    const utils = render(<EnvelopeHistory companyId={companyId} onCorrect={onCorrect} />);
    return { onCorrect, ...utils };
}

/** Activates a row (the generic details action) and returns its details dialog. */
async function openDetails(rowName = 'Details for Offer Letter') {
    fireEvent.click(screen.getByRole('row', { name: rowName }));
    return screen.findByRole('dialog');
}

beforeEach(() => {
    vi.clearAllMocks();
    unsubSpy = vi.fn();
    snapshotCb = undefined;
    errorCb = undefined;
    fs.onSnapshot.mockImplementation((q, onNext, onError) => {
        snapshotCb = onNext;
        errorCb = onError;
        return unsubSpy;
    });
    callables.getSigningLink.mockResolvedValue({ data: { signingLink: SIGNING_LINK } });
    callables.getSignedDocumentUrl.mockResolvedValue({ data: { url: DOC_URL } });
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: vi.fn().mockResolvedValue() },
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('EnvelopeHistory — subscription', () => {
    it('does not subscribe without a companyId', () => {
        renderHistory({ companyId: undefined });
        expect(fs.onSnapshot).not.toHaveBeenCalled();
        expect(fs.collection).not.toHaveBeenCalled();
    });

    it('subscribes to the exact ordered signing_requests query and unsubscribes on unmount', () => {
        const { unmount } = renderHistory();
        expect(fs.collection).toHaveBeenCalledWith({}, 'companies', 'co-1', 'signing_requests');
        expect(fs.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
        expect(fs.onSnapshot).toHaveBeenCalledTimes(1);
        unmount();
        expect(unsubSpy).toHaveBeenCalledTimes(1);
    });

    it('announces loading before the first snapshot', () => {
        renderHistory();
        expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
        expect(screen.getByText('Loading document history')).toBeInTheDocument();
    });

    it('maps snapshot docs id-preservingly', () => {
        renderHistory();
        emit([makeDoc({ id: 'req-9', title: 'Policy Ack' })]);
        expect(screen.getByText('Policy Ack')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Link for Policy Ack' })).toBeInTheDocument();
    });

    it('shows the exact empty message when there are no documents', () => {
        renderHistory();
        emit([]);
        expect(screen.getByText('No documents sent yet.')).toBeInTheDocument();
    });

    it('surfaces a snapshot failure as an accessible alert', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        renderHistory();
        emitError(new Error('permission-denied'));
        const alert = screen.getByRole('alert');
        expect(alert).toHaveTextContent(/Could not load document history/);
        expect(consoleError).toHaveBeenCalled();
        consoleError.mockRestore();
    });
});

describe('EnvelopeHistory — status presentation', () => {
    it.each([
        ['signed', 'Signed', 'success'],
        ['sent', 'Sent', 'info'],
        ['voided', 'Voided', 'danger'],
        ['pending_seal', 'Sealing...', 'warning'],
        ['error_sealing', 'Seal Failed', 'danger'],
        ['processing', 'Processing', 'warning'],
    ])('maps %s to "%s" with tone %s and text (never colour-only)', (status, label, tone) => {
        renderHistory();
        emit([makeDoc({ status })]);
        const badge = screen.getByText(label);
        expect(badge.closest('.ds-badge')).toHaveAttribute('data-tone', tone);
    });

    it('falls back to the raw status text for an unknown status', () => {
        renderHistory();
        emit([makeDoc({ status: 'archived_by_admin' })]);
        expect(screen.getByText('archived_by_admin')).toBeInTheDocument();
    });

    it('lets an email failure override the document status', () => {
        renderHistory();
        emit([makeDoc({ status: 'sent', emailStatus: 'failed', emailError: 'SMTP 550 rejected' })]);
        expect(screen.getByText('Delivery Failed')).toBeInTheDocument();
        expect(screen.queryByText('Sent')).not.toBeInTheDocument();
        expect(screen.getByText('SMTP 550 rejected')).toBeInTheDocument();
    });

    it('truncates an email error after 80 characters with an ellipsis', () => {
        renderHistory();
        const longError = 'E'.repeat(120);
        emit([makeDoc({ emailStatus: 'failed', emailError: longError })]);
        expect(screen.getByText(`${'E'.repeat(80)}…`)).toBeInTheDocument();
    });

    it('keeps an 80-character error untruncated', () => {
        renderHistory();
        emit([makeDoc({ emailStatus: 'failed', emailError: 'E'.repeat(80) })]);
        expect(screen.getByText('E'.repeat(80))).toBeInTheDocument();
    });

    it('uses the exact fallback when the failure carries no detail', () => {
        renderHistory();
        emit([makeDoc({ emailStatus: 'failed' })]);
        expect(screen.getByText('Email delivery failed')).toBeInTheDocument();
    });
});

describe('EnvelopeHistory — delivery method and fallbacks', () => {
    it('shows Email and SMS badges together when both are set', () => {
        renderHistory();
        emit([makeDoc({ sendEmail: true, sendSms: true })]);
        expect(screen.getByText('Email')).toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
        expect(screen.queryByText('Manual')).not.toBeInTheDocument();
    });

    it('shows Manual only when sendEmail is false and sendSms is not true', () => {
        renderHistory();
        emit([makeDoc({ sendEmail: false, sendSms: false })]);
        expect(screen.getByText('Manual')).toBeInTheDocument();
        expect(screen.queryByText('Email')).not.toBeInTheDocument();
    });

    it('does not show Manual when sendSms is true', () => {
        renderHistory();
        emit([makeDoc({ sendEmail: false, sendSms: true })]);
        expect(screen.queryByText('Manual')).not.toBeInTheDocument();
        expect(screen.getByText('SMS')).toBeInTheDocument();
    });

    it('falls back to Untitled, plain contact-missing wording, and -- for a missing date', () => {
        renderHistory();
        emit([makeDoc({ title: undefined, recipientEmail: undefined, recipientPhone: undefined, createdAt: undefined })]);
        expect(screen.getByText('Untitled')).toBeInTheDocument();
        // A bare dash reads as an accident; the fallback says what is missing.
        expect(screen.getByText('No email or phone')).toBeInTheDocument();
        expect(screen.getByText('--')).toBeInTheDocument();
    });

    it('falls back to the phone number when there is no email', () => {
        renderHistory();
        emit([makeDoc({ recipientEmail: undefined, recipientPhone: '555-0142' })]);
        expect(screen.getByText('555-0142')).toBeInTheDocument();
    });

    it('renders the date from createdAt.seconds', () => {
        renderHistory();
        emit([makeDoc({ createdAt: { seconds: 1700000000 } })]);
        expect(screen.getByText(new Date(1700000000 * 1000).toLocaleDateString())).toBeInTheDocument();
    });
});

describe('EnvelopeHistory — title presentation', () => {
    it('clamps a long title to two lines while exposing the full text', () => {
        const longTitle = `Extremely long artificial onboarding packet filename ${'x'.repeat(120)}.pdf`;
        renderHistory();
        emit([makeDoc({ title: longTitle })]);
        const clamped = screen.getByText(longTitle);
        expect(clamped.className).toContain('line-clamp-2');
        // The full stored title stays reachable through the cell tooltip.
        expect(clamped.closest('[title]')).toHaveAttribute('title', longTitle);
    });
});

describe('EnvelopeHistory — quick action hierarchy', () => {
    it('offers Download as the only row action for a signed document', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'signed' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Download Offer Letter');
    });

    it('offers Copy Link as the only row action for a sent document', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'sent' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Link for Offer Letter');
        // Correct and Void no longer sit in every row; they live in the details dialog.
        expect(screen.queryByRole('button', { name: 'Correct Offer Letter' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Void Offer Letter' })).not.toBeInTheDocument();
    });

    it('offers Review details as the only row action for a delivery failure', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'sent', emailStatus: 'failed', emailError: 'SMTP 550 rejected' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        const buttons = within(row).getAllByRole('button');
        expect(buttons).toHaveLength(1);
        expect(buttons[0]).toHaveAccessibleName('Review details for Offer Letter');
    });

    it('offers Review details as the only row action for a sealing failure', () => {
        renderHistory();
        emit([makeDoc({ status: 'error_sealing' })]);
        expect(screen.getByRole('button', { name: 'Review details for Offer Letter' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Link for|Download|Void|Correct/ })).not.toBeInTheDocument();
    });

    it.each(['processing', 'pending_seal', 'voided', 'archived_by_admin'])(
        'offers View details as the only row action for a %s document',
        (status) => {
            renderHistory({ onCorrect: vi.fn() });
            emit([makeDoc({ status })]);
            const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
            const buttons = within(row).getAllByRole('button');
            expect(buttons).toHaveLength(1);
            expect(buttons[0]).toHaveAccessibleName('View details for Offer Letter');
        },
    );

    it('offsets the Actions heading and quick action toward the table edge together', () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        // Both carry the same -mr-ds-4: it compensates the scrollbar gutter +
        // shared cell padding on the table's right edge, and the heading must
        // keep the exact offset of the buttons below it or they drift apart.
        const header = screen.getByRole('columnheader', { name: 'Actions' });
        expect(header.querySelector('span')).toHaveClass('-mr-ds-4');
        const quickAction = screen.getByRole('button', { name: 'Link for Offer Letter' });
        expect(quickAction.parentElement).toHaveClass('-mr-ds-4', 'justify-end');
    });

    it('never renders more than one action control in an ordinary row', () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([
            makeDoc({ id: 'a', status: 'sent' }),
            makeDoc({ id: 'b', title: 'Signed Doc', status: 'signed' }),
            makeDoc({ id: 'c', title: 'Voided Doc', status: 'voided' }),
        ]);
        for (const name of ['Details for Offer Letter', 'Details for Signed Doc', 'Details for Voided Doc']) {
            expect(within(screen.getByRole('row', { name })).getAllByRole('button')).toHaveLength(1);
        }
    });
});

describe('EnvelopeHistory — row details activation', () => {
    it('opens the details dialog when the row is clicked', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        const dialog = await openDetails();
        expect(dialog).toHaveAccessibleName('Offer Letter');
    });

    it('opens the details dialog from the keyboard with Enter and Space', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        expect(row).toHaveAttribute('tabindex', '0');

        fireEvent.keyDown(row, { key: 'Enter' });
        let dialog = await screen.findByRole('dialog');
        // The dialog has a footer Close and an icon Close; either dismisses it.
        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        fireEvent.keyDown(row, { key: ' ' });
        dialog = await screen.findByRole('dialog');
        expect(dialog).toHaveAccessibleName('Offer Letter');
    });

    it('restores focus to the row after the details dialog closes', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        const row = screen.getByRole('row', { name: 'Details for Offer Letter' });
        row.focus();
        fireEvent.keyDown(row, { key: 'Enter' });
        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' })[0]);
        await waitFor(() => expect(row).toHaveFocus());
    });

    it('row activation opens details without triggering any quick action', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        await openDetails();
        expect(callables.getSigningLink).not.toHaveBeenCalled();
        expect(callables.getSignedDocumentUrl).not.toHaveBeenCalled();
        expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('quick-action activation never opens the row details', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(callables.getSigningLink).toHaveBeenCalled());
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('EnvelopeHistory — details dialog actions', () => {
    it('Copy Link in the dialog calls getSigningLink with the exact payload', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        const dialog = await openDetails();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Copy Link' }));

        await waitFor(() => expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'getSigningLink'));
        expect(callables.getSigningLink).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1' });
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SIGNING_LINK));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Full signing link copied to clipboard!'));
    });

    it('Correct in the dialog passes the exact document and closes the dialog', async () => {
        const onCorrect = vi.fn();
        renderHistory({ onCorrect });
        emit([makeDoc({ status: 'sent' })]);
        const dialog = await openDetails();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Correct' }));

        expect(onCorrect).toHaveBeenCalledTimes(1);
        expect(onCorrect.mock.calls[0][0]).toMatchObject({ id: 'req-1', title: 'Offer Letter', status: 'sent' });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('hides Correct in the dialog when no onCorrect handler is supplied', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        const dialog = await openDetails();
        expect(within(dialog).queryByRole('button', { name: 'Correct' })).not.toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Void' })).toBeInTheDocument();
    });

    it('Download in the dialog uses the exact existing download contract', async () => {
        const openSpy = vi.fn();
        vi.stubGlobal('open', openSpy);
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);
        const dialog = await openDetails();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));

        await waitFor(() => {
            expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/signed/artificial.pdf' });
        });
        await waitFor(() => expect(openSpy).toHaveBeenCalledWith(DOC_URL, '_blank'));
    });

    it('keeps a voided document read-only in the dialog', async () => {
        renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'voided' })]);
        const dialog = await openDetails();
        expect(within(dialog).queryByRole('button', { name: /Copy Link|Correct|Void|Download/ })).not.toBeInTheDocument();
    });
});

describe('EnvelopeHistory — void action', () => {
    /** Opens the details dialog, requests the void, and returns the confirmation. */
    async function openVoidConfirmation(rowName = 'Details for Offer Letter') {
        const details = await openDetails(rowName);
        fireEvent.click(within(details).getByRole('button', { name: 'Void' }));
        return screen.findByRole('dialog', { name: /^Void / });
    }

    it('writes the exact update after the exact confirmation and reports success', async () => {
        const confirmMock = vi.fn(() => true);
        vi.stubGlobal('confirm', confirmMock);
        fs.updateDoc.mockResolvedValue();
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        const dialog = await openVoidConfirmation();
        // The blocking prompt is gone; the dialog names the envelope and warns.
        expect(dialog).toHaveAccessibleName('Void "Offer Letter"?');
        expect(dialog).toHaveTextContent(/cannot be undone/i);
        expect(confirmMock).not.toHaveBeenCalled();
        expect(fs.updateDoc).not.toHaveBeenCalled();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Void document' }));

        await waitFor(() => expect(fs.updateDoc).toHaveBeenCalledTimes(1));
        expect(fs.doc).toHaveBeenCalledWith({}, 'companies', 'co-1', 'signing_requests', 'req-1');
        expect(fs.updateDoc.mock.calls[0][1]).toEqual({ status: 'voided', voidedAt: '__serverTimestamp__' });
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Document voided successfully.'));
    });

    it('uses the this-document fallback in the confirmation when untitled', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent', title: undefined })]);

        const dialog = await openVoidConfirmation('Details for Untitled');
        expect(dialog).toHaveAccessibleName('Void "this document"?');
    });

    it('does not void when the confirmation is cancelled or dismissed', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        let dialog = await openVoidConfirmation();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Keep document' }));
        expect(fs.updateDoc).not.toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        dialog = await openVoidConfirmation();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('voids once even when confirmed twice in the same tick', async () => {
        let resolveVoid;
        fs.updateDoc.mockReturnValue(new Promise((resolve) => { resolveVoid = resolve; }));
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        const dialog = await openVoidConfirmation();
        const confirm = within(dialog).getByRole('button', { name: 'Void document' });
        fireEvent.click(confirm);
        fireEvent.click(confirm);

        expect(fs.updateDoc).toHaveBeenCalledTimes(1);
        await React.act(async () => { resolveVoid(); });
    });

    it('reports a void failure with the exact message', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        fs.updateDoc.mockRejectedValueOnce(new Error('offline'));
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        const dialog = await openVoidConfirmation();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Void document' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Failed to void document.'));
        consoleError.mockRestore();
    });

    it('marks the confirmation busy while the void is in flight', async () => {
        let resolveVoid;
        fs.updateDoc.mockReturnValue(new Promise((resolve) => { resolveVoid = resolve; }));
        renderHistory();
        emit([makeDoc({ status: 'sent' }), makeDoc({ id: 'req-2', title: 'NDA', status: 'sent' })]);

        const dialog = await openVoidConfirmation();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Void document' }));

        await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Void document' })).toBeDisabled());
        expect(within(dialog).getByRole('button', { name: 'Keep document' })).toBeDisabled();
        // The other row stays fully usable while this envelope voids.
        expect(screen.getByRole('button', { name: 'Link for NDA' })).toBeEnabled();

        await React.act(async () => { resolveVoid(); });
    });
});

describe('EnvelopeHistory — copy link action', () => {
    it('calls getSigningLink with the exact payload and copies the result', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));

        await waitFor(() => expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'getSigningLink'));
        expect(callables.getSigningLink).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1' });
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(SIGNING_LINK));
        await waitFor(() => expect(toast.showSuccess).toHaveBeenCalledWith('Full signing link copied to clipboard!'));
    });

    it('surfaces the callable error message, falling back when absent', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.getSigningLink.mockRejectedValueOnce(new Error('permission denied'));
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('permission denied'));

        toast.showError.mockClear();
        const bare = new Error();
        bare.message = '';
        callables.getSigningLink.mockRejectedValueOnce(bare);
        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Could not retrieve signing link.'));
        consoleError.mockRestore();
    });

    it('shows a busy state on the copying row only', async () => {
        let resolveLink;
        callables.getSigningLink.mockReturnValue(new Promise((resolve) => { resolveLink = resolve; }));
        renderHistory();
        emit([makeDoc({ status: 'sent' }), makeDoc({ id: 'req-2', title: 'NDA', status: 'sent' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Link for Offer Letter' })).toBeDisabled());
        expect(screen.getByRole('button', { name: 'Link for NDA' })).toBeEnabled();

        await React.act(async () => { resolveLink({ data: { signingLink: SIGNING_LINK } }); });
    });
});

describe('EnvelopeHistory — download action', () => {
    it('calls getSignedDocumentUrl with the raw path and opens the url', async () => {
        const openSpy = vi.fn();
        vi.stubGlobal('open', openSpy);
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));

        await waitFor(() => expect(fnMocks.httpsCallable).toHaveBeenCalledWith({}, 'getSignedDocumentUrl'));
        expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/signed/artificial.pdf' });
        await waitFor(() => expect(openSpy).toHaveBeenCalledWith(DOC_URL, '_blank'));
    });

    it('strips the gs:// bucket prefix before calling the callable', async () => {
        vi.stubGlobal('open', vi.fn());
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'gs://example-bucket.appspot.com/companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => {
            expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/signed/artificial.pdf' });
        });
    });

    it('falls back to storagePath when signedPdfUrl is absent', async () => {
        vi.stubGlobal('open', vi.fn());
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: undefined, storagePath: 'companies/co-1/raw/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => {
            expect(callables.getSignedDocumentUrl).toHaveBeenCalledWith({ storagePath: 'companies/co-1/raw/artificial.pdf' });
        });
    });

    it('maps functions/not-found to its exact message', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const notFound = new Error('missing');
        notFound.code = 'functions/not-found';
        callables.getSignedDocumentUrl.mockRejectedValue(notFound);
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('File not found. It may have been deleted or moved.'));
        consoleError.mockRestore();
    });

    it('maps any other download failure to the generic message', async () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.getSignedDocumentUrl.mockRejectedValue(new Error('network'));
        renderHistory();
        emit([makeDoc({ status: 'signed', signedPdfUrl: 'companies/co-1/signed/artificial.pdf' })]);

        fireEvent.click(screen.getByRole('button', { name: 'Download Offer Letter' }));
        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Could not download file. Please try again.'));
        consoleError.mockRestore();
    });
});

describe('EnvelopeHistory — pagination', () => {
    const manyDocs = (count) => Array.from({ length: count }, (_, index) =>
        makeDoc({ id: `req-${index}`, title: `Doc ${index}`, status: 'sent' }));

    it('shows no pagination for 25 or fewer documents', () => {
        renderHistory();
        emit(manyDocs(25));
        expect(screen.queryByRole('navigation', { name: /pagination/ })).not.toBeInTheDocument();
        // Header row plus every document.
        expect(screen.getAllByRole('row')).toHaveLength(26);
    });

    it('pages beyond 25 documents and announces the visible range', () => {
        renderHistory();
        emit(manyDocs(30));

        expect(screen.getAllByRole('row')).toHaveLength(26);
        expect(screen.getByText('Showing 1–25 of 30 documents')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getAllByRole('row')).toHaveLength(6);
        expect(screen.getByText('Showing 26–30 of 30 documents')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();

        fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
        expect(screen.getByText('Showing 1–25 of 30 documents')).toBeInTheDocument();
    });

    it('clamps the page when a live update shrinks the list', () => {
        renderHistory();
        emit(manyDocs(30));
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Showing 26–30 of 30 documents')).toBeInTheDocument();

        // The live snapshot narrows (a filter change upstream, or deletions):
        // the table must fall back to a page that still exists.
        emit(manyDocs(3));
        expect(screen.getAllByRole('row')).toHaveLength(4);
        expect(screen.queryByRole('navigation', { name: /pagination/ })).not.toBeInTheDocument();
    });

    it('does not resurrect a stale page after the list shrinks and grows again', () => {
        renderHistory();
        emit(manyDocs(30));
        fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
        expect(screen.getByText('Showing 26–30 of 30 documents')).toBeInTheDocument();

        // A filter narrows the list below one page, then is cleared again. The
        // clamp must persist, or the restored list would silently open on page
        // 2 and hide the first 25 documents.
        emit(manyDocs(10));
        emit(manyDocs(30));
        expect(screen.getByText('Showing 1–25 of 30 documents')).toBeInTheDocument();
    });
});

describe('EnvelopeHistory — accessibility', () => {
    it('exposes a labelled, keyboard-focusable horizontal scroll region', () => {
        renderHistory();
        emit([makeDoc()]);
        const region = screen.getByRole('region', { name: /Document history/ });
        expect(region).toHaveAttribute('tabindex', '0');
    });

    it('uses no unsupported 9px or 10px interface text', () => {
        const { container } = renderHistory();
        emit([makeDoc({ emailStatus: 'failed', emailError: 'SMTP 550', sendEmail: true, sendSms: true })]);
        expect(container.innerHTML).not.toMatch(/text-\[9px\]|text-\[10px\]/);
    });

    it('activates a quick action from the keyboard', async () => {
        renderHistory();
        emit([makeDoc({ status: 'sent' })]);

        const link = screen.getByRole('button', { name: 'Link for Offer Letter' });
        link.focus();
        expect(link).toHaveFocus();
        fireEvent.click(link); // Enter/Space on a native button dispatches click
        await waitFor(() => expect(callables.getSigningLink).toHaveBeenCalledTimes(1));
    });

    it('has no accessibility violations across mixed row states', async () => {
        const { container } = renderHistory({ onCorrect: vi.fn() });
        emit([
            makeDoc({ id: 'a', status: 'sent' }),
            makeDoc({ id: 'b', status: 'signed', title: 'Signed Doc' }),
            makeDoc({ id: 'c', status: 'voided', title: 'Voided Doc' }),
            makeDoc({ id: 'd', title: 'Failed Doc', emailStatus: 'failed', emailError: 'SMTP 550 rejected' }),
        ]);
        expect((await axe(container)).violations).toEqual([]);
    });

    it('has no accessibility violations with the details dialog open', async () => {
        const { container } = renderHistory({ onCorrect: vi.fn() });
        emit([makeDoc({ status: 'sent' })]);
        await openDetails();
        expect((await axe(container)).violations).toEqual([]);
    });

    it('does not leak the signing link into the DOM', async () => {
        const { container } = renderHistory();
        emit([makeDoc({ status: 'sent' })]);
        fireEvent.click(screen.getByRole('button', { name: 'Link for Offer Letter' }));
        await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
        expect(container.innerHTML).not.toContain(SIGNING_LINK);
    });
});
