/**
 * Correct Document saves the delivery it shows, and says when the signer gets a
 * new link; Fix recipient and resend (`correctRecipient`) saves the same
 * correction for the recipient alone.
 *
 * The server sends a corrected email or phone a new link, on the channels the
 * request records (`resendSignerOnCorrection`). The correction saved the new
 * contact but not the delivery, so a request switched to SMS went nowhere.
 * Both read and write the request in one transaction, and change it only while
 * it waits for its signer. All names and numbers are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    // The request as the server holds it when the transaction reads it.
    current: null,
    get: vi.fn(),
    update: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/storage', () => ({
    ref: () => ({}),
    uploadBytes: async () => {},
    getDownloadURL: async () => 'https://storage.example.test/offer.pdf',
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    doc: (_parent, ...segments) => ({ path: segments.join('/') }),
    addDoc: async () => ({ id: 'template-1' }),
    getDoc: async () => { throw new Error('a correction reads the request in its transaction'); },
    updateDoc: async () => { throw new Error('a correction writes the request in its transaction'); },
    runTransaction: async (_db, run) => run({ get: (...args) => mocks.get(...args), update: (...args) => mocks.update(...args) }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    deleteField: () => 'DELETE_FIELD',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: vi.fn(), commit: vi.fn() }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { correctRecipient, saveEnvelope } from './envelopePersistence';

const FIELD = { id: 'sig-1', type: 'signature', x: 10, y: 80, width: 30, height: 5, pageNumber: 1, required: true };
const SENT = {
    status: 'sent',
    recipientName: 'Dana Driver',
    recipientEmail: 'dana@wrong.example.test',
    recipientPhone: '(555) 555-0100',
    deliveryMethod: 'email',
    sendEmail: true,
    sendSms: false,
};
const NO_LONGER_SENT = 'This document is no longer waiting for a signature: it was signed, voided or is being signed. The correction was not saved.';

function correct(overrides) {
    const callbacks = {
        onClose: vi.fn(),
        showError: vi.fn(),
        showSuccess: vi.fn(),
        setLoading: vi.fn(),
        setSaveState: vi.fn(),
        markSaved: vi.fn(),
    };
    return saveEnvelope({
        file: new File(['%PDF-1.4'], 'offer.pdf', { type: 'application/pdf' }),
        fields: [FIELD],
        creatorMode: 'request',
        isEditingTemplate: false,
        isEditingRequest: true,
        editRequestId: 'req-1',
        recipientName: SENT.recipientName,
        recipientEmail: SENT.recipientEmail,
        recipientPhone: SENT.recipientPhone,
        deliveryMethod: SENT.deliveryMethod,
        title: 'Offer Letter',
        companyId: 'co-1',
        companyName: 'Artificial Freight Co',
        ...callbacks,
        ...overrides,
    }).then(() => callbacks);
}

const saved = () => mocks.update.mock.calls[0][1];
const requestIs = (data) => { mocks.current = data; };

beforeEach(() => {
    vi.resetAllMocks();
    requestIs(SENT);
    mocks.get.mockImplementation(async () => ({ exists: () => mocks.current !== null, data: () => mocks.current }));
});

describe('saveEnvelope correcting a sent request', () => {
    it('needs no PDF: a correction keeps the request\'s own file and uploads none', async () => {
        const { showError } = await correct({ file: null, recipientEmail: 'dana@example.test' });

        expect(showError).not.toHaveBeenCalled();
        expect(saved()).toMatchObject({ recipientEmail: 'dana@example.test' });
    });

    it('reads and writes the request it corrects in one transaction', async () => {
        await correct({ recipientEmail: 'dana@example.test' });

        expect(mocks.get).toHaveBeenCalledWith({ path: 'companies/co-1/signing_requests/req-1' });
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.update.mock.calls[0][0]).toEqual({ path: 'companies/co-1/signing_requests/req-1' });
    });

    it('says a new link is on its way when the email changed', async () => {
        const { showSuccess, showError } = await correct({ recipientEmail: 'dana@example.test' });

        expect(saved()).toMatchObject({ recipientEmail: 'dana@example.test', deliveryMethod: 'email', sendEmail: true, sendSms: false });
        expect(showError).not.toHaveBeenCalled();
        expect(showSuccess).toHaveBeenCalledWith('Document corrected. A new signing link is on its way by Email, and the old one no longer works.');
    });

    it('saves a switch to SMS, so the server texts the corrected phone', async () => {
        const { showSuccess } = await correct({ recipientEmail: '', recipientPhone: '(555) 555-0199', deliveryMethod: 'sms' });

        expect(saved()).toMatchObject({ recipientEmail: null, recipientPhone: '(555) 555-0199', deliveryMethod: 'sms', sendEmail: false, sendSms: true });
        expect(showSuccess).toHaveBeenCalledWith('Document corrected. A new signing link is on its way by SMS, and the old one no longer works.');
    });

    it('tells a Copy Link sender to copy the new link', async () => {
        const { showSuccess } = await correct({ recipientEmail: 'dana@example.test', deliveryMethod: 'copy' });

        expect(saved()).toMatchObject({ sendEmail: false, sendSms: false, deliveryMethod: 'copy' });
        expect(showSuccess).toHaveBeenCalledWith('Document corrected. The old signing link no longer works: copy the new one from Sent Documents.');
    });

    it('says the current link is on its way by SMS when the correction switches SMS on', async () => {
        const { showSuccess } = await correct({ deliveryMethod: 'both' });

        expect(saved()).toMatchObject({ sendEmail: true, sendSms: true, deliveryMethod: 'both' });
        expect(showSuccess).toHaveBeenCalledWith('Document updated. The signing link is on its way by SMS.');
    });

    it('reads where the link went from its record: a changed phone it was texted to gets a new link', async () => {
        // SMS was switched off after the link was texted, so only the record says the phone has it.
        requestIs({ ...SENT, linkSentTo: { email: 'dana@wrong.example.test', phone: '+15555550100' } });
        const { showSuccess } = await correct({ recipientPhone: '(555) 555-0199' });

        expect(showSuccess).toHaveBeenCalledWith('Document corrected. A new signing link is on its way by Email, and the old one no longer works.');
    });

    it.each(['signed', 'processing', 'pending_seal', 'voided'])(
        'saves nothing, and says why, once the request is %s: the signer keeps what they signed',
        async (status) => {
            requestIs({ ...SENT, status });
            const { showSuccess, showError, onClose, markSaved, setSaveState } = await correct({ recipientEmail: 'dana@example.test' });

            expect(mocks.update).not.toHaveBeenCalled();
            expect(showSuccess).not.toHaveBeenCalled();
            expect(showError).toHaveBeenCalledWith(NO_LONGER_SENT);
            expect(onClose).not.toHaveBeenCalled();
            expect(markSaved).not.toHaveBeenCalled();
            expect(setSaveState).toHaveBeenLastCalledWith('error');
        },
    );

    it('keeps the plain confirmation when the contact did not change', async () => {
        const { showSuccess } = await correct({ recipientName: 'Dana M. Driver', recipientPhone: '+1 555 555 0100', recipientEmail: ' DANA@wrong.example.test ' });

        expect(saved()).toMatchObject({ recipientName: 'Dana M. Driver' });
        expect(showSuccess).toHaveBeenCalledWith('Document updated successfully!');
    });
});

describe('saveEnvelope correcting a request whose send failed', () => {
    const FAILED_BOTH = {
        ...SENT,
        deliveryMethod: 'both',
        sendSms: true,
        emailStatus: 'failed',
        emailError: 'SMTP 550 rejected (artificial)',
        smsStatus: 'failed',
        smsError: 'Not texted: this number opted out of texts.',
    };

    beforeEach(() => requestIs(FAILED_BOTH));

    it('clears the failure of the text it turns off, and leaves the email to the server', async () => {
        await correct({ deliveryMethod: 'email' });

        expect(saved()).toMatchObject({
            sendEmail: true,
            sendSms: false,
            smsStatus: 'DELETE_FIELD',
            smsError: 'DELETE_FIELD',
            smsNote: 'DELETE_FIELD',
        });
        expect(saved()).not.toHaveProperty('emailStatus');
        expect(saved()).not.toHaveProperty('emailError');
    });

    it('clears the failure of the email it turns off', async () => {
        await correct({ recipientEmail: '', deliveryMethod: 'sms' });

        expect(saved()).toMatchObject({ sendEmail: false, emailStatus: 'DELETE_FIELD', emailError: 'DELETE_FIELD' });
        expect(saved()).not.toHaveProperty('smsStatus');
        expect(saved()).not.toHaveProperty('smsError');
    });

    it('clears both when the correction leaves only a copied link', async () => {
        await correct({ deliveryMethod: 'copy' });

        expect(saved()).toMatchObject({
            emailStatus: 'DELETE_FIELD', emailError: 'DELETE_FIELD',
            smsStatus: 'DELETE_FIELD', smsError: 'DELETE_FIELD', smsNote: 'DELETE_FIELD',
        });
    });

    it('keeps the record of every channel it leaves on: the server sends it again and records how', async () => {
        await correct({ deliveryMethod: 'both' });

        for (const field of ['emailStatus', 'emailError', 'smsStatus', 'smsError', 'smsNote']) {
            expect(saved()).not.toHaveProperty(field);
        }
    });
});

describe('correctRecipient: Fix recipient and resend', () => {
    // The request as stored: fields with their resolved values, and an email bound field the send left empty.
    const STORED_FIELDS = [
        { id: 'sig-1', type: 'signature', label: 'Signature', pageNumber: 1, xPosition: 10, yPosition: 80, width: 30, height: 5, required: true },
        { id: 'name-1', type: 'text', label: 'Name', pageNumber: 1, xPosition: 10, yPosition: 20, width: 30, height: 5, required: true, bindingKey: 'full_name', defaultValue: 'Dana Driver', readOnly: true, prefillPolicy: 'locked' },
        { id: 'email-1', type: 'text', label: 'Email', pageNumber: 1, xPosition: 10, yPosition: 30, width: 30, height: 5, required: false, bindingKey: 'email', defaultValue: '', prefillPolicy: 'editable' },
    ];
    const FAILED = {
        ...SENT,
        title: 'Offer Letter',
        fields: STORED_FIELDS,
        emailStatus: 'failed',
        emailError: 'Failed to send email: 550 5.1.1 Recipient address rejected (artificial)',
    };

    function fix(recipient = {}) {
        const callbacks = { showError: vi.fn(), showSuccess: vi.fn() };
        return correctRecipient({
            companyId: 'co-1',
            companyName: 'Artificial Freight Co',
            requestId: 'req-1',
            recipientName: SENT.recipientName,
            recipientEmail: SENT.recipientEmail,
            recipientPhone: SENT.recipientPhone,
            deliveryMethod: 'email',
            ...callbacks,
            ...recipient,
        }).then((answer) => ({ answer, ...callbacks }));
    }

    beforeEach(() => requestIs(FAILED));

    it('writes the new recipient onto the request as it is now: its own fields, resolved again, and its own title', async () => {
        // Another recruiter's edit, saved after the dialog opened: a field the dialog never saw, and a new title.
        const extra = { id: 'date-1', type: 'date', label: 'Start date', pageNumber: 2, xPosition: 40, yPosition: 40, width: 20, height: 5, required: false, defaultValue: '' };
        requestIs({ ...FAILED, title: 'Offer Letter (revised)', fields: [...STORED_FIELDS, extra] });

        const { answer, showSuccess, showError } = await fix({ recipientEmail: 'dana@example.test' });

        expect(answer).toBe(true);
        expect(showError).not.toHaveBeenCalled();
        expect(mocks.update).toHaveBeenCalledTimes(1);
        expect(mocks.update.mock.calls[0][0]).toEqual({ path: 'companies/co-1/signing_requests/req-1' });
        const written = saved();
        expect(written).not.toHaveProperty('title');
        expect(written.fields.map((field) => field.id)).toEqual(['sig-1', 'name-1', 'email-1', 'date-1']);
        // A prefill that depends on the recipient follows the new one; a resolved one stays as sent.
        expect(written.fields.find((field) => field.id === 'email-1').defaultValue).toBe('dana@example.test');
        expect(written.fields.find((field) => field.id === 'name-1').defaultValue).toBe('Dana Driver');
        expect(written).toMatchObject({
            recipientEmail: 'dana@example.test',
            recipientName: 'Dana Driver',
            recipientPhone: '(555) 555-0100',
            sendEmail: true,
            sendSms: false,
            deliveryMethod: 'email',
            updatedAt: 'SERVER_TIMESTAMP',
        });
        expect(showSuccess).toHaveBeenCalledWith('Document corrected. A new signing link is on its way by Email, and the old one no longer works.');
    });

    it.each(['signed', 'processing', 'pending_seal', 'voided'])(
        'saves nothing once the request is %s, and says why',
        async (status) => {
            requestIs({ ...FAILED, status });
            const { answer, showSuccess, showError } = await fix({ recipientEmail: 'dana@example.test' });

            expect(answer).toBe(false);
            expect(mocks.update).not.toHaveBeenCalled();
            expect(showSuccess).not.toHaveBeenCalled();
            expect(showError).toHaveBeenCalledWith(NO_LONGER_SENT);
        },
    );

    it('saves nothing when it would send nothing while the email that failed stays on: only the name changed', async () => {
        const { answer, showError } = await fix({ recipientName: 'Dana M. Driver' });

        expect(answer).toBe(false);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/^Not saved: nothing would be sent again\. The email failed to this address.*press Cancel, then Resend/));
    });

    it('saves nothing when it only turns off the text beside an email that failed', async () => {
        requestIs({ ...FAILED, deliveryMethod: 'both', sendSms: true, smsStatus: 'sent' });
        const { answer, showError } = await fix({ deliveryMethod: 'email' });

        expect(answer).toBe(false);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/The email failed to this address/));
    });

    it('saves nothing when a failed text would stay on to the same number, with nothing else to send', async () => {
        requestIs({ ...FAILED, deliveryMethod: 'sms', sendEmail: false, sendSms: true, emailStatus: undefined, smsStatus: 'failed', smsError: 'Line unavailable (artificial)' });
        const { answer, showError } = await fix({ recipientName: 'Dana M. Driver', deliveryMethod: 'sms' });

        expect(answer).toBe(false);
        expect(mocks.update).not.toHaveBeenCalled();
        expect(showError).toHaveBeenCalledWith(expect.stringMatching(/^Not saved: nothing would be sent again\. The text failed to this number/));
    });

    it('saves adding a text beside an email that failed: the text goes, and the email keeps its record', async () => {
        const { answer, showSuccess } = await fix({ recipientPhone: '(555) 555-0100', deliveryMethod: 'both' });

        expect(answer).toBe(true);
        expect(saved()).toMatchObject({ sendEmail: true, sendSms: true });
        expect(saved()).not.toHaveProperty('emailStatus');
        expect(showSuccess).toHaveBeenCalledWith('Document updated. The signing link is on its way by SMS.');
    });

    it('saves turning a failed text off when the email went: its failure goes with it', async () => {
        requestIs({ ...FAILED, deliveryMethod: 'both', sendSms: true, emailStatus: 'sent', smsStatus: 'failed', smsError: 'Line unavailable (artificial)' });
        const { answer, showSuccess } = await fix({ deliveryMethod: 'email' });

        expect(answer).toBe(true);
        expect(saved()).toMatchObject({ sendSms: false, smsStatus: 'DELETE_FIELD', smsError: 'DELETE_FIELD', smsNote: 'DELETE_FIELD' });
        expect(showSuccess).toHaveBeenCalledWith('Document updated successfully!');
    });

    it('checks the recipient as Correct Document does, before reading anything', async () => {
        const { answer, showError } = await fix({ recipientName: '' });

        expect(answer).toBe(false);
        expect(showError).toHaveBeenCalledWith('Please provide a recipient name.');
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it('lets a failure to write reach its caller', async () => {
        mocks.update.mockImplementation(() => { throw Object.assign(new Error('offline'), { code: 'unavailable' }); });

        await expect(fix({ recipientEmail: 'dana@example.test' })).rejects.toMatchObject({ code: 'unavailable' });
    });
});
