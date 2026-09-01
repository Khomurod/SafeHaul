// EnvelopeHistory contract, part 2 of 3: row activation, the details dialog's
// actions, and the void flow.
// The shared harness — mock state, factories, fixtures, snapshot emitters and
// helpers — lives in `EnvelopeHistory.support.jsx`; the registrations below
// delegate to it. All fixtures are artificial (see the support's PRIVACY note).
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
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
    fs,
    callables,
    fnMocks,
    toast,
    SIGNING_LINK,
    DOC_URL,
} from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

beforeEach(resetHarness);

afterEach(restoreHarness);

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

