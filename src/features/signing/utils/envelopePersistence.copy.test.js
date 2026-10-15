/**
 * A request sent by Copy Link is created once, whether or not the browser lets
 * the editor copy its link.
 *
 * The editor wrote the request first and copied its link after. A refused
 * clipboard (a page that lost focus, a browser that wants a fresh click after
 * the save) landed in the save's own error: "Save failed", the work marked
 * unsaved and Send enabled again, so a second Send created a second request
 * with a second live link. All names and addresses are artificial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    batchSet: vi.fn(),
    batchCommit: vi.fn(),
    writeText: vi.fn(),
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
import { SAVE_STATES } from './editorSaveState';

const FIELD = { id: 'sig-1', type: 'signature', x: 10, y: 80, width: 30, height: 5, pageNumber: 1, required: true };

function sendByCopyLink() {
    const callbacks = {
        onClose: vi.fn(),
        showError: vi.fn(),
        showSuccess: vi.fn(),
        showWarning: vi.fn(),
        setLoading: vi.fn(),
        setSaveState: vi.fn(),
        markSaved: vi.fn(),
    };
    return saveEnvelope({
        file: new File(['%PDF-1.4'], 'offer.pdf', { type: 'application/pdf' }),
        fields: [FIELD],
        creatorMode: 'request',
        isEditingTemplate: false,
        isEditingRequest: false,
        recipientName: 'Dana Driver',
        recipientEmail: 'dana@example.test',
        recipientPhone: '',
        deliveryMethod: 'copy',
        title: 'Offer Letter',
        companyId: 'co-1',
        companyName: 'Artificial Freight Co',
        ...callbacks,
    }).then(() => callbacks);
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.batchCommit.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: mocks.writeText } });
});
afterEach(() => vi.unstubAllGlobals());

describe('saveEnvelope delivering by Copy Link', () => {
    it('copies the link of the request it created', async () => {
        mocks.writeText.mockResolvedValue(undefined);
        const { showSuccess, showError, markSaved, onClose } = await sendByCopyLink();

        expect(mocks.writeText).toHaveBeenCalledWith(`${window.location.origin}/sign/co-1/request-1?token=token-1`);
        expect(showSuccess).toHaveBeenCalledWith('Signing link copied to clipboard!');
        expect(showError).not.toHaveBeenCalled();
        expect([markSaved, onClose].map((fn) => fn.mock.calls.length)).toEqual([1, 1]);
    });

    it('keeps the request saved when the browser refuses the clipboard, and says where the link is', async () => {
        mocks.writeText.mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError'));
        const { showWarning, showError, setSaveState, markSaved, onClose } = await sendByCopyLink();

        expect(mocks.batchCommit).toHaveBeenCalledTimes(1);
        expect(showWarning).toHaveBeenCalledWith('Document created, but the browser blocked copying its link. Copy it from Sent Documents.');
        expect(showError).not.toHaveBeenCalled();
        expect(setSaveState).not.toHaveBeenCalledWith(SAVE_STATES.ERROR);
        expect([markSaved, onClose].map((fn) => fn.mock.calls.length)).toEqual([1, 1]);
    });

    it('keeps the request saved on a page with no clipboard at all', async () => {
        vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });
        const { showWarning, showError, markSaved } = await sendByCopyLink();

        expect(showWarning).toHaveBeenCalledTimes(1);
        expect(showError).not.toHaveBeenCalled();
        expect(markSaved).toHaveBeenCalledTimes(1);
    });
});
