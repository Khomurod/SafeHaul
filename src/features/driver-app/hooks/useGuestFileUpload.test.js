/**
 * The guest upload hook's "still uploading" flag, which the wizard's Continue,
 * the preparation workspace and a Company Admin's editor all wait on before they
 * move on: a document still on its way is not an answer yet. And what it refuses
 * before it reserves anything, what it says when an upload fails, and that a
 * cancel says nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ tasks: [], reserve: null, showError: null, shrink: null }));

vi.mock('firebase/functions', () => ({
    httpsCallable: () => (payload) => mocks.reserve(payload),
}));
vi.mock('firebase/storage', () => ({
    ref: (_storage, path) => ({ path }),
    // Each upload finishes, or fails, when the test says so.
    uploadBytesResumable: () => {
        const task = { handlers: null, cancel: vi.fn() };
        task.on = (_event, next, error, complete) => { task.handlers = { next, error, complete }; };
        task.cancel.mockImplementation(() => task.handlers.error({ code: 'storage/canceled' }));
        mocks.tasks.push(task);
        return task;
    },
}));
vi.mock('@lib/firebase', () => ({ functions: {}, storage: {} }));
vi.mock('@lib/runtime/e2eMode', () => ({ isE2ETestMode: false, getE2EQueryParam: () => null }));
vi.mock('@shared/components/feedback/ToastProvider', () => ({
    useToast: () => ({ showSuccess: vi.fn(), showError: mocks.showError }),
}));
vi.mock('./guestUploadImage', () => ({
    shrinkPhoto: async (file) => (mocks.shrink ? mocks.shrink(file) : file),
}));

import { useGuestFileUpload } from './useGuestFileUpload';

const png = (name, size = 1) => {
    const file = new File(['x'], name, { type: 'image/png' });
    if (size !== 1) Object.defineProperty(file, 'size', { value: size });
    return file;
};

beforeEach(() => {
    mocks.tasks.length = 0;
    mocks.reserve = vi.fn(async ({ fileName }) => ({
        data: { storagePath: `companies/company-1/applications/guest_uploads/${fileName}` },
    }));
    mocks.showError = vi.fn();
    mocks.shrink = null;
});

describe('useGuestFileUpload', () => {
    it('is still uploading while any upload is on its way, not only until the first finishes', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let front;
        let back;
        act(() => {
            front = result.current.handleFileUpload('cdl-front', png('front.png'));
            back = result.current.handleFileUpload('cdl-back', png('back.png'));
        });
        await vi.waitFor(() => expect(mocks.tasks).toHaveLength(2));
        expect(result.current.isUploading).toBe(true);

        await act(async () => { mocks.tasks[0].handlers.complete(); await front; });
        expect(result.current.isUploading).toBe(true);

        await act(async () => { mocks.tasks[1].handlers.complete(); await back; });
        expect(result.current.isUploading).toBe(false);
        await expect(back).resolves.toEqual({
            name: 'back.png', storagePath: 'companies/company-1/applications/guest_uploads/back.png',
        });
    });

    it('passes the real progress on', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        const onProgress = vi.fn();
        let sent;
        act(() => { sent = result.current.handleFileUpload('cdl-front', png('front.png'), { onProgress }); });
        await vi.waitFor(() => expect(mocks.tasks).toHaveLength(1));

        await act(async () => {
            mocks.tasks[0].handlers.next({ bytesTransferred: 1, totalBytes: 4 });
            mocks.tasks[0].handlers.complete();
            await sent;
        });
        expect(onProgress).toHaveBeenCalledWith(0.25);
        expect(onProgress).toHaveBeenLastCalledWith(1);
    });

    it('refuses a file over 20 MB before reserving anything, and says so', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let error;
        await act(async () => {
            error = await result.current.handleFileUpload('cdl-front', png('huge.png', 21 * 1024 * 1024)).catch((e) => e);
        });

        expect(error.code).toBe('too-large');
        expect(mocks.reserve).not.toHaveBeenCalled();
        expect(mocks.showError).toHaveBeenCalledWith('This file is larger than 20 MB. Choose a smaller file, or take a photo of the document instead.');
        expect(result.current.isUploading).toBe(false);
    });

    it('refuses a type the server would refuse, in words, before reserving anything', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let error;
        await act(async () => {
            error = await result.current.handleFileUpload('cdl-front', new File(['x'], 'card.gif', { type: 'image/gif' })).catch((e) => e);
        });

        expect(error.code).toBe('unsupported-type');
        expect(mocks.reserve).not.toHaveBeenCalled();
        expect(mocks.showError).toHaveBeenCalledWith('This file type cannot be sent. Use a photo (JPG, PNG, WEBP or HEIC) or a PDF.');
    });

    it('sends a big photo as its smaller copy, so one over 20 MB can still go', async () => {
        const smaller = new File(['y'], 'IMG_1.jpg', { type: 'image/jpeg' });
        mocks.shrink = () => smaller;
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let sent;
        act(() => { sent = result.current.handleFileUpload('cdl-front', png('IMG_1.png', 21 * 1024 * 1024)); });
        await vi.waitFor(() => expect(mocks.tasks).toHaveLength(1));

        expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'IMG_1.jpg', fileType: 'image/jpeg' }));
        await act(async () => { mocks.tasks[0].handlers.complete(); await sent; });
        await expect(sent).resolves.toEqual({ name: 'IMG_1.jpg', storagePath: 'companies/company-1/applications/guest_uploads/IMG_1.jpg' });
    });

    it('shows a failure in plain words, never Firebase’s own sentence', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let sent;
        act(() => { sent = result.current.handleFileUpload('cdl-front', png('front.png')); });
        await vi.waitFor(() => expect(mocks.tasks).toHaveLength(1));

        const outcome = sent.catch((error) => error);
        act(() => mocks.tasks[0].handlers.error({ code: 'storage/unauthorized', message: "Firebase Storage: User does not have permission to access 'x'." }));

        expect((await outcome).message).toBe('This file could not be accepted. Use a photo or a PDF under 20 MB.');
        expect(mocks.showError).toHaveBeenCalledWith('This file could not be accepted. Use a photo or a PDF under 20 MB.');
    });

    it('tells a refused reservation in plain words, never its code', async () => {
        mocks.reserve = vi.fn(async () => { throw Object.assign(new Error('internal'), { code: 'functions/internal' }); });
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        let sent;
        act(() => { sent = result.current.handleFileUpload('cdl-front', png('front.png')); });

        await expect(sent).rejects.toMatchObject({ code: 'failed', message: 'Upload failed. Please try again.' });
        expect(mocks.showError).toHaveBeenCalledWith('Upload failed. Please try again.');
        expect(mocks.showError).not.toHaveBeenCalledWith('internal');
    });

    it('cancels without an error message', async () => {
        const { result } = renderHook(() => useGuestFileUpload('company-1'));
        const upload = new AbortController();
        let sent;
        act(() => { sent = result.current.handleFileUpload('cdl-front', png('front.png'), { signal: upload.signal }); });
        await vi.waitFor(() => expect(mocks.tasks).toHaveLength(1));

        const outcome = sent.catch((error) => error);
        let error;
        await act(async () => {
            upload.abort();
            error = await outcome;
        });

        expect(error.code).toBe('cancelled');
        expect(mocks.showError).not.toHaveBeenCalled();
        expect(result.current.isUploading).toBe(false);
    });
});
