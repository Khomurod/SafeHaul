import { mapFmcsaRowToEmployerFields } from '@shared/services/fmcsaEmployerSocrata';
import { NORTH_AMERICAN_REGION_NAMES } from '@shared/utils/northAmericanRegions';

/**
 * Contact details for the employers a PSP report named, from FMCSA's census.
 *
 * A PSP carrier arrives as a name and a USDOT number. The census holds that
 * carrier's current address, phone and sometimes an email, so the rows the
 * driver would otherwise fill by hand are filled here, on these terms:
 *
 * - matched only by the exact USDOT number: a name match can pick another
 *   carrier with a similar name;
 * - only blank fields are filled, so what the recruiter typed stays;
 * - the name and the USDOT number are never touched, so the row still matches
 *   the lock its report gave it;
 * - a census name unlike the row's is reported, since a misread digit names a
 *   different carrier and fills its address.
 */

const CONTACT_FIELDS = Object.freeze(['address', 'city', 'state', 'phone', 'companyEmail']);

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

/** A USDOT number as the census writes it: digits, no leading zeros; '' when not one. */
const canonicalDot = (value) => {
    const digits = String(value ?? '').trim().replace(/^0+(?=\d)/, '');
    return /^\d{1,9}$/.test(digits) ? digits : '';
};

/** The words of a carrier name that tell carriers apart. */
function nameWords(name) {
    return String(name ?? '').toUpperCase()
        .replace(/[^A-Z0-9 ]+/g, ' ')
        .split(/\s+/)
        .filter((word) => word && !['INC', 'LLC', 'CO', 'CORP', 'LTD', 'THE', 'OF', 'AND', 'COMPANY', 'CORPORATION'].includes(word));
}

/** True when one name's distinctive words are all in the other's. */
function namesAgree(a, b) {
    const left = nameWords(a);
    const right = nameWords(b);
    if (left.length === 0 || right.length === 0) return true;
    const shorter = left.length <= right.length ? left : right;
    const longer = new Set(left.length <= right.length ? right : left);
    return shorter.every((word) => longer.has(word));
}

/** The USDOT numbers of rows with a contact field still blank. */
export function dotsToLookUp(employers) {
    return [...new Set((Array.isArray(employers) ? employers : [])
        .filter((row) => canonicalDot(row?.dotNumber))
        .filter((row) => CONTACT_FIELDS.some((field) => isBlank(row[field])))
        .map((row) => canonicalDot(row.dotNumber)))];
}

/**
 * @param {Array<object>} employers the rows as they stand now
 * @param {Array<Record<string, unknown>>} censusRows what FMCSA answered
 * @returns {{ employers: Array<object>, filled: number, mismatches: Array<{ companyName: string, dotNumber: string, censusName: string }> }}
 */
export function fillEmployersFromFmcsa(employers, censusRows) {
    const byDot = new Map();
    for (const row of Array.isArray(censusRows) ? censusRows : []) {
        const dot = canonicalDot(row?.dot_number);
        if (dot && !byDot.has(dot)) byDot.set(dot, row);
    }
    let filled = 0;
    const mismatches = [];
    const next = (Array.isArray(employers) ? employers : []).map((employer) => {
        const dot = canonicalDot(employer?.dotNumber);
        const census = dot && byDot.get(dot);
        if (!census) return employer;
        const fields = mapFmcsaRowToEmployerFields(census, NORTH_AMERICAN_REGION_NAMES);
        const patch = {};
        for (const field of CONTACT_FIELDS) {
            if (isBlank(employer[field]) && !isBlank(fields[field])) patch[field] = fields[field];
        }
        if (Object.keys(patch).length === 0) return employer;
        filled += 1;
        const tradeName = String(census.dba_name ?? '').trim();
        if (!namesAgree(employer.companyName, census.legal_name) && !(tradeName && namesAgree(employer.companyName, tradeName))) {
            mismatches.push({ companyName: employer.companyName || '', dotNumber: dot, censusName: fields.companyName });
        }
        return { ...employer, ...patch };
    });
    return { employers: next, filled, mismatches };
}
