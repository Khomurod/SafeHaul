/**
 * Correct Document saves the delivery it shows, and says when the signer gets a
 * new link.
 *
 * The server sends a corrected email or phone a new link, on the channels the
 * request records (`resendSignerOnCorrection`). The correction saved the new
 * contact but not the delivery, so a request switched to SMS went nowhere. All
 * names and numbers are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getDoc: vi.fn(),
    updateDoc: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('firebase/storage', () => ({
    ref: () => ({}),
    uploadBytes: async () => {},
    getDownloadURL: async () => 'https://storage.example.test/offer.pdf',
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    doc: (_parent, ...segments) => ({ path: segments.join('/') }),
    addDoc: async () => ({ id: 'template-1' }),
    getDoc: (...args) => mocks.getDoc(...args),
    updateDoc: (...args) => mocks.updateDoc(...args),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: vi.fn(), commit: vi.fn() }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { saveEnvelope } from './envelopePersistence';

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

const saved = () => mocks.updateDoc.mock.calls[0][1];

beforeEach(() => {
    vi.resetAllMocks();
    mocks.getDoc.mockResolvedValue({ data: () => SENT });
    mocks.updateDoc.mockResolvedValue(undefined);
});

describe('saveEnvelope correcting a sent request', () => {
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
        mocks.getDoc.mockResolvedValue({
            data: () => ({ ...SENT, linkSentTo: { email: 'dana@wrong.example.test', phone: '+15555550100' } }),
        });
        const { showSuccess } = await correct({ recipientPhone: '(555) 555-0199' });

        expect(showSuccess).toHaveBeenCalledWith('Document corrected. A new signing link is on its way by Email, and the old one no longer works.');
    });

    it('promises nothing for a request that is already signed', async () => {
        mocks.getDoc.mockResolvedValue({ data: () => ({ ...SENT, status: 'signed' }) });
        const { showSuccess } = await correct({ recipientEmail: 'dana@example.test' });

        expect(showSuccess).toHaveBeenCalledWith('Document updated successfully!');
    });

    it('keeps the plain confirmation when the contact did not change', async () => {
        const { showSuccess } = await correct({ recipientName: 'Dana M. Driver', recipientPhone: '+1 555 555 0100', recipientEmail: ' DANA@wrong.example.test ' });

        expect(saved()).toMatchObject({ recipientName: 'Dana M. Driver' });
        expect(showSuccess).toHaveBeenCalledWith('Document updated successfully!');
    });
});
