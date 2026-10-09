/**
 * One guest upload on its way to Storage: the progress it reports, the two ways
 * this side ends it (Cancel, and a stall), and the plain sentence each failure
 * carries. The Storage task is a stand-in the test drives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = vi.hoisted(() => []);

vi.mock('firebase/storage', () => ({
    ref: (_storage, path) => ({ path }),
    uploadBytesResumable: (fileRef, file, metadata) => {
        const task = {
            fileRef, file, metadata, handlers: null, cancel: vi.fn(),
            progress(bytesTransferred, totalBytes) { this.handlers.next({ bytesTransferred, totalBytes }); },
            fail(error) { this.handlers.error(error); },
            finish() { this.handlers.complete(); },
        };
        task.on = (_event, next, error, complete) => { task.handlers = { next, error, complete }; };
        // Storage answers a cancel with its own error.
        task.cancel.mockImplementation(() => task.fail({ code: 'storage/canceled' }));
        tasks.push(task);
        return task;
    },
}));
vi.mock('@lib/firebase', () => ({ storage: {} }));

import {
    GUEST_UPLOAD_STALL_MS,
    GuestUploadError,
    toGuestUploadError,
    transferGuestUpload,
} from './guestUploadTransfer';

const file = new File(['x'], 'cdl.jpg', { type: 'image/jpeg' });
const lastTask = () => tasks[tasks.length - 1];

beforeEach(() => {
    tasks.length = 0;
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('transferGuestUpload', () => {
    it('reports the real share sent, and resolves once the file is stored', async () => {
        const onProgress = vi.fn();
        const sent = transferGuestUpload('companies/c1/applications/guest_uploads/cdl.jpg', file, { contentType: 'image/jpeg', onProgress });
        expect(lastTask().metadata).toEqual({ contentType: 'image/jpeg' });

        lastTask().progress(250, 1000);
        lastTask().progress(1000, 1000);
        lastTask().finish();

        await expect(sent).resolves.toBeUndefined();
        expect(onProgress.mock.calls.map(([fraction]) => fraction)).toEqual([0.25, 1, 1]);
    });

    it('ends the upload on Cancel, as a cancel rather than a failure', async () => {
        const upload = new AbortController();
        const sent = transferGuestUpload('p', file, { signal: upload.signal });

        upload.abort();

        await expect(sent).rejects.toMatchObject({ code: 'cancelled' });
        expect(lastTask().cancel).toHaveBeenCalledTimes(1);
    });

    it('starts nothing when it is cancelled before it begins', async () => {
        const upload = new AbortController();
        upload.abort();
        await expect(transferGuestUpload('p', file, { signal: upload.signal })).rejects.toMatchObject({ code: 'cancelled' });
        expect(tasks).toHaveLength(0);
    });

    it('ends an upload that moves no bytes, instead of retrying out of sight', async () => {
        const sent = transferGuestUpload('p', file);
        const outcome = sent.catch((error) => error);

        vi.advanceTimersByTime(GUEST_UPLOAD_STALL_MS);

        const error = await outcome;
        expect(error).toBeInstanceOf(GuestUploadError);
        expect(error.code).toBe('stalled');
        expect(error.message).toBe('The upload stopped. Check your internet connection and try again.');
    });

    it('lets a slow upload that keeps moving go on', async () => {
        const sent = transferGuestUpload('p', file);
        vi.advanceTimersByTime(GUEST_UPLOAD_STALL_MS - 1);
        lastTask().progress(10, 1000);
        vi.advanceTimersByTime(GUEST_UPLOAD_STALL_MS - 1);
        expect(lastTask().cancel).not.toHaveBeenCalled();
        lastTask().finish();
        await expect(sent).resolves.toBeUndefined();
    });

    it('leaves no timer behind once it has settled', async () => {
        const sent = transferGuestUpload('p', file);
        lastTask().finish();
        await sent;
        expect(vi.getTimerCount()).toBe(0);
    });

    it('says why Storage refused, in words a driver can act on', async () => {
        const sent = transferGuestUpload('p', file);
        lastTask().fail({ code: 'storage/unauthorized', message: "Firebase Storage: User does not have permission to access 'p'." });
        await expect(sent).rejects.toMatchObject({
            code: 'refused',
            message: 'This file could not be accepted. Use a photo or a PDF under 20 MB.',
        });
    });
});

describe('toGuestUploadError', () => {
    it.each([
        ['functions/resource-exhausted', 'busy', 'Too many uploads in a short time. Wait a minute and try again.'],
        ['storage/retry-limit-exceeded', 'stalled', 'The upload stopped. Check your internet connection and try again.'],
        ['storage/unknown', 'failed', 'Upload failed. Please try again.'],
        [undefined, 'failed', 'Upload failed. Please try again.'],
    ])('reads %s as %s', (code, expected, message) => {
        const error = toGuestUploadError(Object.assign(new Error('internal'), { code }));
        expect(error.code).toBe(expected);
        expect(error.message).toBe(message);
        expect(error.cause.message).toBe('internal');
    });

    it('keeps one that already is', () => {
        const error = new GuestUploadError('too-large');
        expect(toGuestUploadError(error)).toBe(error);
    });
});
