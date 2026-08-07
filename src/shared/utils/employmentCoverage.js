// src/shared/utils/employmentCoverage.js
//
// ESM mirror of `functions/shared/employmentCoverage.js`.
//
// The driver's wizard needs the same three-year coverage answer in the browser
// that the submission snapshot records on the server, and `src/` cannot import
// from `functions/`. Both copies run the shared vectors in
// `functions/shared/employmentCoverage.vectors.json`, so editing one without the
// other fails the other suite — the same convention `searchNormalization` uses.
//
// Keep the two files structurally identical apart from module syntax.

/** Months of history the application must account for. */
export const REQUIRED_COVERAGE_MONTHS = 36;

/**
 * Parse the date shapes the form actually produces: `YYYY-MM`, `YYYY-MM-DD`,
 * and anything `Date` can read. Returns an absolute month index (year * 12 +
 * month) so spans are simple arithmetic, or null when unparseable.
 *
 * Returning null rather than guessing matters: an unreadable date must not be
 * silently treated as covering time the driver never claimed.
 */
export function parseMonthIndex(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const ym = /^(\d{4})-(\d{1,2})$/.exec(raw);
    if (ym) {
        const month = Number(ym[2]);
        if (month < 1 || month > 12) return null;
        return Number(ym[1]) * 12 + (month - 1);
    }

    const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
    if (ymd) {
        const month = Number(ymd[2]);
        if (month < 1 || month > 12) return null;
        return Number(ymd[1]) * 12 + (month - 1);
    }

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
}

/** Render an absolute month index back to `YYYY-MM` for display. */
export function formatMonthIndex(index) {
    if (typeof index !== 'number' || !Number.isFinite(index)) return null;
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * "Present" / "current" / blank end dates mean the period is still running.
 * Treated as extending to the reference month rather than as missing data.
 */
const ONGOING_TOKENS = new Set(['present', 'current', 'ongoing', 'now', 'to date']);

export function isOngoing(value) {
    if (value === null || value === undefined) return true;
    const raw = String(value).trim().toLowerCase();
    return raw === '' || ONGOING_TOKENS.has(raw);
}

/**
 * Turn one record into an inclusive month span, or null when it cannot be placed
 * on the calendar.
 *
 * @param {object} record   Anything with start/end-ish fields.
 * @param {number} nowIndex Reference month, used to close ongoing periods.
 */
export function toSpan(record, nowIndex) {
    if (!record || typeof record !== 'object') return null;

    const startRaw = record.startDate ?? record.start ?? record.from ?? record.dateFrom ?? null;
    const endRaw = record.endDate ?? record.end ?? record.to ?? record.dateTo ?? null;

    const start = parseMonthIndex(startRaw);
    if (start === null) return null;

    const end = isOngoing(endRaw) ? nowIndex : parseMonthIndex(endRaw);
    if (end === null) return null;

    // Tolerate a reversed pair rather than discarding the period.
    return { start: Math.min(start, end), end: Math.max(start, end) };
}

/**
 * Classify a record so the confirmation screen can tell the driver what kinds of
 * period they have already accounted for.
 */
export function spanKind(record, fallback) {
    const declared = record && typeof record === 'object'
        ? String(record.type || record.kind || '').trim().toLowerCase()
        : '';
    if (declared.includes('unemploy')) return 'unemployment';
    if (declared.includes('school') || declared.includes('education')) return 'schooling';
    if (declared.includes('military')) return 'military';
    if (declared.includes('employ')) return 'employment';
    if (record && (record.isUnemployment === true || record.unemployed === true)) return 'unemployment';
    return fallback;
}

/** Merge overlapping/adjacent spans into a minimal ascending set. */
export function mergeSpans(spans) {
    const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const span of sorted) {
        const last = merged[merged.length - 1];
        // `start <= last.end + 1` joins touching months (Jan–Mar then Apr–Jun).
        if (last && span.start <= last.end + 1) {
            last.end = Math.max(last.end, span.end);
        } else {
            merged.push({ ...span });
        }
    }
    return merged;
}

