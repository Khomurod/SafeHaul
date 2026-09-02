// src/config/applicationDates.js
//
// ESM mirror of `functions/shared/applicationDates.js` — the one place the
// application's date shapes are parsed and judged. See that file for why. The body
// between the markers is byte-identical to the server copy;
// `applicationRules.parity.test.js` fails if the two drift.

// --- body ---------------------------------------------------------------------
// Identical to functions/shared/applicationDates.js. Edit both, or the parity test fails.

/** End-of-period fields accept "still going" instead of a date. */
const ONGOING_TOKENS = new Set(['present', 'current', 'ongoing', 'now', 'to date']);


function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parse the date shapes the application stores or ever stored: `YYYY-MM-DD`,
 * `YYYY-MM`, legacy `M/YYYY` and `M/D/YYYY`, and an ISO timestamp's date part.
 * Returns null for anything else and for an impossible calendar date, so a
 * "2026-02-30" or a month of 13 is refused rather than quietly shifted.
 */
function parseApplicationDate(value) {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    let year;
    let month;
    let day = null;
    let match;
    if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(raw))) {
        [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else if ((match = /^(\d{4})-(\d{1,2})$/.exec(raw))) {
        [year, month] = [Number(match[1]), Number(match[2])];
    } else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw))) {
        [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
    } else if ((match = /^(\d{1,2})[/-](\d{4})$/.exec(raw))) {
        [month, year] = [Number(match[1]), Number(match[2])];
    } else {
        return null;
    }

    if (year < 1900 || year > 2200 || month < 1 || month > 12) return null;
    if (day !== null && (day < 1 || day > daysInMonth(year, month))) return null;

    const iso = day === null
        ? `${year}-${String(month).padStart(2, '0')}`
        : `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return { year, month, day, iso };
}

function isOngoingToken(value) {
    return ONGOING_TOKENS.has(String(value ?? '').trim().toLowerCase());
}

/** `YYYY-MM-DD` for a Date, an ISO string, or (default) now. */
function toIsoDay(today) {
    const date = today ? new Date(today) : new Date();
    const safe = Number.isNaN(date.getTime()) ? new Date() : date;
    return `${safe.getFullYear()}-${String(safe.getMonth() + 1).padStart(2, '0')}-${String(safe.getDate()).padStart(2, '0')}`;
}

/**
 * Where a stored date stands relative to today: `expired` (strictly before
 * today), `current`, or `unknown` when blank or unparseable. A month-only value
 * counts as the whole month, so a card that expires "this month" is current.
 */
function dateStatus(value, today) {
    const parsed = parseApplicationDate(value);
    if (!parsed) return 'unknown';
    const todayIso = toIsoDay(today);
    const lastDay = parsed.day === null
        ? `${parsed.iso}-${String(daysInMonth(parsed.year, parsed.month)).padStart(2, '0')}`
        : parsed.iso;
    return lastDay < todayIso ? 'expired' : 'current';
}

// --- exports -------------------------------------------------------------------

export {
    ONGOING_TOKENS,
    dateStatus,
    daysInMonth,
    isOngoingToken,
    parseApplicationDate,
    toIsoDay,
};
