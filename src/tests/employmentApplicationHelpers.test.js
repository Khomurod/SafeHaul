import { describe, it, expect } from 'vitest';
import { employerRowHasVerifierContact, endedBeforeLastThreeYears } from '../shared/utils/employmentApplicationHelpers';

describe('employerRowHasVerifierContact', () => {
    it('returns true for 10-digit company phone', () => {
        expect(
            employerRowHasVerifierContact({
                phone: '(555) 123-4567',
            })
        ).toBe(true);
    });

    it('returns true for supervisor phone', () => {
        expect(
            employerRowHasVerifierContact({
                supervisorPhone: '5559876543',
            })
        ).toBe(true);
    });

    it('returns true for valid emails', () => {
        expect(
            employerRowHasVerifierContact({
                companyEmail: 'hr@example.com',
            })
        ).toBe(true);
        expect(
            employerRowHasVerifierContact({
                supervisorEmail: 'boss@example.com',
            })
        ).toBe(true);
    });

    it('returns false when nothing usable is provided', () => {
        expect(employerRowHasVerifierContact({ phone: '555', companyEmail: 'bad' })).toBe(false);
        expect(employerRowHasVerifierContact({})).toBe(false);
    });
});

describe('endedBeforeLastThreeYears', () => {
    const TODAY = new Date('2026-10-06T12:00:00Z');

    it('is false for a job still running or with no end date yet', () => {
        expect(endedBeforeLastThreeYears({ startDate: '2019-01-01', endDate: '' }, TODAY)).toBe(false);
        expect(endedBeforeLastThreeYears({ startDate: '2019-01-01', endDate: 'Present' }, TODAY)).toBe(false);
        expect(endedBeforeLastThreeYears({}, TODAY)).toBe(false);
        expect(endedBeforeLastThreeYears(undefined, TODAY)).toBe(false);
    });

    it('is false for a job that ended within the past three years', () => {
        expect(endedBeforeLastThreeYears({ endDate: '2025-06-30' }, TODAY)).toBe(false);
        expect(endedBeforeLastThreeYears({ endDate: '2024-02' }, TODAY)).toBe(false);
    });

    it('counts the month three years back as inside, so no job is left out by days', () => {
        expect(endedBeforeLastThreeYears({ endDate: '2023-10-01' }, TODAY)).toBe(false);
        expect(endedBeforeLastThreeYears({ endDate: '2023-09-30' }, TODAY)).toBe(true);
    });

    it('is true for a job that ended before the three years', () => {
        expect(endedBeforeLastThreeYears({ endDate: '2019-05-31' }, TODAY)).toBe(true);
        expect(endedBeforeLastThreeYears({ endDate: '2021-12' }, TODAY)).toBe(true);
    });

    it('never leaves a job out on a date it cannot read', () => {
        expect(endedBeforeLastThreeYears({ endDate: 'sometime in 2019' }, TODAY)).toBe(false);
    });
});
