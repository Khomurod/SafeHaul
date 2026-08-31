// functions/shared/pdf/applicationText.js
//
// The text the application PDF prints when it is not printing an answer:
// the placeholder wording, the date and month formatting, the SSN mask, the
// applicant's display name and the scalar-answer rendering. Extracted
// verbatim from `applicationDocument.js`; the rules that file states — a
// blank answer prints as "Not provided", nothing is invented, no internal
// identifier is printed — are enforced with this vocabulary.

/** Printed where a presented question was left blank. */
const NOT_PROVIDED = 'Not provided';

/** Printed where a repeating section has no records. */
const NONE_RECORDED = 'None recorded.';

/** Printed for a custom question whose wording was never recorded. */
const WORDING_UNAVAILABLE = 'Question wording was not recorded';

function clean(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** ISO instant → "March 14, 2026 at 09:07 UTC". Times are stated in UTC. */
function formatInstant(iso) {
    const raw = clean(iso);
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    const months = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} at ${hh}:${mm} UTC`;
}

/** ISO instant → "March 14, 2026". */
function formatDay(iso) {
    const instant = formatInstant(iso);
    return instant ? instant.split(' at ')[0] : null;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

/** `YYYY-MM` → "March 2026". Coverage gaps are month-granular. */
function formatMonth(value) {
    const raw = clean(value);
    if (!raw) return null;
    const match = /^(\d{4})-(\d{2})$/.exec(raw);
    if (!match) return raw;
    const month = MONTH_NAMES[Number(match[2]) - 1];
    return month ? `${month} ${match[1]}` : raw;
}

/**
 * Turn a plural group label into the singular used to number one record.
 *
 * "Previous Addresses" → "Previous Address", "Additional Licences" →
 * "Additional Licence", "Military Service" → unchanged. A bare `s`-strip gave
 * "Previous Addresse 1".
 */
function singularize(label) {
    const text = clean(label) || '';
    if (/sses$/.test(text)) return text.slice(0, -2);
    if (/ies$/.test(text)) return `${text.slice(0, -3)}y`;
    if (/[^s]s$/.test(text)) return text.slice(0, -1);
    return text;
}

/** "1 month" / "3 months", with a verb that agrees. */
function pluralMonths(count) {
    return count === 1 ? '1 month is' : `${count} months are`;
}

/**
 * Mask a Social Security Number to its last four digits.
 *
 * Used everywhere the full number is not authorized. The masked form keeps the
 * last four because that is what a recruiter matches against, and reveals
 * nothing more.
 */
function maskSsn(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) return null;
    return `***-**-${digits.slice(-4)}`;
}

/**
 * The applicant's name, from the snapshot's own personal section.
 *
 * Deliberately not taken from the application document: the PDF must describe
 * the submission, and the application document is mutable.
 */
function applicantNameFrom(snapshot) {
    const answers = new Map();
    for (const section of snapshot?.sections || []) {
        for (const answer of section.answers || []) answers.set(answer.fieldId, answer);
    }
    const part = (id) => clean(answers.get(id)?.displayValue);
    const name = [part('firstName'), part('middleName'), part('lastName'), part('suffix')]
        .filter(Boolean)
        .join(' ');
    return name || 'Applicant name not recorded';
}

/** The value to print for one scalar answer, honouring the SSN policy. */
function scalarValue(answer, { includeFullSsn }) {
    if (answer.sensitive && answer.fieldId === 'ssn') {
        const raw = answer.value ?? answer.displayValue;
        if (!clean(raw)) return null;
        return includeFullSsn ? String(raw).trim() : maskSsn(raw);
    }
    return clean(answer.displayValue);
}

module.exports = {
    NOT_PROVIDED,
    NONE_RECORDED,
    WORDING_UNAVAILABLE,
    clean,
    formatInstant,
    formatDay,
    MONTH_NAMES,
    formatMonth,
    singularize,
    pluralMonths,
    maskSsn,
    applicantNameFrom,
    scalarValue,
};
