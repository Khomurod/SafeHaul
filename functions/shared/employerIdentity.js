/**
 * Which employer is which, and why an array index cannot answer that.
 *
 * ## The corruption this exists to prevent
 *
 * A Previous Employment Verification is addressed **positionally**.
 * `verification_requests/{token}` records `employerIndex`, and both the employer's
 * own response (`employmentVerification/responses.js`) and the reminder cycle
 * (`reminders.js`) write their result back into `employers[idx]` of the
 * application document. That is sound only while nobody ever changes the array.
 *
 * Enabling employer editing makes changing it a supported workflow, so the
 * positional pointer becomes a live hazard, and the failure is the one the task
 * names outright:
 *
 *     [0] ABC Trucking   — verification Completed
 *     [1] XYZ Transport  — Not Started
 *
 * Delete ABC and XYZ becomes index 0. A request issued for ABC — sent, still
 * outstanding, answered next week — then writes ABC's completed verification, its
 * respondent, its signature and its result PDF onto **XYZ**. Nothing errors, the
 * carrier's DQ file is wrong, and the audit trail says a company nobody contacted
 * confirmed this driver's employment. Reordering does the same thing.
 *
 * ## The identity, and where it comes from
 *
 * Each employer row carries an `employerId`: twelve hex characters, minted once
 * and never rewritten. It is deliberately opaque and deliberately NOT derived from
 * the row's contents — `employerSignature` in `applicationLockedFields.js` is
 * content-derived (`dot:123456` / `name:acme trucking`) and answers a different
 * question ("is this the same carrier the PSP report named"), which is exactly why
 * it must not be reused here: correcting a typo in a company's name would move the
 * signature, and with it every verification filed under it.
 *
 * Rows are stamped lazily rather than by a migration: `withEmployerIds` fills in
 * whatever is missing, and it is called from the two places that already write the
 * employers array — the change-proposal path and `sendVerificationRequest`. A
 * submitted application's frozen snapshot is never touched; ids live on the live
 * record only.
 *
 * ## Resolving a request that has no id
 *
 * Every verification request written before this existed carries an index and no
 * id. `resolveEmployerTarget` still honours the index for those — but only when
 * the row it points at is **still the employer the request was sent to**, which the
 * request itself records as `employerName`. A name that no longer matches means the
 * array moved underneath the request, and the honest answer is to refuse the
 * write-back rather than to file the result against whoever is standing there now.
 * That refusal is logged by the caller and loses nothing: `verification_requests`
 * holds the response, the signature and the PDF permanently, and it is the
 * authoritative record — `employers[i].verification` is a denormalized mirror of it.
 */

const crypto = require('crypto');

/** Long enough that a collision inside one application is not a thing to think about. */
const EMPLOYER_ID_BYTES = 6;
const EMPLOYER_ID_PATTERN = /^[0-9a-f]{12}$/;

/** A ceiling on one application's employment history. Ten years of driving, generously. */
const MAX_EMPLOYERS = 40;

function mintEmployerId() {
    return crypto.randomBytes(EMPLOYER_ID_BYTES).toString('hex');
}

/** An id that came from a client. Anything else is treated as absent. */
function readEmployerId(value) {
    return typeof value === 'string' && EMPLOYER_ID_PATTERN.test(value) ? value : null;
}

/** Case, punctuation and spacing removed, so `A.B.C. Trucking` and `ABC Trucking` match. */
function normalizeEmployerName(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * The name a row goes by.
 *
 * `companyName` is the current field; `name` is the legacy one that
 * `SchemaRenderer` still falls back to for records written before the rename, so
 * anything comparing names has to read both or it will find nothing on an old
 * application.
 */
function employerNameOf(row) {
    return row?.companyName || row?.name || '';
}

/**
 * Every row with an `employerId`, minting one wherever it is missing.
 *
 * Returns a new array of new objects — never mutates the input, because callers
 * hold the stored array and compare against it to decide whether anything changed.
 * `changed` says whether any id was actually added, so a caller can skip a write.
 *
 * A DUPLICATE id is re-minted rather than kept. The ids arrive from a client on the
 * edit path, and two rows sharing one would make `resolveEmployerTarget` ambiguous
 * — which is the whole failure this module exists to remove, reintroduced by a
 * copy-and-paste in the editor.
 *
 * @param {Array} rows
 * @returns {{employers: Array, changed: boolean}}
 */
function withEmployerIds(rows) {
    const list = Array.isArray(rows) ? rows.slice(0, MAX_EMPLOYERS) : [];
    const seen = new Set();
    let changed = false;
    const employers = list.map((row) => {
        const source = row && typeof row === 'object' ? row : {};
        const existing = readEmployerId(source.employerId);
        if (existing && !seen.has(existing)) {
            seen.add(existing);
            return { ...source, employerId: existing };
        }
        let minted = mintEmployerId();
        while (seen.has(minted)) minted = mintEmployerId();
        seen.add(minted);
        changed = true;
        return { ...source, employerId: minted };
    });
    return { employers, changed };
}

/**
 * Where a verification request should write its result.
 *
 * Answers with an index into the array as it is NOW, or null when it cannot be
 * answered honestly. See the header for why the index is not trusted on its own.
 *
 * @param {Array} employers the application's current employers
 * @param {{employerId?: string, employerIndex?: number, employerName?: string}} request
 * @returns {{index: number, matchedBy: 'id'|'index'}|null}
 */
function resolveEmployerTarget(employers, request) {
    const list = Array.isArray(employers) ? employers : [];

    const wantedId = readEmployerId(request?.employerId);
    if (wantedId) {
        const index = list.findIndex((row) => readEmployerId(row?.employerId) === wantedId);
        // A request that names an id and cannot find it is a row that was removed.
        // Falling back to the index here would be the corruption itself, dressed up
        // as resilience.
        return index >= 0 ? { index, matchedBy: 'id' } : null;
    }

    const index = Number(request?.employerIndex);
    if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;

    // A legacy request. The index is only as good as the row still being the
    // employer it was sent to, and the request recorded that name at the time.
    const recorded = normalizeEmployerName(request?.employerName);
    const present = normalizeEmployerName(employerNameOf(list[index]));
    // With no recorded name there is nothing to check, and nothing to check means
    // nothing to trust: these are the same requests that predate ids, so refusing
    // is the safe half of an already-narrow case.
    if (!recorded || recorded !== present) return null;
    return { index, matchedBy: 'index' };
}

module.exports = {
    EMPLOYER_ID_PATTERN,
    MAX_EMPLOYERS,
    employerNameOf,
    mintEmployerId,
    normalizeEmployerName,
    readEmployerId,
    resolveEmployerTarget,
    withEmployerIds,
};
