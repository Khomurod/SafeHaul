// EnvelopeHistory: "Retry seal". A document whose seal failed shows Review in
// its row; the details dialog shows why it failed and offers Retry seal, which
// asks `retrySealDocument` for that document once and says what happened. The
// row's status then follows the live list. All fixtures are artificial (see the
// support's PRIVACY note).
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
    toast,
} from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

const failed = (overrides = {}) => makeDoc({
    status: 'error_sealing',
    errorLog: 'Company signature image missing or unreadable: cs1',
    ...overrides,
});

async function openReview() {
    fireEvent.click(screen.getByRole('button', { name: 'Review details for Offer Letter' }));
    return screen.findByRole('dialog', { name: 'Offer Letter' });
}

beforeEach(resetHarness);
afterEach(restoreHarness);

describe('EnvelopeHistory — Retry seal', () => {
    it('keeps Review as the row action, and offers Retry seal beside the reason in its details', async () => {
        renderHistory();
        emit([failed()]);

        expect(screen.queryByRole('button', { name: /Retry seal/ })).not.toBeInTheDocument();
        const dialog = await openReview();
        expect(within(dialog).getByRole('alert')).toHaveTextContent('Company signature image missing or unreadable: cs1');
        expect(within(dialog).getByRole('button', { name: 'Retry seal' })).toBeInTheDocument();
    });

    it('asks the server for this document only, says it is sealing again, and closes', async () => {
        renderHistory();
        emit([failed()]);
        const dialog = await openReview();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Retry seal' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(fnMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'retrySealDocument');
        expect(callables.retrySealDocument).toHaveBeenCalledTimes(1);
        expect(callables.retrySealDocument).toHaveBeenCalledWith({ companyId: 'co-1', requestId: 'req-1' });
        expect(toast.showSuccess).toHaveBeenCalledWith('Sealing again. The status here changes when it finishes.');
        expect(toast.showError).not.toHaveBeenCalled();
    });

    it('asks once however often it is pressed while the first is on its way', async () => {
        let answer;
        callables.retrySealDocument.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
        renderHistory();
        emit([failed()]);
        const dialog = await openReview();

        const retry = within(dialog).getByRole('button', { name: 'Retry seal' });
        fireEvent.click(retry);
        fireEvent.click(retry);
        await waitFor(() => expect(within(dialog).getByRole('button', { name: /Retry seal/ })).toBeDisabled());
        expect(callables.retrySealDocument).toHaveBeenCalledTimes(1);

        answer({ data: { success: true, status: 'pending_seal', attempt: 1 } });
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('shows the server\'s refusal as it worded it, and stays open', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        callables.retrySealDocument.mockRejectedValue(Object.assign(
            new Error('This document is already signed and sealed.'),
            { code: 'functions/failed-precondition' },
        ));
        renderHistory();
        emit([failed()]);
        const dialog = await openReview();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Retry seal' }));

        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('This document is already signed and sealed.'));
        expect(screen.getByRole('dialog', { name: 'Offer Letter' })).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Retry seal' })).toBeEnabled();
        expect(toast.showSuccess).not.toHaveBeenCalled();
    });

    it('offers it for a document left sealing for more than ten minutes', async () => {
        const signedAt = { seconds: Math.floor((Date.now() - 11 * 60 * 1000) / 1000) };
        renderHistory();
        emit([makeDoc({ status: 'pending_seal', signedAt })]);

        fireEvent.click(screen.getByRole('button', { name: 'View details for Offer Letter' }));
        const dialog = await screen.findByRole('dialog', { name: 'Offer Letter' });
        expect(within(dialog).getByText('Sealing did not finish')).toBeInTheDocument();
        expect(within(dialog).getByRole('button', { name: 'Retry seal' })).toBeInTheDocument();
    });
});
