import { describe, expect, it } from 'vitest';
import { aiReadErrorMessage } from './aiReadErrors';

const FALLBACK = 'Reading did not finish. Please try again.';

describe('aiReadErrorMessage', () => {
    it("shows the server's own sentence", () => {
        const error = { code: 'functions/unavailable', message: 'AI auto-fill is temporarily unavailable. Please try again in a few minutes.' };
        expect(aiReadErrorMessage(error, FALLBACK)).toBe(error.message);
    });

    it.each(['deadline-exceeded', 'internal', 'unavailable'])(
        'replaces the bare code "%s" the web SDK reports when the server never answered',
        (code) => {
            expect(aiReadErrorMessage({ code: `functions/${code}`, message: code }, FALLBACK)).toBe(FALLBACK);
        },
    );

    it.each([['internal', 'INTERNAL'], ['deadline-exceeded', 'DEADLINE_EXCEEDED']])(
        'replaces "%s" spelt as the status the server sent, "%s"',
        (code, status) => {
            // An unhandled error in a function reaches the browser as message
            // "INTERNAL"; a status with no message, as the status itself.
            expect(aiReadErrorMessage({ code: `functions/${code}`, message: status }, FALLBACK)).toBe(FALLBACK);
        },
    );

    it('replaces an empty or missing message', () => {
        expect(aiReadErrorMessage({ code: 'functions/internal', message: '  ' }, FALLBACK)).toBe(FALLBACK);
        expect(aiReadErrorMessage(undefined, FALLBACK)).toBe(FALLBACK);
        expect(aiReadErrorMessage(null, FALLBACK)).toBe(FALLBACK);
    });

    it("keeps a message of the browser's own, which has no code", () => {
        expect(aiReadErrorMessage(new Error('Company is missing. Please refresh and try again.'), FALLBACK))
            .toBe('Company is missing. Please refresh and try again.');
    });
});
