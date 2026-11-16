// src/features/companies/hooks/dashboardPeriods.js
//
// The months the dashboard's hiring brief counts, and the applications list can
// open on: applications added in a month (`createdAt`, which the server sets),
// and applications hired in it (`hiredAt`, which the server stamps when a status
// enters hired — `functions/shared/hireDate.js`). A month is the viewer's own,
// from local midnight of its first day to the next month's, as the list's day
// filter is. React-free.

import { parseIsoDateParts } from '@shared/utils/dateFormHelpers';

/**
 * The day the server began recording hire dates (Д15). No application hired
 * before it has `hiredAt`, so a month that began before it is counted from it
 * ("hired since Nov 6"), and every month after it whole ("hired this month").
 */
export const HIRED_AT_RECORDED_FROM = '2026-11-06';

/** The most applications a period of hires lists, newest hire first (`runHiredPeriodList`); the list says when there are more. */
export const HIRED_PERIOD_LIMIT = 200;

/** What a period counts by: when applications were added, or when they were hired. */
const PERIOD_FIELDS = Object.freeze(['createdAt', 'hiredAt']);

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

// On the viewer's clock, read when called: a formatter made once keeps the zone it was made in.
const shortDay = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDay = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const monthName = (date) => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

/** The viewer's month of `date`, as `YYYY-MM`. */
export function monthKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * The instants a month covers on the viewer's clock.
 * @param {unknown} month e.g. `'2026-11'`
 * @returns {{ start: Date, end: Date } | null} `null` for anything but a real `YYYY-MM`
 */
export function monthRange(month) {
    const match = MONTH_PATTERN.exec(String(month ?? ''));
    if (!match) return null;
    const year = Number(match[1]);
    const index = Number(match[2]) - 1;
    if (index < 0 || index > 11) return null;
    return { start: new Date(year, index, 1), end: new Date(year, index + 1, 1) };
}

function recordedFrom() {
    const { year, month, day } = parseIsoDateParts(HIRED_AT_RECORDED_FROM);
    return new Date(year, month - 1, day);
}

/** The day hire dates began, when the month began before it; else `null`. */
export function hiredSince(month) {
    const range = monthRange(month);
    const from = recordedFrom();
    return range && from > range.start ? from : null;
}

/** A period a link or a filter names, kept only when it is one: `{ field, month }`; else `null`. */
export function validPeriod(period) {
    return period && PERIOD_FIELDS.includes(period.field) && monthRange(period.month)
        ? { field: period.field, month: period.month }
        : null;
}

/**
 * The instants a period covers: its month, and for hires only from the day hire
 * dates began. A month wholly before that day covers nothing (`start >= end`).
 * @returns {{ start: Date, end: Date } | null}
 */
export function periodRange(period) {
    const valid = validPeriod(period);
    if (!valid) return null;
    const range = monthRange(valid.month);
    const since = valid.field === 'hiredAt' ? hiredSince(valid.month) : null;
    return since ? { start: since, end: range.end } : range;
}

/** The brief's words for a month's hires: "hired since Nov 6" until a whole month is recorded, then "hired this month". */
export function hiredLabel(month) {
    const since = hiredSince(month);
    return since ? `hired since ${shortDay(since)}` : 'hired this month';
}

/** What a list opened on a period shows: "Applications added in November 2026", "… hired since Nov 6, 2026". */
export function periodDescription(period) {
    const valid = validPeriod(period);
    if (!valid) return '';
    const { start } = monthRange(valid.month);
    if (valid.field === 'createdAt') return `Applications added in ${monthName(start)}`;
    const since = hiredSince(valid.month);
    return since
        ? `Applications hired since ${longDay(since)}`
        : `Applications hired in ${monthName(start)}`;
}
