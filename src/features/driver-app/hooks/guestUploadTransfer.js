/**
 * Sending one guest upload to Storage, and saying in plain words why one failed.
 *
 * `uploadBytes` reported no progress and could not be stopped, so the field drew
 * a made-up bar that sat at 90% for as long as a bad connection lasted, with no
 * way out; and a refusal reached the driver as Firebase's own sentence. A
 * resumable upload reports real progress and can be cancelled, an upload with no
 * bytes moving for `GUEST_UPLOAD_STALL_MS` is ended instead of retrying out of
 * sight for the SDK's ten minutes, and every failure is a `GuestUploadError`
 * whose message a driver can act on.
 */
import { ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from '@lib/firebase';

/** What `storage.rules` accepts for a guest upload (`isValidFile`): under 20 MB. */
export const GUEST_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** How long an upload may move no bytes before it is ended as stalled. */
export const GUEST_UPLOAD_STALL_MS = 45_000;

const MESSAGES = Object.freeze({
    'too-large': 'This file is larger than 20 MB. Choose a smaller file, or take a photo of the document instead.',
    'unsupported-type': 'This file type cannot be sent. Use a photo (JPG, PNG, WEBP or HEIC) or a PDF.',
    stalled: 'The upload stopped. Check your internet connection and try again.',
    busy: 'Too many uploads in a short time. Wait a minute and try again.',
    refused: 'This file could not be accepted. Use a photo or a PDF under 20 MB.',
    cancelled: 'Upload cancelled.',
    failed: 'Upload failed. Please try again.',
});

/** A failed guest upload. `code` is one of the keys of `MESSAGES`. */
export class GuestUploadError extends Error {
    constructor(code, cause) {
        super(MESSAGES[code] || MESSAGES.failed);
        this.name = 'GuestUploadError';
        this.code = MESSAGES[code] ? code : 'failed';
        this.cause = cause;
    }
}

/** Any failure of the reservation callable or of Storage, as a `GuestUploadError`. */
export function toGuestUploadError(error) {
    if (error instanceof GuestUploadError) return error;
    const code = String(error?.code || '');
    if (code === 'functions/resource-exhausted') return new GuestUploadError('busy', error);
    if (code === 'storage/unauthorized') return new GuestUploadError('refused', error);
    if (code === 'storage/retry-limit-exceeded') return new GuestUploadError('stalled', error);
    return new GuestUploadError('failed', error);
}

/**
 * Uploads `file` to `storagePath`, reporting progress as a fraction from 0 to 1.
 * Resolves once the file is stored. Rejects with a `GuestUploadError`: code
 * `cancelled` when `signal` aborts, `stalled` when no bytes moved for `stallMs`.
 */
export function transferGuestUpload(storagePath, file, {
    contentType,
    onProgress,
    signal,
    stallMs = GUEST_UPLOAD_STALL_MS,
} = {}) {
    if (signal?.aborted) return Promise.reject(new GuestUploadError('cancelled'));
    const task = uploadBytesResumable(ref(storage, storagePath), file, { contentType });
    return new Promise((resolve, reject) => {
        // Why this side stopped the task, so its `storage/canceled` reads right.
        let stoppedAs = null;
        let stallTimer = null;
        // Only bytes that moved count as progress: a state change without any
        // (a pause, a retry) does not keep a stalled upload alive.
        let bytesSent = 0;
        const stop = (reason) => {
            stoppedAs = reason;
            task.cancel();
        };
        const armStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => stop('stalled'), stallMs);
        };
        const onAbort = () => stop('cancelled');
        const settle = () => {
            clearTimeout(stallTimer);
            signal?.removeEventListener('abort', onAbort);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        armStallTimer();
        task.on(
            'state_changed',
            (snapshot) => {
                if (snapshot.bytesTransferred > bytesSent) {
                    bytesSent = snapshot.bytesTransferred;
                    armStallTimer();
                }
                if (snapshot.totalBytes > 0) onProgress?.(snapshot.bytesTransferred / snapshot.totalBytes);
            },
            (error) => {
                settle();
                reject(stoppedAs ? new GuestUploadError(stoppedAs, error) : toGuestUploadError(error));
            },
            () => {
                settle();
                onProgress?.(1);
                resolve();
            },
        );
    });
}
