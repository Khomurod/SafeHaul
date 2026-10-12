/**
 * A signing request sent by SMS is texted once, by the server.
 *
 * `notifySignerSMS` texts the link when a signing request is created with
 * `sendSms: true`. The editor also called the admin-only `sendSMS` callable:
 * an admin's signer got two texts, billed twice, and a recruiter saw "SMS
 * failed" for a text the server had sent. All names and numbers are artificial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
    callable: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('firebase/functions', () => ({
    getFunctions: () => ({}),
    httpsCallable: (...args) => mocks.httpsCallable(...args),
}));
vi.mock('firebase/storage', () => ({
    ref: () => ({}),
    uploadBytes: async () => {},
    getDownloadURL: async () => 'https://storage.example.test/offer.pdf',
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    doc: (parent, ...segments) => ({ id: segments.length ? segments[segments.length - 1] : 'request-1', parent }),
    addDoc: async () => ({ id: 'template-1' }),
    getDoc: async () => ({ exists: () => false }),
    updateDoc: async () => {},
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: mocks.batchSet, commit: mocks.batchCommit }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { saveEnvelope } from './envelopePersistence';

const FIELD = { id: 'sig-1', type: 'signature', x: 10, y: 80, width: 30, height: 5, pageNumber: 1, required: true };

function send(deliveryMethod, overrides = {}) {
    const callbacks = {
        onClose: vi.fn(),
        showError: vi.fn(),
        showSuccess: vi.fn(),
        setLoading: vi.fn(),
        setSaveState: vi.fn(),
        markSaved: vi.fn(),
    };
    const done = saveEnvelope({
        file: new File(['%PDF-1.4'], 'offer.pdf', { type: 'application/pdf' }),
        fields: [FIELD],
        creatorMode: 'request',
        isEditingTemplate: false,
        isEditingRequest: false,
        recipientName: 'Dana Driver',
        recipientEmail: 'dana@example.test',
        recipientPhone: '+15555550100',
        deliveryMethod,
        title: 'Offer Letter',
        companyId: 'co-1',
        companyName: 'Artificial Freight Co',
        ...callbacks,
        ...overrides,
    });
    return done.then(() => callbacks);
}

const signingRequest = () => mocks.batchSet.mock.calls[0][1];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.callable.mockResolvedValue({ data: { success: true } });
    mocks.httpsCallable.mockReturnValue(mocks.callable);
});

describe('saveEnvelope delivering by SMS', () => {
    it('leaves the text to the server, and calls nothing itself', async () => {
        const { showSuccess, showError } = await send('sms');

        expect(signingRequest()).toMatchObject({ sendSms: true, recipientPhone: '+15555550100', deliveryMethod: 'sms' });
        expect(mocks.httpsCallable).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
        expect(showSuccess).toHaveBeenCalledWith('Document created! SMS delivery in progress...');
    });

    it('texts once and emails for both', async () => {
        const { showSuccess } = await send('both');

        expect(signingRequest()).toMatchObject({ sendSms: true, sendEmail: true });
        expect(mocks.httpsCallable).not.toHaveBeenCalled();
        expect(showSuccess).toHaveBeenCalledWith('Document created! Email + SMS delivery in progress...');
    });

    it('sends no text for email', async () => {
        const { showSuccess } = await send('email');

        expect(signingRequest()).toMatchObject({ sendSms: false, sendEmail: true });
        expect(showSuccess).toHaveBeenCalledWith('Document created! Email delivery in progress...');
    });
});
