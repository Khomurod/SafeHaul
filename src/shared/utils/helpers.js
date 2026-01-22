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

/**
 * Formats experience string.
 * Returns "Unidentified" if value is 'New', '0', empty, or null.
 */
export function formatExperience(value) {
    if (!value || value === 'New' || value === '0' || value === 0 || value === '') {
        return 'Unidentified';
    }
    return `${value} Years`;
}

/**
 * Strips a phone number to raw digits for database searching/comparison.
 * FIX: Now returns raw digits even if length != 10 to prevent data loss.
 */
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
 * Returns Tailwind classes for the application status.
 */
export function getStatusColor(status) {
    switch (status) {
        case 'Approved':
            return 'bg-green-100 text-green-800';
        case 'Rejected':
            return 'bg-red-100 text-red-800';
        case 'Background Check':
            return 'bg-purple-100 text-purple-800';
        case 'Awaiting Documents':
            return 'bg-yellow-100 text-yellow-800';
        case 'Pending Review':
            return 'bg-blue-100 text-blue-800';
        case 'New Application':
        default:
            return 'bg-gray-100 text-gray-800';
    }
}

export function field(label, value) {
    const displayValue = getFieldValue(value);
    const val = (displayValue === "Not Specified")
        ? `<span class="text-gray-400 italic">${displayValue}</span>`
        : displayValue;
    return `<div class="py-2 sm:grid sm:grid-cols-3 sm:gap-4"><dt class="text-sm font-medium text-gray-500">${label}</dt><dd class="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">${val}</dd></div>`;
}

export function createFileLink(url, label, fileName) {
    const fName = getFieldValue(fileName);
    if (url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:underline font-medium">${label} (${fName}) &rarr;</a>`;
    }
    return `<span class="text-gray-500">${label} (${fName === "Not Specified" ? "File not available" : fName})</span>`;
}