/**
 * "Correct" and "Edit Template" download the envelope's PDF again, and give up
 * after 120 seconds.
 *
 * A stalled Storage answer left the editor on its loading state until the page
 * was reloaded. Now the download ends in the existing load error and the
 * editor leaves that state. A fake `fetch` rejects when its signal aborts, as
 * the browser's does, for the request and for the body. All names are
 * artificial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', () => ({
    db: {},
    storage: {},
    auth: { currentUser: { uid: 'user-1', displayName: 'Rita Recruiter', email: 'rita@example.test' } },
}));
vi.mock('@lib/firebase/storage', () => ({ storage: {} }));
vi.mock('firebase/functions', () => ({
    getFunctions: () => ({}),
    httpsCallable: () => async () => ({ data: {} }),
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
    getDoc: async () => ({
        exists: () => true,
        data: () => ({ storagePath: 'companies/co-1/docs/offer.pdf', title: 'Offer' }),
    }),
    updateDoc: async () => {},
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    Timestamp: { fromMillis: (ms) => ({ ms }) },
    writeBatch: () => ({ set: vi.fn(), commit: vi.fn() }),
}));
vi.mock('uuid', () => ({ v4: () => 'token-1' }));

import { hydrateEnvelopeForEdit } from './envelopePersistence';

const PDF_DOWNLOAD_TIMEOUT_MS = 120000;
const PDF_URL = 'https://storage.example.test/offer.pdf';

const rejectOnAbort = (signal) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
});

function hydrate() {
    const callbacks = {
        showError: vi.fn(),
        resetEditorHistory: vi.fn(),
        setHydrating: vi.fn(),
        setRecipientName: vi.fn(),
        setRecipientEmail: vi.fn(),
        setRecipientPhone: vi.fn(),
        setTitle: vi.fn(),
        setDeliveryMethod: vi.fn(),
        setCreatorMode: vi.fn(),
        setExistingStoragePath: vi.fn(),
        setNumPages: vi.fn(),
        setFile: vi.fn(),
    };
    const run = hydrateEnvelopeForEdit({
        companyId: 'co-1',
        editingCollection: 'signing_requests',
        editingEntityId: 'req-1',
        isEditingTemplate: false,
        ...callbacks,
    });
    return { run, ...callbacks };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('hydrateEnvelopeForEdit downloading the PDF', () => {
    it.each([
        ['the request', (url, init) => rejectOnAbort(init.signal)],
        ['the download', async (url, init) => ({ blob: () => rejectOnAbort(init.signal) })],
    ])('gives up on %s after 120 seconds with the load error', async (_stage, fetchImpl) => {
        vi.stubGlobal('fetch', vi.fn(fetchImpl));
        const { run, showError, setHydrating, setFile } = hydrate();

        await vi.advanceTimersByTimeAsync(PDF_DOWNLOAD_TIMEOUT_MS - 1);
        expect(showError).not.toHaveBeenCalled();
        expect(setHydrating).not.toHaveBeenCalledWith(false);

        await vi.advanceTimersByTimeAsync(1);
        await run;
        expect(showError).toHaveBeenCalledTimes(1);
        expect(showError).toHaveBeenCalledWith('Failed to load document for editing.');
        expect(setHydrating).toHaveBeenLastCalledWith(false);
        expect(setFile).not.toHaveBeenCalled();
    });

    it('hands a prompt answer to the editor as a PDF and stops the clock', async () => {
        const fetchMock = vi.fn(async () => ({ blob: async () => new Blob(['%PDF']) }));
        vi.stubGlobal('fetch', fetchMock);
        const { run, showError, setHydrating, setFile } = hydrate();
        await run;

        expect(fetchMock).toHaveBeenCalledWith(PDF_URL, { signal: expect.any(AbortSignal) });
        expect(vi.getTimerCount()).toBe(0);
        expect(showError).not.toHaveBeenCalled();
        expect(setFile).toHaveBeenCalledTimes(1);
        const [file] = setFile.mock.calls[0];
        expect(file).toBeInstanceOf(File);
        expect(file.type).toBe('application/pdf');
        expect(file.name).toBe('Offer.pdf');
        expect(setHydrating).toHaveBeenLastCalledWith(false);
    });
});