/**
 * Compute three-year coverage.
 *
 * @param {object} history
 * @param {Array} [history.employers]
 * @param {Array} [history.unemploymentPeriods]
 * @param {Array} [history.schools]
 * @param {Array} [history.military]
 * @param {object} [opts]
 * @param {Date|string} [opts.referenceDate] Defaults to now; inject for determinism.
 * @param {number} [opts.requiredMonths]     Defaults to 36.
 * @returns {{requiredMonths, coveredMonths, missingMonths, isComplete,
 *            windowStart, windowEnd, gaps, accountedKinds, unparseableRecords}}
 */
export function computeEmploymentCoverage(history = {}, opts = {}) {
    const requiredMonths = Number.isFinite(opts.requiredMonths) && opts.requiredMonths > 0
        ? Math.floor(opts.requiredMonths)
        : REQUIRED_COVERAGE_MONTHS;

    const reference = opts.referenceDate ? new Date(opts.referenceDate) : new Date();
    const nowIndex = Number.isNaN(reference.getTime())
        ? new Date().getUTCFullYear() * 12 + new Date().getUTCMonth()
        : reference.getUTCFullYear() * 12 + reference.getUTCMonth();

    // Inclusive window of `requiredMonths` months ending with the current month.
    const windowStart = nowIndex - (requiredMonths - 1);
    const windowEnd = nowIndex;

    // The wizard's gap list is stored under `unemployment` (DynamicRow's
    // listKey), while the snapshot builder passes `unemploymentPeriods`. Reading
    // only one of them meant every gap a driver explained counted for nothing:
    // they filled in the months and the application still reported them missing.
    const unemployment = [
        ...(Array.isArray(history.unemploymentPeriods) ? history.unemploymentPeriods : []),
        ...(Array.isArray(history.unemployment) ? history.unemployment : []),
    ];

    const sources = [
        ['employment', history.employers],
        ['unemployment', unemployment],
        ['schooling', history.schools],
        ['military', history.military],
    ];

    const spans = [];
    const accountedKinds = new Set();
    let unparseableRecords = 0;

    for (const [fallbackKind, list] of sources) {
        if (!Array.isArray(list)) continue;
        for (const record of list) {
            const span = toSpan(record, nowIndex);
            if (!span) {
                // Only count records that tried to describe a period.
                if (record && typeof record === 'object' && Object.keys(record).length > 0) {
                    unparseableRecords += 1;
                }
                continue;
            }
            // Clip to the window; history older than the window is irrelevant here.
            const start = Math.max(span.start, windowStart);
            const end = Math.min(span.end, windowEnd);
            if (start > end) continue;
            spans.push({ start, end });
            accountedKinds.add(spanKind(record, fallbackKind));
        }
    }

    const merged = mergeSpans(spans);
    const coveredMonths = merged.reduce((sum, s) => sum + (s.end - s.start + 1), 0);

    // Uncovered stretches inside the window, newest last.
    const gaps = [];
    let cursor = windowStart;
    for (const span of merged) {
        if (span.start > cursor) {
            gaps.push({
                fromMonth: formatMonthIndex(cursor),
                toMonth: formatMonthIndex(span.start - 1),
                months: span.start - cursor,
            });
        }
        cursor = Math.max(cursor, span.end + 1);
    }
    if (cursor <= windowEnd) {
        gaps.push({
            fromMonth: formatMonthIndex(cursor),
            toMonth: formatMonthIndex(windowEnd),
            months: windowEnd - cursor + 1,
        });
    }

    return {
        requiredMonths,
        coveredMonths,
        missingMonths: Math.max(0, requiredMonths - coveredMonths),
        isComplete: coveredMonths >= requiredMonths,
        windowStart: formatMonthIndex(windowStart),
        windowEnd: formatMonthIndex(windowEnd),
        gaps,
        accountedKinds: [...accountedKinds].sort(),
        unparseableRecords,
    };
}
