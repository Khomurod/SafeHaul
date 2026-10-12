/**
 * A template sent by Copy Link is created once, whether or not the browser lets
 * the flow copy its link.
 *
 * The flow wrote the request first and copied its link after. A refused
 * clipboard landed in the send's own error, "Failed to send template.", and
 * left the wizard open with Copy Signing Link enabled, so pressing it again
 * created a second request with a second live link. All names and addresses
 * are artificial.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
    writeText: vi.fn(),
}));

vi.mock('@lib/firebase', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
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

async function sendByCopyLink() {
    const toasts = { showSuccess: vi.fn(), showError: vi.fn(), showWarning: vi.fn() };
    const setActiveTab = vi.fn();
    const { result } = renderHook(() => useTemplateSendFlow({
        currentCompanyProfile: { id: 'co-1', companyName: 'Artificial Freight Co' },
        isE2EEdocMock: false,
        navigate: vi.fn(),
        setActiveTab,
        ...toasts,
    }));
    act(() => result.current.handleUseTemplate(TEMPLATE));
    act(() => {
        result.current.setManualName('Dana Driver');
        result.current.setDeliveryMethod('copy');
    });
    await act(() => result.current.executeTemplateSend());
    return { ...toasts, setActiveTab, result };
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: mocks.writeText } });
});
afterEach(() => vi.unstubAllGlobals());

describe('useTemplateSendFlow delivering by Copy Link', () => {
    it('copies the link of the request it created and shows it in Sent', async () => {
        mocks.writeText.mockResolvedValue(undefined);
        const { showSuccess, showError, setActiveTab, result } = await sendByCopyLink();

        expect(mocks.writeText).toHaveBeenCalledWith(`${window.location.origin}/sign/co-1/request-1?token=token-1`);
        expect(showSuccess).toHaveBeenCalledWith('Signing link copied to clipboard!');
        expect(showError).not.toHaveBeenCalled();
        expect(setActiveTab).toHaveBeenCalledWith('sent');
        expect(result.current.showDriverPicker).toBe(false);
    });

    it('closes on the created request when the browser refuses the clipboard, and says where the link is', async () => {
        mocks.writeText.mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError'));
        const { showWarning, showError, setActiveTab, result } = await sendByCopyLink();

        expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
        expect(showWarning).toHaveBeenCalledWith('Document created, but the browser blocked copying its link. Copy it from Sent Documents.');
        expect(showError).not.toHaveBeenCalled();
        expect(setActiveTab).toHaveBeenCalledWith('sent');
        expect(result.current.showDriverPicker).toBe(false);
    });
});
