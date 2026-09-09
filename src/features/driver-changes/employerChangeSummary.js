/**
 * What a company actually changed about a driver's employment history.
 *
 * ## Why the generic preview is not good enough here
 *
 * `previewValue` renders any array as `"3 item(s)"`, so the review portal showed a
 * driver **"2 item(s) → 1 item(s)"** and asked them to approve or reject it. That
 * is not a decision anybody can make: the one thing they need to know is *which
 * employer went*, and 49 CFR 391.21(b)(10) makes the answer consequential — the
 * application has to account for three years, and the row a recruiter deleted may
 * be the reason it does.
 *
 * Employers became editable on 2026-09-09, which is what turned a cosmetic gap
 * into a real one: before that, `employers` could not appear in a pending change
 * at all.
 *
 * ## How rows are matched
 *
 * By `employerId` — the same stable identity the server files verifications
 * under. That is what makes "renamed" distinguishable from "removed one and added
 * another", which position cannot tell apart and which is exactly the difference a
 * driver is being asked about. A row with no id yet (one the company just added)
 * is new by definition; the server mints its id when the change is proposed, so a
 * `proposedValue` read back from a pending change always has one.
 *
 * Values only, no React: the portal renders it, and this decides it.
 */

/** The fields a driver is shown, in the order they read. Not the whole row. */
const SUMMARY_FIELDS = Object.freeze([
    ['companyName', 'Company'],
    ['startDate', 'From'],
    ['endDate', 'To'],
    ['position', 'Position'],
    ['reasonForLeaving', 'Reason for leaving'],
    ['dotNumber', 'USDOT number'],
    ['phone', 'Phone'],
]);

/** Legacy field names a pre-rename row uses. Read, never written. */
const LEGACY_KEYS = Object.freeze({
    companyName: 'name',
    address: 'street',
    reasonForLeaving: 'reason',
});

function valueOf(row, key) {
    const direct = row?.[key];
    if (direct !== undefined && direct !== null && direct !== '') return String(direct);
    const legacy = LEGACY_KEYS[key];
    const fallback = legacy ? row?.[legacy] : undefined;
    return fallback === undefined || fallback === null ? '' : String(fallback);
}

/** What to call a row when there is nothing else to call it. */
export function employerLabel(row, position) {
    return valueOf(row, 'companyName') || `Employer ${position}`;
}

function keyed(rows) {
    const map = new Map();
    (Array.isArray(rows) ? rows : []).forEach((row, index) => {
        // An id-less row cannot be matched to anything, so it is keyed by position
        // and will read as added or removed. That is honest: with no identity there
        // is no way to say it is the same employer.
        map.set(row?.employerId || `@${index}`, { row, index });
    });
    return map;
}

/**
 * The change, as a list of things a driver can read and decide about.
 *
 * @param {Array} original the record as it stands
 * @param {Array} proposed what the company wants it to be
 * @returns {{added: Array, removed: Array, changed: Array, unchanged: number}}
 *   `added`/`removed` are `{label}`; `changed` is `{label, fields: [{label, from, to}]}`
 */
export function summarizeEmployerChange(original, proposed) {
    const before = keyed(original);
    const after = keyed(proposed);

    const added = [];
    const removed = [];
    const changed = [];
    let unchanged = 0;

    for (const [id, { row, index }] of after) {
        const previous = before.get(id);
        if (!previous) {
            added.push({ label: employerLabel(row, index + 1) });
            continue;
        }
        const fields = SUMMARY_FIELDS
            .map(([key, label]) => ({ label, from: valueOf(previous.row, key), to: valueOf(row, key) }))
            .filter((field) => field.from !== field.to);
        if (fields.length === 0) {
            unchanged += 1;
            continue;
        }
        changed.push({ label: employerLabel(previous.row, previous.index + 1), fields });
    }

    for (const [id, { row, index }] of before) {
        if (!after.has(id)) removed.push({ label: employerLabel(row, index + 1) });
    }

    return { added, removed, changed, unchanged };
}

/** True when there is a summary worth rendering instead of "N item(s)". */
export function isEmployerChange(fieldKey) {
    return fieldKey === 'employers';
}

export default summarizeEmployerChange;
