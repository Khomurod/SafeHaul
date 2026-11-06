// EnvelopeHistory: Fix recipient and resend, on an open document whose send
// failed. It saves Correct Document's correction for the recipient alone
// (`correctRecipient`), so the server's correction trigger sends the new link;
// the editor never opens. The shared harness lives in
// `EnvelopeHistory.support.jsx`; every fixture is artificial (see its PRIVACY
// note).
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('./EnvelopeHistory.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeHistory.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvelopeHistory.support')).libFirebaseMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeHistory.support')).feedbackMock());
// The correction itself: what it is given is the contract here, and its own
// suite (`envelopePersistence.correction.test.js`) covers what it writes.
const { correctRecipient, savedAndReported } = vi.hoisted(() => {
    const saved = async ({ showSuccess }) => {
        showSuccess('Document corrected. A new signing link is on its way by Email, and the old one no longer works.');
        return true;
    };
    return { correctRecipient: vi.fn(saved), savedAndReported: saved };
});
vi.mock('@features/signing/utils/envelopePersistence', () => ({ correctRecipient }));

import EnvelopeHistory from './EnvelopeHistory';
import { makeRenderHistory, resetHarness, restoreHarness, makeDoc, emit, openDetails, fs, toast } from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

const failedOpen = (overrides = {}) => makeDoc({
    status: 'sent',
    sendEmail: true,
    deliveryMethod: 'email',
    emailStatus: 'failed',
    emailError: "Failed to send email: Can't send mail - all recipients were rejected: 550 5.1.1 Recipient address rejected: User unknown",
    storagePath: 'secure_documents/co-1/originals/offer.pdf',
    fields: [{ id: 'sig1', type: 'signature', label: 'Signature', pageNumber: 1, xPosition: 10, yPosition: 80, width: 30, height: 6, required: true }],
    ...overrides,
});

/** Opens the form on `rowName`'s dialog, changes the email, and presses Save and resend. */
async function saveNewEmail(rowName = 'Details for Offer Letter') {
    const dialog = await openDetails(rowName);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Fix recipient and resend' }));
    fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'pat.fixed@example.test' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));
    return dialog;
}

beforeEach(() => {
    resetHarness();
    correctRecipient.mockImplementation(savedAndReported);
});

afterEach(restoreHarness);

describe('EnvelopeHistory — Fix recipient and resend', () => {
    it('saves the edited recipient for this request, and only that, then closes', async () => {
        renderHistory({ companyName: 'Artificial Freight Co', onCorrect: vi.fn() });
        emit([failedOpen()]);

        const dialog = await openDetails();
        expect(within(dialog).getByRole('alert')).toHaveTextContent('The email address was refused.');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Fix recipient and resend' }));
        fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'pat.fixed@example.test' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(correctRecipient).toHaveBeenCalledTimes(1);
        const call = correctRecipient.mock.calls[0][0];
        expect(call).toMatchObject({
            companyId: 'co-1',
            companyName: 'Artificial Freight Co',
            requestId: 'req-1',
            recipientName: 'Pat Example',
            recipientEmail: 'pat.fixed@example.test',
            recipientPhone: '',
            deliveryMethod: 'email',
        });
        // The dialog's copy of the fields and title is not written back: the
        // correction reads the request as it is when the write lands.
        expect(call).not.toHaveProperty('fields');
        expect(call).not.toHaveProperty('title');
        expect(toast.showSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Document corrected\./));
        // No Firestore write of its own: the correction is the only one.
        expect(fs.updateDoc).not.toHaveBeenCalled();
        expect(fs.runTransaction).not.toHaveBeenCalled();
    });

    it('keeps the dialog and the form open when the correction is refused', async () => {
        correctRecipient.mockImplementation(async ({ showError }) => {
            showError('This document is no longer waiting for a signature: it was signed, voided or is being signed. The correction was not saved.');
            return false;
        });
        renderHistory();
        emit([failedOpen()]);

        await saveNewEmail();

        await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and resend' })).toBeEnabled());
        expect(toast.showError).toHaveBeenCalledWith(expect.stringMatching(/^This document is no longer waiting for a signature/));
        expect(within(screen.getByRole('dialog')).getByLabelText(/^Email/)).toHaveValue('pat.fixed@example.test');
    });

    it('saves once even when pressed twice in the same tick', async () => {
        let finish;
        correctRecipient.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        renderHistory();
        emit([failedOpen()]);

        const dialog = await openDetails();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Fix recipient and resend' }));
        fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'pat.fixed@example.test' } });
        const save = within(dialog).getByRole('button', { name: 'Save and resend' });
        fireEvent.click(save);
        fireEvent.click(save);

        await waitFor(() => expect(within(dialog).getByRole('button', { name: /Save and resend/ })).toBeDisabled());
        expect(correctRecipient).toHaveBeenCalledTimes(1);
        await React.act(async () => { finish(true); });
    });

    it('closes only the dialog it was saved from: one opened since stays open', async () => {
        let finish;
        correctRecipient.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        renderHistory();
        emit([failedOpen(), makeDoc({ id: 'req-2', title: 'NDA', status: 'sent' })]);

        const first = await saveNewEmail();
        await waitFor(() => expect(within(first).getByRole('button', { name: /Save and resend/ })).toBeDisabled());
        // Closed while it saves, and another document opened.
        fireEvent.click(within(first).getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const second = await openDetails('Details for NDA');
        expect(second).toHaveAccessibleName('NDA');

        await React.act(async () => { finish(true); });

        expect(screen.getByRole('dialog')).toHaveAccessibleName('NDA');
    });
});
