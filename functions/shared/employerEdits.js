/**
 * A company's edit to the employment history, and the verification history it
 * must not be able to move.
 *
 * ## What a client is allowed to decide, and what it is not
 *
 * `proposeApplicationChanges` accepts `employers` as one whole-array replacement —
 * that is how every array field on the editable allowlist works. So the browser
 * sends the list it wants, which means the browser sends `verification` blocks too,
 * because it edited rows it had read. **Those blocks are never taken from the
 * client.** They are stripped and re-attached here from the record, by
 * `employerId`, so:
 *
 *   - a row that kept its id keeps its own verification, whatever the client sent;
 *   - a row the client added has none, whatever the client sent;
 *   - a row that was removed takes its mirror with it, and nothing inherits it.
 *
 * That last one is the case the task calls out: ABC Trucking with a completed
 * verification and XYZ Transport with none, ABC deleted, and XYZ must not end up
 * holding ABC's answer. Index-based re-attachment does exactly that; identity-based
 * re-attachment cannot.
 *
 * ## Why it runs twice, and why the second time is the authority
 *
 * A proposal is written now and resolved by the driver later — possibly days later,
 * through `/review-change/:token`. A verification can complete in between. So
 * re-attaching at proposal time gives the driver an accurate before/after to look
 * at, and re-attaching AGAIN at resolution time is what actually protects the
 * record: the proposal's stored `proposedValue` is a snapshot, and applying its
 * `verification` blocks would roll back anything that happened while it waited.
 *
 * It is also what closes the driver's own `edit` action, which writes
 * `r.value` straight onto the document with no validation at all — so a review
 * portal could set any field on any employer, verification included.
 *
 * ## Removing an employer that has verification activity
 *
 * Not blocked, because a carrier legitimately removes a row it added in error, and
 * a hard refusal would leave them with no way to fix it. Not silent either:
 * `describeEmployerEdit` reports what is being removed and what verification state
 * went with it, and the callers write that into the application's activity log. The
 * PEV record itself is untouched — `verification_requests/{token}` holds the
 * response, the signature, the method and the generated PDF permanently, and is the
 * authoritative record. Nothing here deletes any of it.
 */

const { employerNameOf, withEmployerIds } = require('./employerIdentity');

/**
 * Everything PEV writes onto an employer row.
 *
 * `verification` is the whole mirror (status, method, token reference, respondent,
 * result URL and history), written by `sendVerificationRequest`,
 * `submitVerificationResponse`, the reminder cycle and the manual result upload.
 * Listed rather than inferred, so a new PEV field has to be added here on purpose
 * — the alternative is a client-supplied field quietly becoming authoritative.
 */
const PEV_ROW_FIELDS = Object.freeze(['verification']);

/** A verification mirror as the client must never be able to set it. */
function stripPevFields(row) {
    const clean = { ...row };
    for (const field of PEV_ROW_FIELDS) delete clean[field];
    return clean;
}

function byEmployerId(rows) {
    const map = new Map();
    for (const row of Array.isArray(rows) ? rows : []) {
        if (row && typeof row.employerId === 'string') map.set(row.employerId, row);
    }
    return map;
}

/**
 * The employers array a proposal or a resolution may actually write.
 *
 * @param {Array} proposed what the client sent
 * @param {Array} current what the record holds right now
 * @returns {{employers: Array, removed: Array}} `removed` is the current rows whose
 *   id is not in the result, for the audit line.
 */
function reconcileEmployerEdit(proposed, current) {
    // Ids first: a row the client added has none, and everything below is keyed on
    // them. This also re-mints a duplicated id, so a copy-and-paste in the editor
    // cannot make two rows claim one verification.
    const { employers: withIds } = withEmployerIds(proposed);
    const existing = byEmployerId(current);

    const employers = withIds.map((row) => {
        const clean = stripPevFields(row);
        const previous = existing.get(row.employerId);
        if (!previous) return clean;
        // Re-attached from the RECORD, by identity. Present-and-undefined is not the
        // same as absent to Firestore, so a row whose stored value was absent stays
        // absent rather than becoming an explicit null.
        for (const field of PEV_ROW_FIELDS) {
            if (previous[field] !== undefined) clean[field] = previous[field];
        }
        return clean;
    });

    const kept = new Set(employers.map((row) => row.employerId));
    const removed = [...existing.entries()]
        .filter(([id]) => !kept.has(id))
        .map(([, row]) => row);

    return { employers, removed };
}

/** The verification state of a row, in the words a recruiter reads on the PEV tab. */
function verificationStateOf(row) {
    const status = row?.verification?.status;
    return typeof status === 'string' && status ? status : 'Not Started';
}

/**
 * One sentence describing an employers edit, for the activity log.
 *
 * Names the employers removed and the verification state each was in, because
 * "employment history changed" is not an audit trail — the question somebody asks
 * six months later is whether the row that had a completed verification is the row
 * that went. Returns null when nothing was removed and there is nothing to say
 * beyond the diff the pending change already records.
 */
function describeEmployerEdit(removed) {
    const rows = Array.isArray(removed) ? removed : [];
    if (rows.length === 0) return null;
    const listed = rows
        .map((row) => `${employerNameOf(row) || 'an unnamed employer'} (verification: ${verificationStateOf(row)})`)
        .join('; ');
    return `Employer(s) removed from the employment history: ${listed}. `
        + 'Any verification records for them are kept on file and are not deleted.';
}

/** True when a removal takes a row that has verification activity with it. */
function removesVerifiedEmployer(removed) {
    return (Array.isArray(removed) ? removed : [])
        .some((row) => verificationStateOf(row) !== 'Not Started');
}

module.exports = {
    PEV_ROW_FIELDS,
    describeEmployerEdit,
    reconcileEmployerEdit,
    removesVerifiedEmployer,
    stripPevFields,
    verificationStateOf,
};
