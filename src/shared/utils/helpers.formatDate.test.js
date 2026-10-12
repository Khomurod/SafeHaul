/**
 * `formatDate` shows a stored calendar date as that date, in every time zone.
 *
 * A plain `YYYY-MM-DD` (a date of birth, a licence expiry, a violation) was
 * parsed as midnight UTC and shown in the browser's zone, so west of UTC it
 * read a day early: a driver born on 14 May 1990 showed "May 13, 1990" to a
 * recruiter in Chicago. A stored month (`YYYY-MM`) read as the last day of the
 * month before. An instant is still shown on the viewer's own day.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatDate } from './helpers';

let zone;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
});

afterEach(() => {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

describe('formatDate west of UTC', () => {
    it('shows a stored calendar date as that day', () => {
        expect(formatDate('1990-05-14')).toBe('May 14, 1990');
        expect(formatDate(' 2027-01-01 ')).toBe('Jan 1, 2027');
    });

    it('shows a stored month as that month', () => {
        expect(formatDate('2027-05')).toBe('May 2027');
    });

    it('shows no time for a calendar date, which has none', () => {
        expect(formatDate('1990-05-14', true)).toBe('May 14, 1990');
    });

    it('still shows an instant on the viewer\'s own day', () => {
        // 01:30 UTC on 1 November is 8:30 pm on 31 October in Chicago.
        expect(formatDate('2026-11-01T01:30:00Z')).toBe('Oct 31, 2026');
        expect(formatDate({ toDate: () => new Date('2026-11-01T01:30:00Z') })).toBe('Oct 31, 2026');
    });

    it('still refuses what is not a date', () => {
        expect(formatDate('2026-02-30')).toBe('--');
        expect(formatDate('2026-13')).toBe('--');
        expect(formatDate('not a date')).toBe('--');
        expect(formatDate('')).toBe('--');
    });
});
