/**
 * How the PEV tab dates an entry of an employer's verification history.
 *
 * A call, fax or note a recruiter records (`recordVerificationAttempt`) is
 * stored at 12:00 UTC of the day they gave, so it is shown by its day alone: a
 * time beside it would be one nobody chose. Every other entry happened at a
 * moment and shows it.
 */

/** The attempts a recruiter records, which are dated by their day alone. */
const RECORDED_KINDS = new Set(['call', 'fax', 'note']);

/**
 * @param {{ timestamp?: string, attempt?: string }} entry
 * @param {{ withTime?: boolean }} [options] `false` for a day only, whatever the entry
 * @returns {string} the local day (and time), or '' when the entry has no usable time
 */
export function attemptWhen(entry, { withTime = true } = {}) {
    const at = new Date(entry?.timestamp);
    if (Number.isNaN(at.getTime())) return '';
    return withTime && !RECORDED_KINDS.has(entry?.attempt) ? at.toLocaleString() : at.toLocaleDateString();
}
