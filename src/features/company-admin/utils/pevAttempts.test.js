import { describe, expect, it } from 'vitest';
import { attemptWhen } from './pevAttempts';

// Midday UTC, so the day is the same in every US time zone.
const NOON = '2026-03-07T12:00:00.000Z';

describe('attemptWhen', () => {
    it('dates a recorded call, fax or note by its day alone, in the app\'s one date style (K3)', () => {
        for (const attempt of ['call', 'fax', 'note']) {
            expect(attemptWhen({ timestamp: NOON, attempt })).toBe('Mar 7, 2026');
        }
    });

    it('dates any other entry by its day and time', () => {
        expect(attemptWhen({ timestamp: NOON, attempt: 'email' })).toMatch(/^Mar 7, 2026, \d{2}:\d{2} (AM|PM)$/);
    });

    it('gives the day alone when asked to', () => {
        expect(attemptWhen({ timestamp: NOON, attempt: 'email' }, { withTime: false })).toBe('Mar 7, 2026');
    });

    it('gives nothing for an entry without a usable time', () => {
        expect(attemptWhen({ timestamp: 'not a time' })).toBe('');
        expect(attemptWhen({})).toBe('');
        expect(attemptWhen(undefined)).toBe('');
    });
});
