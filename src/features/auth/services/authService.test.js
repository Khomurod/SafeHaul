import { beforeEach, describe, expect, it, vi } from 'vitest';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

const auth = vi.hoisted(() => ({
    signInWithEmailAndPassword: vi.fn(async () => ({ user: { uid: 'u1' } })),
    sendPasswordResetEmail: vi.fn(async () => undefined),
}));

vi.mock('firebase/auth', () => auth);
vi.mock('@lib/firebase', () => ({ auth: {} }));

const { loginUser, resetPassword } = await import('./authService');

/** A Firebase Auth error as the SDK throws it: an `Error` subclass with a code. */
class FirebaseError extends Error {
    constructor(code) {
        super(`Firebase: Error (${code}).`);
        this.code = code;
    }
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authService — what the sign-in screen reads', () => {
    it.each([
        ['auth/invalid-credential', 'Invalid email or password.'],
        ['auth/too-many-requests', 'Too many failed attempts. Please try again later.'],
    ])('keeps its own sentence for %s', async (code, sentence) => {
        auth.signInWithEmailAndPassword.mockRejectedValueOnce(new FirebaseError(code));
        const failure = await loginUser('a@example.test', 'pw').catch((error) => error);
        expect(plainErrorMessage(failure, 'You could not be signed in.')).toBe(sentence);
    });

    it('passes on a lost connection with its code, so the screen says to check the connection', async () => {
        auth.signInWithEmailAndPassword.mockRejectedValueOnce(new FirebaseError('auth/network-request-failed'));
        const failure = await loginUser('a@example.test', 'pw').catch((error) => error);
        expect(plainErrorMessage(failure, 'You could not be signed in.'))
            .toBe('You could not be signed in. Check your internet connection and try again.');
    });

    it('never shows the SDK text of a failure it does not name', async () => {
        auth.sendPasswordResetEmail.mockRejectedValueOnce(new FirebaseError('auth/internal-error'));
        const failure = await resetPassword('a@example.test').catch((error) => error);
        expect(plainErrorMessage(failure, 'The reset email could not be sent.'))
            .toBe('The reset email could not be sent. Please try again. If it keeps happening, contact support.');
    });
});
