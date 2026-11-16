import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSignedStatus, rememberSignedHere, signedHereAt } from './alreadySigned';

describe('isSignedStatus', () => {
    it.each(['pending_seal', 'signed', 'sealed', 'completed', 'error_sealing'])('reads %s as signed', (status) => {
        expect(isSignedStatus(status)).toBe(true);
    });

    it.each(['sent', 'opened', 'processing', 'voided', undefined])('reads %s as not signed', (status) => {
        // `processing` is a submission that may have hung; the server lets it be sent again.
        expect(isSignedStatus(status)).toBe(false);
    });
});

describe('the note that this device signed a document', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => vi.restoreAllMocks());

    it('keeps the time, per company and request, and nothing else', () => {
        rememberSignedHere('co1', 'req1', new Date('2026-11-02T15:00:00.000Z'));
        expect(signedHereAt('co1', 'req1')).toBe('2026-11-02T15:00:00.000Z');
        expect(signedHereAt('co1', 'req2')).toBeNull();
        expect(signedHereAt('co2', 'req1')).toBeNull();
        expect(Object.keys(localStorage)).toEqual(['signing_signed_v1:co1:req1']);
    });

    it('reads a value that is not a time as no note', () => {
        localStorage.setItem('signing_signed_v1:co1:req1', 'yes');
        expect(signedHereAt('co1', 'req1')).toBeNull();
    });

    it('does without storage when the browser refuses it', () => {
        vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
        expect(() => rememberSignedHere('co1', 'req1')).not.toThrow();
        expect(signedHereAt('co1', 'req1')).toBeNull();
    });
});
