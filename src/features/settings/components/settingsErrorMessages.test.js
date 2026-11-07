/**
 * What Settings → SMS opt-outs and Settings → API Keys say when a call fails: the
 * server's own sentence for a refusal it words for the screen, a fixed plain
 * sentence for the rest, and never a bare code (the answer when a function is
 * not on the server yet).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

import { optOutErrorMessage } from './sms/smsOptOutService';
import { apiKeyErrorMessage } from './api-keys/apiKeysService';

const failure = (code, message) => Object.assign(new Error(message), { code });

describe('optOutErrorMessage', () => {
    it('keeps the messages it already gave', () => {
        expect(optOutErrorMessage(failure('functions/invalid-argument', 'That number is not a US phone number.'), 'Not added.'))
            .toBe('That number is not a US phone number.');
        expect(optOutErrorMessage(failure('functions/permission-denied', 'x'), 'Not removed.', 'Only a Company Admin can remove a number.'))
            .toBe('Only a Company Admin can remove a number.');
        expect(optOutErrorMessage(failure('functions/permission-denied', 'x'), 'Not added.'))
            .toBe('You do not have access to this company’s settings. Ask a Company Admin.');
        expect(optOutErrorMessage(failure('functions/internal', 'INTERNAL'), 'Not added.'))
            .toBe('Something went wrong on our side. Try again in a minute.');
        expect(optOutErrorMessage(undefined, 'Not added.')).toBe('Not added.');
    });

    it('never shows a bare code', () => {
        expect(optOutErrorMessage(failure('functions/invalid-argument', 'invalid-argument'), 'Not added.')).toBe('Not added.');
    });
});

describe('apiKeyErrorMessage', () => {
    it('keeps the messages it already gave', () => {
        expect(apiKeyErrorMessage(failure('functions/failed-precondition', 'This company already has five keys.'), 'Not made.'))
            .toBe('This company already has five keys.');
        expect(apiKeyErrorMessage(failure('functions/not-found', 'That key was already revoked.'), 'Not revoked.'))
            .toBe('That key was already revoked.');
        expect(apiKeyErrorMessage(failure('functions/deadline-exceeded', 'deadline-exceeded'), 'Not made.'))
            .toBe('That took too long. Try again.');
        expect(apiKeyErrorMessage(failure('functions/aborted', 'x'), 'Not made.')).toBe('Not made.');
    });

    it('never shows a bare code', () => {
        for (const message of ['not-found', 'NOT_FOUND', 'resource-exhausted', 'invalid-argument']) {
            const code = `functions/${message.toLowerCase().replace(/_/g, '-')}`;
            expect(apiKeyErrorMessage(failure(code, message), 'Not made.')).toBe('Not made.');
        }
    });
});
