import { afterEach, describe, expect, it, vi } from 'vitest';
import { plainErrorMessage } from './plainErrorMessage';

/** A Firebase SDK error: a subclass of `Error` with a `code`, as the SDK throws. */
class FirebaseError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'FirebaseError';
    }
}

const FAILED = 'The note could not be saved.';
const UNKNOWN = `${FAILED} Please try again. If it keeps happening, contact support.`;

afterEach(() => {
    vi.restoreAllMocks();
});

describe('plainErrorMessage — what a person reads', () => {
    it.each([
        ['permission-denied', 'Missing or insufficient permissions.',
            `${FAILED} You do not have permission to do this. If you think you should, ask your company admin.`],
        ['unavailable', 'Failed to get document because the client is offline.',
            `${FAILED} Check your internet connection and try again.`],
        ['deadline-exceeded', 'Deadline expired before operation could complete.',
            `${FAILED} Check your internet connection and try again.`],
        ['unauthenticated', 'The caller does not have valid authentication credentials.',
            `${FAILED} Your session has ended. Sign in again, then try again.`],
        ['resource-exhausted', 'Quota exceeded.',
            `${FAILED} Too many requests right now. Wait a minute, then try again.`],
        ['not-found', 'No document to update: projects/p/databases/(default)/documents/x',
            `${FAILED} It may have been removed. Refresh the page and try again.`],
        ['storage/unauthorized', 'Firebase Storage: User does not have permission to access ‘x’. (storage/unauthorized)',
            `${FAILED} You do not have permission to do this. If you think you should, ask your company admin.`],
        ['storage/retry-limit-exceeded', 'Firebase Storage: Max retry time for operation exceeded.',
            `${FAILED} Check your internet connection and try again.`],
        ['auth/network-request-failed', 'Firebase: Error (auth/network-request-failed).',
            `${FAILED} Check your internet connection and try again.`],
        ['auth/too-many-requests', 'Firebase: Error (auth/too-many-requests).',
            `${FAILED} Too many requests right now. Wait a minute, then try again.`],
    ])('says what to do for a Firebase "%s", not its text', (code, message, expected) => {
        expect(plainErrorMessage(new FirebaseError(code, message), FAILED)).toBe(expected);
    });

    it('hides a missing index behind the plain sentence for an unknown failure', () => {
        const error = new FirebaseError(
            'failed-precondition',
            'The query requires an index. You can create it here: https://console.firebase.google.com/…',
        );
        expect(plainErrorMessage(error, FAILED)).toBe(UNKNOWN);
    });

    it.each([
        ['an unknown Firebase code', new FirebaseError('internal', 'INTERNAL ASSERTION FAILED: Unexpected state')],
        ['a bug in the code', new TypeError("Cannot read properties of undefined (reading 'id')")],
        ['a string', 'boom'],
        ['a plain object', { message: 'Some raw text' }],
        ['nothing', undefined],
        ['null', null],
    ])('gives %s the generic plain sentence', (_label, error) => {
        expect(plainErrorMessage(error, FAILED)).toBe(UNKNOWN);
    });

    it('says something went wrong when the caller names nothing', () => {
        expect(plainErrorMessage(new Error('oops'))).toBe(
            'Something went wrong. Please try again. If it keeps happening, contact support.',
        );
    });

    it('treats a fetch that never got an answer as a connection problem', () => {
        expect(plainErrorMessage(new TypeError('Failed to fetch'), FAILED))
            .toBe(`${FAILED} Check your internet connection and try again.`);
    });

    it('treats any failure while the browser is offline as a connection problem', () => {
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect(plainErrorMessage(new FirebaseError('internal', 'INTERNAL'), FAILED))
            .toBe(`${FAILED} Check your internet connection and try again.`);
    });
});

describe('plainErrorMessage — sentences already written for people', () => {
    it.each([
        'invalid-argument',
        'failed-precondition',
        'not-found',
        'already-exists',
        'aborted',
        'out-of-range',
        'permission-denied',
        'resource-exhausted',
    ])('shows the server\'s own sentence for a callable refusal "%s"', (code) => {
        const error = new FirebaseError(`functions/${code}`, 'This document has already been signed.');
        expect(plainErrorMessage(error, FAILED)).toBe('This document has already been signed.');
    });

    it.each([
        ['internal', 'Delete failed: 7 PERMISSION_DENIED: Missing or insufficient permissions.'],
        ['unknown', 'Request failed with status code 500'],
    ])('does not show a callable "%s" text, which is often a raw error passed on', (code, message) => {
        expect(plainErrorMessage(new FirebaseError(`functions/${code}`, message), FAILED)).toBe(UNKNOWN);
    });

    it('maps a callable refusal that carries only its code', () => {
        const error = new FirebaseError('functions/permission-denied', 'permission-denied');
        expect(plainErrorMessage(error, FAILED)).toBe(
            `${FAILED} You do not have permission to do this. If you think you should, ask your company admin.`,
        );
    });

    it('maps a callable that ran out of time to a connection problem', () => {
        const error = new FirebaseError('functions/deadline-exceeded', 'deadline-exceeded');
        expect(plainErrorMessage(error, FAILED)).toBe(`${FAILED} Check your internet connection and try again.`);
    });

    it('shows a sentence the app raised itself as written', () => {
        const error = new Error("Failed to fetch sheet. Make sure the sheet has 'Anyone with the link' access enabled.");
        expect(plainErrorMessage(error, FAILED)).toBe(error.message);
    });

    it.each([
        ['a code word', 'load_failed'],
        ['a wrapped Firestore message', 'Upload failed: Missing or insufficient permissions.'],
        ['a wrapped Firebase message', 'Firebase: Error (auth/invalid-credential).'],
        ['a wrapped index message', 'The query requires an index.'],
        ['an empty message', ''],
    ])('does not pass on %s raised as a plain Error', (_label, message) => {
        expect(plainErrorMessage(new Error(message), FAILED)).toBe(UNKNOWN);
    });

    it('does not pass on a plain Error that carries a code', () => {
        const error = Object.assign(new Error('Something specific went wrong'), { code: 'permission-denied' });
        expect(plainErrorMessage(error, FAILED)).toBe(
            `${FAILED} You do not have permission to do this. If you think you should, ask your company admin.`,
        );
    });
});
