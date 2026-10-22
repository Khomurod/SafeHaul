import { isWellFormedEmail } from '@shared/utils/validation';

/**
 * The company's own people a verification request copies (CC).
 *
 * Typed as one line — commas, semicolons, spaces or new lines between
 * addresses — and read the way `sendVerificationRequest` reads the list it is
 * sent: lower-cased, each once, never the employer itself, at most five.
 * Copies receive the same email the employer does, response link included.
 */
export const MAX_PEV_COPIES = 5;

/**
 * @param {string} text
 * @param {string} [employerEmail]
 * @returns {{ emails: string[], error: string | null }}
 */
export function parsePevCopies(text, employerEmail = '') {
    const employer = String(employerEmail || '').trim().toLowerCase();
    const emails = [];
    for (const part of String(text || '').split(/[\s,;]+/)) {
        const email = part.trim().toLowerCase();
        if (!email) continue;
        if (!isWellFormedEmail(email)) {
            return { emails: [], error: `"${email}" is not a valid email address.` };
        }
        if (email !== employer && !emails.includes(email)) emails.push(email);
    }
    if (emails.length > MAX_PEV_COPIES) {
        return { emails: [], error: `Copy at most ${MAX_PEV_COPIES} people.` };
    }
    return { emails, error: null };
}

/** A saved list as the one line the field shows. */
export function formatPevCopies(list) {
    return Array.isArray(list) ? list.filter((email) => typeof email === 'string' && email).join(', ') : '';
}
