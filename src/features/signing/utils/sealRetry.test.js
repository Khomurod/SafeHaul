/**
 * When the Documents workspace offers "Retry seal": a seal that failed, or one
 * left unfinished ten minutes after the signing or the last retry, as
 * `retrySealDocument` decides (`functions/shared/sealAttempts.js`). The server
 * has the last word; this only chooses whether to show the button.
 */
import { describe, expect, it } from 'vitest';
import { canRetrySeal, sealLeftUnfinished } from './sealRetry';

const NOW = Date.UTC(2026, 10, 4, 15, 0, 0);
const MINUTE = 60 * 1000;
const timestamp = (minutesAgo) => ({ seconds: Math.floor((NOW - minutesAgo * MINUTE) / 1000), nanoseconds: 0 });
const firestoreTimestamp = (minutesAgo) => ({ toMillis: () => NOW - minutesAgo * MINUTE });

describe('canRetrySeal', () => {
    it('offers a retry for a seal that failed', () => {
        expect(canRetrySeal({ status: 'error_sealing' }, NOW)).toBe(true);
    });

    it.each([
        ['signed eleven minutes ago', { signedAt: timestamp(11) }, true],
        ['signed eleven minutes ago, as the SDK reads it', { signedAt: firestoreTimestamp(11) }, true],
        ['signed two minutes ago', { signedAt: timestamp(2) }, false],
        ['signed long ago, retried two minutes ago', { signedAt: timestamp(90), sealAttempts: [{ at: firestoreTimestamp(2) }] }, false],
        ['signed long ago, retried eleven minutes ago', { signedAt: timestamp(90), sealAttempts: [{ at: timestamp(11) }] }, true],
        ['with no time it started', {}, false],
    ])('for a document still sealing, %s: %s', (_label, extra, expected) => {
        const document = { status: 'pending_seal', ...extra };
        expect(canRetrySeal(document, NOW)).toBe(expected);
        expect(sealLeftUnfinished(document, NOW)).toBe(expected);
    });

    it.each(['signed', 'sent', 'voided', 'processing', undefined])('offers none for a document that is %s', (status) => {
        expect(canRetrySeal({ status, signedAt: timestamp(60) }, NOW)).toBe(false);
    });

    it('offers none without a document', () => {
        expect(canRetrySeal(null, NOW)).toBe(false);
    });
});
