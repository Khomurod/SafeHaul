/**
 * A template sent by SMS is texted once, by the server, whoever sends it.
 *
 * The flow wrote `sendSms: false` and texted through the admin-only `sendSMS`
 * callable instead, so a recruiter's template text was never sent at all; it
 * only said "SMS failed". `notifySignerSMS` texts every signing request created
 * with `sendSms: true`. All names and numbers are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
    callable: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('firebase/functions', () => ({
    getFunctions: () => ({}),
    httpsCallable: (...args) => mocks.httpsCallable(...args),
}));
vi.mock('firebase/firestore', () => ({
    collection: (...segments) => ({ path: segments.slice(1).join('/') }),
    query: (ref) => ref,
    getDocs: async () => ({ docs: [] }),
    doc: (parent, ...segments) => ({ id: segments.length ? segments[segments.length - 1] : 'request-1', parent }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: mocks.batchSet, commit: mocks.batchCommit }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { useTemplateSendFlow } from './useTemplateSendFlow';

const TEMPLATE = {
    id: 'template-1',
    title: 'Offer Letter',
    storagePath: 'secure_documents/co-1/templates/offer.pdf',
    fields: [{ id: 'sig-1', type: 'signature', x: 10, y: 80, width: 30, height: 5, pageNumber: 1, required: true }],
};

async function sendTemplate(deliveryMethod) {
    const showSuccess = vi.fn();
    const showError = vi.fn();
    const { result } = renderHook(() => useTemplateSendFlow({
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight Co' },
        isE2EEdocMock: false,
        navigate: vi.fn(),
        setActiveTab: vi.fn(),
        showSuccess,
        showError,
    }));
    act(() => result.current.handleUseTemplate(TEMPLATE));
    act(() => {
        result.current.setManualName('Dana Driver');
        result.current.setManualEmail('dana@example.test');
        result.current.setManualPhone('+15555550100');
        result.current.setDeliveryMethod(deliveryMethod);
    });
    await act(() => result.current.executeTemplateSend());
    return { showSuccess, showError };
}

const signingRequest = () => mocks.batchSet.mock.calls[0][1];

beforeEach(() => {
    vi.clearAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
    mocks.callable.mockResolvedValue({ data: { success: true } });
    mocks.httpsCallable.mockReturnValue(mocks.callable);
});

describe('useTemplateSendFlow delivering by SMS', () => {
    it('asks the server for the text, and calls nothing itself', async () => {
        const { showSuccess, showError } = await sendTemplate('sms');

        expect(signingRequest()).toMatchObject({ sendSms: true, recipientPhone: '+15555550100', deliveryMethod: 'sms' });
        expect(mocks.httpsCallable).not.toHaveBeenCalled();
        expect(showError).not.toHaveBeenCalled();
        expect(showSuccess).toHaveBeenCalledWith('Document created! SMS delivery in progress...');
    });

    it('texts once and emails for both', async () => {
        const { showSuccess } = await sendTemplate('both');

        expect(signingRequest()).toMatchObject({ sendSms: true, sendEmail: true });
        expect(mocks.httpsCallable).not.toHaveBeenCalled();
        expect(showSuccess).toHaveBeenCalledWith('Document created! Email + SMS delivery in progress...');
    });

    it('sends no text for email', async () => {
        const { showSuccess } = await sendTemplate('email');

        expect(signingRequest()).toMatchObject({ sendSms: false, sendEmail: true });
        expect(showSuccess).toHaveBeenCalledWith('Document created! Email delivery in progress...');
    });
});
