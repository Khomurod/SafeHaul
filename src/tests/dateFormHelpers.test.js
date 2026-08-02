import { describe, it, expect } from 'vitest';
import {
    daysInMonth,
    parseIsoDateParts,
    buildIsoDate,
    formatIsoDateUs,
    parseMonthYear,
    formatMonthYearIso,
    formatMonthYearUs,
    ageFromIsoDate,
} from '../shared/utils/dateFormHelpers';

describe('dateFormHelpers', () => {
    it('daysInMonth handles leap years', () => {
        expect(daysInMonth(2024, 2)).toBe(29);
        expect(daysInMonth(2023, 2)).toBe(28);
        expect(daysInMonth(2023, 4)).toBe(30);
    });

    it('parseIsoDateParts validates calendar dates', () => {
        expect(parseIsoDateParts('2020-06-15')).toEqual({ year: 2020, month: 6, day: 15 });
        expect(parseIsoDateParts('2023-02-29')).toBe(null);
        expect(parseIsoDateParts('not-a-date')).toBe(null);
    });

    it('buildIsoDate clamps day to month length', () => {
        expect(buildIsoDate(2023, 2, 31)).toBe('2023-02-28');
    });

    it('formatIsoDateUs renders US-style', () => {
        expect(formatIsoDateUs('1990-01-08')).toBe('1/8/1990');
    });

    it('parseMonthYear accepts YYYY-MM and legacy mm/yyyy', () => {
        expect(parseMonthYear('2021-03')).toEqual({ year: 2021, month: 3 });
        expect(parseMonthYear('11/2019')).toEqual({ year: 2019, month: 11 });
        expect(parseMonthYear('')).toEqual({ year: '', month: '' });
    });

    it('formatMonthYearIso and formatMonthYearUs round-trip', () => {
        expect(formatMonthYearIso(2018, 7)).toBe('2018-07');
        expect(formatMonthYearUs('2018-07')).toBe('07/2018');
    });

    it('ageFromIsoDate computes full years', () => {
        const ref = new Date(2026, 4, 7); // May 7 2026
        expect(ageFromIsoDate('2005-05-06', ref)).toBe(21);
        expect(ageFromIsoDate('2005-05-08', ref)).toBe(20);
    });
});
