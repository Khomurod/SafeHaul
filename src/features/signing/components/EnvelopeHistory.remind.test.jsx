// EnvelopeHistory: "Link expired" and "Remind". A document waiting for its
// signer whose link ran out says so in its row, which offers Review (its details)
// instead of copying a link that no longer works. The details dialog offers
// Remind for a document that went by email or text, which asks `remindSigner`
// for that document once and says what went. All fixtures are artificial (see
// the support's PRIVACY note).
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
    callables,
    fnMocks,
    openDetails,
    toast,
} from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);
const DAY_S = 24 * 60 * 60;
const nowS = () => Math.floor(Date.now() / 1000);

const expired = (overrides = {}) => makeDoc({ expiresAt: { seconds: nowS() - 2 * DAY_S }, ...overrides });
const live = (overrides = {}) => makeDoc({ expiresAt: { seconds: nowS() + 3 * DAY_S }, ...overrides });
const rowOf = (title = 'Offer Letter') => screen.getByRole('row', { name: `Details for ${title}` });

async function openReview() {
    fireEvent.click(screen.getByRole('button', { name: 'Review details for Offer Letter' }));
    return screen.findByRole('dialog', { name: 'Offer Letter' });
}

beforeEach(resetHarness);
afterEach(restoreHarness);

describe('EnvelopeHistory — Link expired', () => {
    it('says so in the row, and offers Review instead of a link that no longer works', () => {
        renderHistory();
        emit([expired()]);

        const row = rowOf();
        expect(within(row).getByText('Link expired')).toBeInTheDocument();
        expect(within(row).queryByText('Sent')).not.toBeInTheDocument();
        expect(within(row).queryByRole('button', { name: 'Link for Offer Letter' })).not.toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'Review details for Offer Letter' })).toBeInTheDocument();
    });

    it('leaves a link that still works as Sent, with Copy link', () => {
        renderHistory();
        emit([live()]);

        const row = rowOf();
        expect(within(row).getByText('Sent')).toBeInTheDocument();
        expect(within(row).queryByText('Link expired')).not.toBeInTheDocument();
        expect(within(row).getByRole('button', { name: 'Link for Offer Letter' })).toBeInTheDocument();
    });

    it('keeps a failed delivery as Delivery Failed after its link ran out too', () => {
        renderHistory();
        emit([expired({ emailStatus: 'failed', emailError: 'SMTP 550 (artificial)' })]);

        expect(within(rowOf()).getByText('Delivery Failed')).toBeInTheDocument();
        expect(within(rowOf()).queryByText('Link expired')).not.toBeInTheDocument();
    });

    it('is never said of a signed document', () => {
        renderHistory();
        emit([expired({ status: 'signed' })]);

        expect(within(rowOf()).getByText('Signed')).toBeInTheDocument();
        expect(within(rowOf()).queryByText('Link expired')).not.toBeInTheDocument();
    });
});

describe('EnvelopeHistory — Remind', () => {
    it('asks the server for this document only, says what went, and closes', async () => {
        renderHistory();
        emit([expired()]);
        const dialog = await openReview();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Remind' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(fnMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'remindSigner');
        expect(callables.remindSigner).toHaveBeenCalledTimes(1);
        expect(callables.remindSigner).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1' });
        expect(toast.showSuccess).toHaveBeenCalledWith('Reminder sent by email. The link works for seven more days.');
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it('asks once however often it is pressed while the first is on its way', async () => {
        let answer;
        callables.remindSigner.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        renderHistory();
        emit([expired()]);
        const dialog = await openReview();

        const remind = within(dialog).getByRole('button', { name: 'Remind' });
        fireEvent.click(remind);
        fireEvent.click(remind);
        await waitFor(() => expect(within(dialog).getByRole('button', { name: /Remind/ })).toBeDisabled());
        expect(callables.remindSigner).toHaveBeenCalledTimes(1);

        answer({ data: { success: true, requestId: 'req-1', channels: { email: true, sms: false } } });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows the server\'s refusal as it worded it, and stays open', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const message = 'A reminder was sent less than ten minutes ago. You can send another in 6 minutes.';
        callables.remindSigner.mockRejectedValue(Object.assign(new Error(message), { code: 'functions/failed-precondition' }));
        renderHistory();
        emit([expired()]);
        const dialog = await openReview();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Remind' }));

        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith(message));
        expect(screen.getByRole('dialog', { name: 'Offer Letter' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Remind' })).toBeEnabled();
        expect(toast.showSuccess).not.toHaveBeenCalled();
    });

    it('says plainly when the reminder could not be sent, and closes, so the list shows why', async () => {
        callables.remindSigner.mockResolvedValue({
            data: { success: true, requestId: 'req-1', channels: { email: false, sms: false }, failed: { email: true, sms: false } },
        });
        renderHistory();
        emit([expired()]);
        const dialog = await openReview();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Remind' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(toast.showError).toHaveBeenCalledWith('The reminder could not be sent by email. The document\'s details say why.');
        expect(toast.showSuccess).not.toHaveBeenCalled();
    });

    it('is offered in the details of a document whose link still works', async () => {
        renderHistory();
        emit([live()]);

        const dialog = await openDetails();
        expect(within(dialog).getByRole('button', { name: 'Remind' })).toBeInTheDocument();
    });

    it('is not offered for a document shared by a copied link', async () => {
        renderHistory();
        emit([expired({ sendEmail: false, sendSms: false, deliveryMethod: 'copy' })]);

        const dialog = await openReview();
        expect(within(dialog).queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument();
    });
});
