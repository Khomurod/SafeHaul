const {
  REQUIRED_COVERAGE_MONTHS,
  computeEmploymentCoverage,
  formatMonthIndex,
  isOngoing,
  mergeSpans,
  parseMonthIndex,
  spanKind,
  toSpan,
} = require('../../shared/employmentCoverage');

// A fixed reference month keeps every expectation deterministic.
// Reference 2026-06 -> the 36-month window is 2023-07 .. 2026-06 inclusive.
const REF = '2026-06-15T00:00:00.000Z';
const coverage = (history, opts = {}) =>
  computeEmploymentCoverage(history, { referenceDate: REF, ...opts });

describe('parseMonthIndex accepts the shapes the form produces', () => {
  it('reads YYYY-MM and YYYY-MM-DD as the same month', () => {
    expect(parseMonthIndex('2024-03')).toBe(parseMonthIndex('2024-03-17'));
  });

  it('orders months arithmetically across a year boundary', () => {
    expect(parseMonthIndex('2025-01') - parseMonthIndex('2024-12')).toBe(1);
  });

  it('round-trips through formatMonthIndex', () => {
    expect(formatMonthIndex(parseMonthIndex('2024-03'))).toBe('2024-03');
  });

  it('tolerates a single-digit month', () => {
    expect(parseMonthIndex('2024-3')).toBe(parseMonthIndex('2024-03'));
  });

  // Returning null rather than guessing: an unreadable date must never be
  // treated as covering time the driver did not claim.
  it.each([null, undefined, '', '   ', 'not a date', '2024-13', '2024-00'])(
    'returns null for unusable input %p', (input) => {
      expect(parseMonthIndex(input)).toBeNull();
    });
});

describe('ongoing periods close at the reference month', () => {
  it.each(['', '   ', 'Present', 'current', 'ONGOING', 'now', 'to date', null, undefined])(
    'treats %p as ongoing', (value) => {
      expect(isOngoing(value)).toBe(true);
    });

  it('does not treat a real date as ongoing', () => {
    expect(isOngoing('2025-04')).toBe(false);
  });

  it('extends an ongoing job to the reference month', () => {
    const span = toSpan({ startDate: '2026-01', endDate: 'Present' }, parseMonthIndex('2026-06'));
    expect(formatMonthIndex(span.end)).toBe('2026-06');
  });
});

describe('span extraction', () => {
  it('accepts the alternative field names in the data', () => {
    const now = parseMonthIndex('2026-06');
    for (const record of [
      { startDate: '2024-01', endDate: '2024-06' },
      { start: '2024-01', end: '2024-06' },
      { from: '2024-01', to: '2024-06' },
      { dateFrom: '2024-01', dateTo: '2024-06' },
    ]) {
      expect(toSpan(record, now)).toEqual({
        start: parseMonthIndex('2024-01'), end: parseMonthIndex('2024-06'),
      });
    }
  });

  it('repairs a reversed date pair instead of discarding the period', () => {
    const span = toSpan({ startDate: '2024-06', endDate: '2024-01' }, 0);
    expect(formatMonthIndex(span.start)).toBe('2024-01');
    expect(formatMonthIndex(span.end)).toBe('2024-06');
  });

  it('returns null when the start cannot be placed on a calendar', () => {
    expect(toSpan({ endDate: '2024-06' }, 0)).toBeNull();
    expect(toSpan(null, 0)).toBeNull();
  });

  it('classifies the kind of period accounted for', () => {
    expect(spanKind({ type: 'unemployment' }, 'employment')).toBe('unemployment');
    expect(spanKind({ isUnemployment: true }, 'employment')).toBe('unemployment');
    expect(spanKind({ type: 'CDL School' }, 'employment')).toBe('schooling');
    expect(spanKind({ type: 'Military' }, 'employment')).toBe('military');
    expect(spanKind({}, 'employment')).toBe('employment');
  });
});

describe('mergeSpans', () => {
  it('joins overlapping and touching spans', () => {
    expect(mergeSpans([{ start: 0, end: 5 }, { start: 3, end: 8 }])).toEqual([{ start: 0, end: 8 }]);
    // Jan-Mar then Apr-Jun is continuous employment, not two gapped periods.
    expect(mergeSpans([{ start: 0, end: 2 }, { start: 3, end: 5 }])).toEqual([{ start: 0, end: 5 }]);
  });

  it('keeps genuinely separate spans apart', () => {
    expect(mergeSpans([{ start: 0, end: 2 }, { start: 5, end: 6 }]))
      .toEqual([{ start: 0, end: 2 }, { start: 5, end: 6 }]);
  });

  it('is order independent', () => {
    expect(mergeSpans([{ start: 5, end: 6 }, { start: 0, end: 2 }]))
      .toEqual([{ start: 0, end: 2 }, { start: 5, end: 6 }]);
  });
});

