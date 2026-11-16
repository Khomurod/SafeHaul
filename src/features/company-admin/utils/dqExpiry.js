/**
 * A DQ record's valid-until date (`expirationDate`, `YYYY-MM-DD`) and whether it
 * has passed.
 *
 * Judged by the **UTC** calendar day: the company has no time zone of its own,
 * and the server's `dqExpiresNext` (`functions/shared/dqExpiry.js`) compares the
 * same strings. A document is good through its date and expired from the next
 * day; inside thirty days it is expiring (the DQ tab's threshold since it first
 * showed dates).
 */

import { formatDate } from '@shared/utils/helpers';

const DAY = /^(\d{4})-(\d{2})-(\d{2})/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Days before its date when a document counts as expiring. */
export const EXPIRING_WITHIN_DAYS = 30;

/** `YYYY-MM-DD` for a string that starts with a real calendar day, else null. */
export function calendarDay(value) {
    if (typeof value !== 'string') return null;
    const match = DAY.exec(value.trim());
    if (!match) return null;
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return match[0];
}

/** Today's UTC calendar day. */
export function todayUtc(now = new Date()) {
    return now.toISOString().slice(0, 10);
}

/**
 * @param {unknown} value a record's `expirationDate`
 * @param {string} today a UTC calendar day (`todayUtc()`)
 * @returns {{ state: 'expired'|'expiring'|'valid', day: string, daysLeft: number } | null}
 *   null when there is no date it can read
 */
export function expiryStatus(value, today = todayUtc()) {
    const day = calendarDay(value);
    if (!day) return null;
    const daysLeft = Math.round((Date.parse(day) - Date.parse(today)) / MS_PER_DAY);
    if (daysLeft < 0) return { state: 'expired', day, daysLeft };
    if (daysLeft < EXPIRING_WITHIN_DAYS) return { state: 'expiring', day, daysLeft };
    return { state: 'valid', day, daysLeft };
}

/** An `expiryStatus` in words: "Expired on …", "Expires on …, in N days", "Valid until …". */
export function describeExpiry(expiry) {
    if (!expiry) return '';
    const on = formatDate(expiry.day);
    if (expiry.state === 'expired') return `Expired on ${on}`;
    if (expiry.state === 'expiring') {
        if (expiry.daysLeft === 0) return `Expires today, ${on}`;
        return `Expires on ${on}, in ${expiry.daysLeft} ${expiry.daysLeft === 1 ? 'day' : 'days'}`;
    }
    return `Valid until ${on}`;
}
