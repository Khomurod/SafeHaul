import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    HIRED_AT_RECORDED_FROM,
    hiredLabel,
    hiredSince,
    monthKey,
    monthRange,
    periodDescription,
    periodRange,
    validPeriod,
} from './dashboardPeriods';

/**
 * The months the hiring brief counts and the applications list opens on, on a
 * viewer's clock in Chicago (UTC-6 in November, UTC-5 in October).
 */
describe('the months of the hiring brief, on a clock in Chicago', () => {
    let zone;

    beforeEach(() => {
        zone = process.env.TZ;
        process.env.TZ = 'America/Chicago';
    });

    afterEach(() => {
        if (zone === undefined) delete process.env.TZ;
        else process.env.TZ = zone;
    });

    it('names the viewer\'s own month', () => {
        // 1 Dec 03:00 UTC is still 30 Nov in Chicago.
        expect(monthKey(new Date('2026-12-01T03:00:00Z'))).toBe('2026-11');
        expect(monthKey(new Date('2026-12-01T06:00:00Z'))).toBe('2026-12');
    });

    it('covers a month from its local midnight to the next month\'s', () => {
        expect(monthRange('2026-11')).toEqual({
            start: new Date('2026-11-01T05:00:00Z'),
            end: new Date('2026-12-01T06:00:00Z'),
        });
        expect(monthRange('2026-12').end).toEqual(new Date('2027-01-01T06:00:00Z'));
    });

    it.each(['', '2026-13', '2026-00', '2026-1', 'November', null, undefined])('is no month for %j', (value) => {
        expect(monthRange(value)).toBeNull();
    });

    it('started recording hire dates on one named day', () => {
        expect(HIRED_AT_RECORDED_FROM).toBe('2026-11-06');
        expect(hiredSince('2026-11')).toEqual(new Date('2026-11-06T06:00:00Z'));
    });

    it('counts the hires of the first month from that day, and every later month whole', () => {
        expect(hiredLabel('2026-11')).toBe('hired since Nov 6');
        expect(hiredLabel('2026-12')).toBe('hired this month');
        expect(hiredLabel('2027-03')).toBe('hired this month');
        expect(hiredSince('2026-12')).toBeNull();

        expect(periodRange({ field: 'hiredAt', month: '2026-11' })).toEqual({
            start: new Date('2026-11-06T06:00:00Z'),
            end: new Date('2026-12-01T06:00:00Z'),
        });
        expect(periodRange({ field: 'hiredAt', month: '2026-12' })).toEqual(monthRange('2026-12'));
    });

    it('counts the applications added in the whole month, whatever day hire dates began', () => {
        expect(periodRange({ field: 'createdAt', month: '2026-11' })).toEqual(monthRange('2026-11'));
    });

    it('covers nothing of hires in a month before hire dates began', () => {
        const range = periodRange({ field: 'hiredAt', month: '2026-10' });
        expect(range.start >= range.end).toBe(true);
    });

    it('keeps only a period it knows', () => {
        expect(validPeriod({ field: 'createdAt', month: '2026-11', extra: 1 })).toEqual({ field: 'createdAt', month: '2026-11' });
        expect(validPeriod({ field: 'updatedAt', month: '2026-11' })).toBeNull();
        expect(validPeriod({ field: 'hiredAt', month: 'soon' })).toBeNull();
        expect(validPeriod('2026-11')).toBeNull();
        expect(validPeriod(null)).toBeNull();
        expect(periodRange({ field: 'statusChangedAt', month: '2026-11' })).toBeNull();
    });

    it('says what a list opened on a period shows', () => {
        expect(periodDescription({ field: 'createdAt', month: '2026-11' })).toBe('Applications added in November 2026');
        expect(periodDescription({ field: 'hiredAt', month: '2026-11' })).toBe('Applications hired since Nov 6, 2026');
        expect(periodDescription({ field: 'hiredAt', month: '2027-02' })).toBe('Applications hired in February 2027');
        expect(periodDescription(null)).toBe('');
    });
});
