// The employment window ends in the month of the applicant's own day, the day the
// server judges the application on, not in the month UTC has reached: on a month's
// last evening in the US, UTC is already in the next one, and the wizard blocked a
// history the server would have accepted.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeEmploymentCoverage } from '@shared/utils/employmentCoverage';
import { employmentCoverageOptions, evaluateApplicationRules } from './applicationRules';

const RULES = { employmentHistoryEnforcement: 'block', employmentHistoryMinimumYears: 1 };
// Twelve months that end in October, and nothing after.
const HISTORY = { employers: [{ companyName: 'Acme', startDate: '2025-11', endDate: '2026-10' }] };

let zone;

beforeEach(() => {
    zone = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    vi.useFakeTimers();
    // 8:30 pm on 31 October in Chicago, 1:30 am on 1 November in UTC.
    vi.setSystemTime(new Date('2026-11-01T01:30:00Z'));
});

afterEach(() => {
    vi.useRealTimers();
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
});

describe('on the last evening of a month in the US', () => {
    it('the wizard counts the month the applicant is in, as the server does', () => {
        const verdict = evaluateApplicationRules({ rules: RULES, formData: HISTORY });
        expect(verdict.blocking).toEqual([]);
    });

    it('the employment page counts the same months', () => {
        const coverage = computeEmploymentCoverage(HISTORY, employmentCoverageOptions(RULES));
        expect(coverage).toMatchObject({ windowStart: '2025-11', windowEnd: '2026-10', isComplete: true });
    });

    it('a day given is still the day used', () => {
        const coverage = computeEmploymentCoverage(HISTORY, employmentCoverageOptions(RULES, new Date(2026, 11, 1, 9)));
        expect(coverage).toMatchObject({ windowEnd: '2026-12', isComplete: false });
    });
});
