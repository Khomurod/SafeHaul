// src/shared/utils/helpers.js

import { parseIsoDateParts } from './dateFormHelpers';

/**
 * Returns a "Not Specified" string if the value is empty, otherwise returns the value.
 */
export function getFieldValue(value) {
    if (value === null || value === undefined || value === "") {
        return "Not Specified";
    }
    return value;
}

/**
 * Converts a string to Title Case (e.g., "JOHN DOE" -> "John Doe").
 * Handles ALL CAPS, all lowercase, and mixed case inputs.
 */
export function toTitleCase(str) {
    if (!str || typeof str !== 'string') return str;

    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

export function normalizePhone(phone) {
    if (!phone) return "";

    // 1. Convert to string and remove non-digits
    let cleaned = String(phone).trim().replace(/\D/g, '');

    // 2. Handle US Country Code (Strip leading 1 if length is 11)
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
        cleaned = cleaned.substring(1);
    }

    // 3. Return whatever digits we have. 
    // Previously, this returned "" if length !== 10, which caused data loss.
    return cleaned;
}

/**
 * Formats a phone number string into (XXX) XXX-XXXX format.
 * If formatting fails (e.g. international number), returns the original input.
 */
export function formatPhoneNumber(phone) {
    if (!phone) return "Not Specified";

    // We use the normalizer to try and get clean digits
    const cleaned = normalizePhone(phone);

    // Standard US Formatting
    if (cleaned.length === 10) {
        const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
        if (match) {
            return `(${match[1]}) ${match[2]}-${match[3]}`;
        }
    }

    // If it's not a standard 10-digit US number, return the input as-is 
    // rather than "Not Specified" so we don't hide international numbers.
    return phone || "Not Specified";
}

/**
 * A stored calendar date (`YYYY-MM-DD`) or month (`YYYY-MM`) as itself, or
 * `null` for any other text. It is a day or a month, not an instant: read as
 * midnight UTC and shown in the viewer's zone, it fell a day early west of UTC.
 * It has no time to show.
 */
function formatCalendarText(text) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        const parts = parseIsoDateParts(text);
        if (!parts) return '--';
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
            .toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
    }
    const month = text.match(/^(\d{4})-(\d{2})$/);
    if (month) {
        const monthNumber = Number(month[2]);
        if (monthNumber < 1 || monthNumber > 12) return '--';
        return new Date(Date.UTC(Number(month[1]), monthNumber - 1, 1))
            .toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short' });
    }
    return null;
}

export function formatDate(date, includeTime = false) {
    if (!date) return '--';

    try {
        const calendar = typeof date === 'string' ? formatCalendarText(date.trim()) : null;
        if (calendar !== null) return calendar;

        let dateObj = date;

        // Handle Firestore Timestamp
        if (date && typeof date.toDate === 'function') {
            dateObj = date.toDate();
        } else if (typeof date === 'string') {
            dateObj = new Date(date);
        }

        // Validate Date
        if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
            return '--';
        }

        /** @type {Intl.DateTimeFormatOptions} */
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        };

        if (includeTime) {
            options.hour = '2-digit';
            options.minute = '2-digit';
        }

        return dateObj.toLocaleDateString('en-US', options);
    } catch (err) {
        console.warn('Date formatting error:', err);
        return '--';
    }
}