// EnvelopeHistory: Fix recipient and resend, on an open document whose send
// failed. It saves the correction Correct Document saves (`saveEnvelope`), so
// the server's correction trigger sends the new link; the editor never opens.
// The shared harness lives in `EnvelopeHistory.support.jsx`; every fixture is
// artificial (see its PRIVACY note).
import React from 'react';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/firestore', async () => (await import('./EnvelopeHistory.support')).firebaseFirestoreMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeHistory.support')).firebaseFunctionsMock());
vi.mock('@lib/firebase', async () => (await import('./EnvelopeHistory.support')).libFirebaseMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeHistory.support')).feedbackMock());
// The correction itself: what it is given is the contract here, and its own
// suites (`envelopePersistence.correction.test.js`) cover what it writes.
const { saveEnvelope, savedAndClosed } = vi.hoisted(() => {
    const saved = async ({ onClose, showSuccess }) => {
        showSuccess('Document corrected. A new signing link is on its way by Email, and the old one no longer works.');
        onClose();
    };
    return { saveEnvelope: vi.fn(saved), savedAndClosed: saved };
});
vi.mock('@features/signing/utils/envelopePersistence', () => ({ saveEnvelope }));

import EnvelopeHistory from './EnvelopeHistory';
import { makeRenderHistory, resetHarness, restoreHarness, makeDoc, emit, openDetails, fs, toast } from './EnvelopeHistory.support';

const renderHistory = makeRenderHistory(EnvelopeHistory);

const STORED_FIELDS = [
    { id: 'sig1', type: 'signature', label: 'Signature', pageNumber: 1, xPosition: 10, yPosition: 80, width: 30, height: 6, required: true },
    { id: 'name1', type: 'text', label: 'Name', pageNumber: 1, xPosition: 10, yPosition: 20, width: 30, height: 5, bindingKey: 'full_name', defaultValue: 'Pat Example', readOnly: true, prefillPolicy: 'locked' },
];

const failedOpen = (overrides = {}) => makeDoc({
    status: 'sent',
    sendEmail: true,
    deliveryMethod: 'email',
    emailStatus: 'failed',
    emailError: "Failed to send email: Can't send mail - all recipients were rejected: 550 5.1.1 Recipient address rejected: User unknown",
    storagePath: 'secure_documents/co-1/originals/offer.pdf',
    fields: STORED_FIELDS,
    ...overrides,
});

beforeEach(() => {
    resetHarness();
    saveEnvelope.mockImplementation(savedAndClosed);
});

afterEach(restoreHarness);

describe('EnvelopeHistory — Fix recipient and resend', () => {
    it('saves the edited recipient through the correction Correct Document saves, then closes', async () => {
        renderHistory({ companyName: 'Artificial Freight Co', onCorrect: vi.fn() });
        emit([failedOpen()]);

        const dialog = await openDetails();
        expect(within(dialog).getByRole('alert')).toHaveTextContent('The email address was refused.');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Fix recipient and resend' }));
        fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'pat.fixed@example.test' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(saveEnvelope).toHaveBeenCalledTimes(1);
        const call = saveEnvelope.mock.calls[0][0];
        expect(call).toMatchObject({
            creatorMode: 'request',
            isEditingTemplate: false,
            isEditingRequest: true,
            editRequestId: 'req-1',
            editTemplateId: null,
            companyId: 'co-1',
            companyName: 'Artificial Freight Co',
            title: 'Offer Letter',
            recipientName: 'Pat Example',
            recipientEmail: 'pat.fixed@example.test',
            recipientPhone: '',
            deliveryMethod: 'email',
        });
        // The stored fields, as Correct's editor loads them, and the stored PDF.
        expect(call.fields.map((field) => [field.id, field.page, field.x, field.defaultValue])).toEqual([
            ['sig1', 1, 10, ''],
            ['name1', 1, 10, 'Pat Example'],
        ]);
        expect(call.file).toBeTruthy();
        expect(toast.showSuccess).toHaveBeenCalledWith(expect.stringMatching(/^Document corrected\./));
        // No Firestore write of its own: the correction is the only one.
        expect(fs.updateDoc).not.toHaveBeenCalled();
    });

    it('keeps the dialog and the form open when the correction is refused', async () => {
        saveEnvelope.mockImplementation(async ({ showError }) => { showError('Email is required for email delivery.'); });
        renderHistory();
        emit([failedOpen()]);

        const dialog = await openDetails();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Fix recipient and resend' }));
        fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: '' } });
        fireEvent.click(within(dialog).getByRole('button', { name: 'Save and resend' }));

        await waitFor(() => expect(toast.showError).toHaveBeenCalledWith('Email is required for email delivery.'));
        expect(within(screen.getByRole('dialog')).getByLabelText(/^Email/)).toBeInTheDocument();
        await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save and resend' })).toBeEnabled());
    });

    it('saves once even when pressed twice in the same tick', async () => {
        let finish;
        saveEnvelope.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
        renderHistory();
        emit([failedOpen()]);

        const dialog = await openDetails();
        fireEvent.click(within(dialog).getByRole('button', { name: 'Fix recipient and resend' }));
        fireEvent.change(within(dialog).getByLabelText(/^Email/), { target: { value: 'pat.fixed@example.test' } });
        const save = within(dialog).getByRole('button', { name: 'Save and resend' });
        fireEvent.click(save);
        fireEvent.click(save);

        await waitFor(() => expect(saveEnvelope).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(within(dialog).getByRole('button', { name: /Save and resend/ })).toBeDisabled());
        await React.act(async () => { finish(); });
    });
});