describe('three-year coverage', () => {
  it('defaults to a 36-month window ending at the reference month', () => {
    const result = coverage({});
    expect(result.requiredMonths).toBe(REQUIRED_COVERAGE_MONTHS);
    expect(result.windowStart).toBe('2023-07');
    expect(result.windowEnd).toBe('2026-06');
  });

  it('reports nothing covered, and one full gap, for an empty history', () => {
    const result = coverage({});
    expect(result.coveredMonths).toBe(0);
    expect(result.missingMonths).toBe(36);
    expect(result.isComplete).toBe(false);
    expect(result.gaps).toEqual([{ fromMonth: '2023-07', toMonth: '2026-06', months: 36 }]);
  });

  it('is complete when one ongoing job spans the whole window', () => {
    const result = coverage({ employers: [{ startDate: '2020-01', endDate: 'Present' }] });
    expect(result.coveredMonths).toBe(36);
    expect(result.isComplete).toBe(true);
    expect(result.gaps).toEqual([]);
  });

  it('clips history older than the window rather than over-counting it', () => {
    const result = coverage({ employers: [{ startDate: '1999-01', endDate: 'Present' }] });
    expect(result.coveredMonths).toBe(36);
  });

  it('finds the gap between two jobs', () => {
    const result = coverage({
      employers: [
        { startDate: '2023-07', endDate: '2024-06' },
        { startDate: '2024-10', endDate: 'Present' },
      ],
    });
    expect(result.isComplete).toBe(false);
    expect(result.gaps).toEqual([{ fromMonth: '2024-07', toMonth: '2024-09', months: 3 }]);
    expect(result.missingMonths).toBe(3);
  });

  it('closes a gap with a declared unemployment period', () => {
    const result = coverage({
      employers: [
        { startDate: '2023-07', endDate: '2024-06' },
        { startDate: '2024-10', endDate: 'Present' },
      ],
      unemploymentPeriods: [{ startDate: '2024-07', endDate: '2024-09', type: 'unemployment' }],
    });
    expect(result.isComplete).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(result.accountedKinds).toEqual(['employment', 'unemployment']);
  });

  it('accepts schooling and military service as accounting for time', () => {
    const result = coverage({
      schools: [{ startDate: '2023-07', endDate: '2024-06' }],
      military: [{ startDate: '2024-07', endDate: 'Present' }],
    });
    expect(result.isComplete).toBe(true);
    expect(result.accountedKinds).toEqual(['military', 'schooling']);
  });

  it('reports a leading gap when the earliest record starts inside the window', () => {
    const result = coverage({ employers: [{ startDate: '2025-01', endDate: 'Present' }] });
    expect(result.coveredMonths).toBe(18);
    expect(result.gaps).toEqual([{ fromMonth: '2023-07', toMonth: '2024-12', months: 18 }]);
  });

  it('reports a trailing gap when the most recent record ended a while ago', () => {
    const result = coverage({ employers: [{ startDate: '2023-07', endDate: '2025-12' }] });
    expect(result.gaps).toEqual([{ fromMonth: '2026-01', toMonth: '2026-06', months: 6 }]);
  });

  it('does not double count overlapping jobs', () => {
    const result = coverage({
      employers: [
        { startDate: '2024-01', endDate: '2024-12' },
        { startDate: '2024-06', endDate: '2025-06' },
      ],
    });
    // 2024-01..2025-06 inclusive is 18 months, not 13 + 13.
    expect(result.coveredMonths).toBe(18);
  });

  it('counts records it cannot place, so incomplete data is never mistaken for none', () => {
    const result = coverage({ employers: [{ companyName: 'Artificial Freight Co', position: 'Driver' }] });
    expect(result.unparseableRecords).toBe(1);
    expect(result.coveredMonths).toBe(0);
  });

  it('ignores empty rows the form leaves behind', () => {
    expect(coverage({ employers: [{}, null] }).unparseableRecords).toBe(0);
  });

  it('tolerates non-array history and a missing argument', () => {
    expect(() => coverage({ employers: 'nope', schools: null })).not.toThrow();
    expect(computeEmploymentCoverage().requiredMonths).toBe(REQUIRED_COVERAGE_MONTHS);
  });

  it('honours a custom window length', () => {
    const result = coverage({}, { requiredMonths: 12 });
    expect(result.requiredMonths).toBe(12);
    expect(result.windowStart).toBe('2025-07');
  });

  it('falls back to the default for a nonsensical window length', () => {
    expect(coverage({}, { requiredMonths: 0 }).requiredMonths).toBe(36);
    expect(coverage({}, { requiredMonths: -5 }).requiredMonths).toBe(36);
  });

  it('is deterministic for the same inputs', () => {
    const history = { employers: [{ startDate: '2024-01', endDate: '2025-01' }] };
    expect(coverage(history)).toEqual(coverage(history));
  });
});

// ---------------------------------------------------------------------------
// Shared vectors.
//
// The browser mirror in `src/shared/utils/employmentCoverage.js` runs this exact
// file through vitest. A change to either copy fails the other suite until the
// two implementations agree again — which is the point: the coverage a driver
// sees while filling the form and the coverage frozen into the submission
// snapshot must be the same number.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const impl = require('../../shared/employmentCoverage');

const vectors = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../shared/employmentCoverage.vectors.json'), 'utf8'),
);

describe('employmentCoverage — shared vectors', () => {
  for (const [fnName, cases] of Object.entries(vectors)) {
    if (fnName === '//') continue;
    describe(fnName, () => {
      it('is exported', () => {
        expect(typeof impl[fnName]).toBe('function');
      });
      cases.forEach((testCase, index) => {
        const args = Array.isArray(testCase.input) ? testCase.input : [testCase.input];
        it(`vector #${index}${testCase['//'] ? `: ${testCase['//']}` : ''}`, () => {
          expect(impl[fnName](...args)).toEqual(testCase.expected);
        });
      });
    });
  }
});
