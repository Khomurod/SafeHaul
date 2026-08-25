// src/shared/utils/helpers.js

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

export function formatDate(date, includeTime = false) {
    if (!date) return '--';

    try {
        let dateObj = date;

        // Handle Firestore Timestamp
        if (date && typeof date.toDate === 'function') {
            dateObj = date.toDate();
        } else if (typeof date === 'string') {
            dateObj = new Date(date);
        }

        // Validate Date
        if (!(dateObj instanceof Date) || isNaN(dateObj)) {
            return '--';
        }

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