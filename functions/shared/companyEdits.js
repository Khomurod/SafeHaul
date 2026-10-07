/**
 * A Company Admin's edits to an application the driver is filling in, and the
 * rule that keeps the two sides from erasing each other.
 *
 * ## Why edits need a protocol at all
 *
 * The driver fills the application in their own browser, and submits it from
 * there. Every save sends their whole copy, and the submission is whatever that
 * copy says. So an edit made on the server alone is silently undone by the
 * driver's next Next, or never reaches the application they sign.
 *
 * ## The protocol
 *
 * An edit stamps the draft with `companyRevision`, and records in `companyEdits`
 * the revision at which it last changed each answer. A revision is the edit's
 * time in milliseconds, raised past the stored one when a clock lags, so a later
 * edit always has a larger one. That holds across a draft that was deleted and
 * started again, where a counter would restart and repeat itself.
 *
 * The browser keeps, beside the answers, the revision its copy has taken, and
 * says it on every save and on the submission (`seenRevision`):
 *
 * - **A save from an older revision is refused** (`companyUpdated`), with nothing
 *   written. The browser fetches the draft, takes the answers edited after its
 *   revision, tells the driver what changed, and saves again.
 * - **A save landing on the same driver's other draft, which an admin edited, is
 *   refused** like a failed save: a corrected email or phone joins two
 *   unfinished applications, and a revision speaks only for the draft its copy
 *   came from. That draft's edits cannot reach this browser, whose token opens
 *   the other one, so neither draft is touched.
 * - **A submission from an older revision is refused** with a sentence and the
 *   Review page, so the driver never signs an application whose changes they
 *   have not been shown. Once the browser has fetched the edits, its retry says
 *   no revision: edits it could not show the driver never stop a submission.
 *
 * A browser that sends no `seenRevision` predates this, and keeps exactly the
 * behaviour it had: Testing and Production share this backend, and the
 * Production page stays the old one until a release is promoted.
 *
 * ## What an edit may change
 *
 * Every answer the application asks for (`applicationSections.json`, the table
 * the wizard, the record and the PDF read) and the company's own questions,
 * except those only the driver gives (`driverOnlyFields.json`). The driver's
 * page never takes those from the carrier, so an edit to one would be a change
 * nobody is shown. Each value must have the shape the wizard stores for it,
 * because the driver's page takes an edited answer whole.
 */

const functions = require('firebase-functions/v1');
const SECTIONS = require('./applicationSections.json');
const DRIVER_ONLY_FIELDS = require('./driverOnlyFields.json');

/** Every answer the application asks for, by id. */
const FIELDS = new Map(SECTIONS.flatMap((section) => section.fields.map((field) => [field.id, field])));

/** The company's own questions' answers: one map, beside the standard answers. */
const CUSTOM_ANSWERS = 'customAnswers';

/** The answers a Company Admin may change; see the header. */
const EDITABLE_FIELDS = Object.freeze(
    [...FIELDS.keys(), CUSTOM_ANSWERS].filter((field) => !DRIVER_ONLY_FIELDS.includes(field)),
);

/** A revision is a millisecond time, so anything a browser claims is bounded by it. */
function isRevision(value) {
    return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

/** The latest edit's revision on a draft. 0 for a draft no admin has edited. */
function companyRevisionOf(data) {
    const value = data?.companyRevision;
    return isRevision(value) ? value : 0;
}

/** Each answer an admin changed, with the revision of its latest change. */
function companyEditsOf(data) {
    const value = data?.companyEdits;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter(([, revision]) => isRevision(revision) && revision > 0),
    );
}

/** Two drafts' edits as one, each answer at the later of its two revisions. */
function mergeCompanyEdits(first, second) {
    const merged = companyEditsOf(first);
    for (const [field, revision] of Object.entries(companyEditsOf(second))) {
        if (!(merged[field] >= revision)) merged[field] = revision;
    }
    return merged;
}

/**
 * The revision a browser says its copy holds, or null for a browser that
 * predates the protocol, or that has no draft of its own to fetch edits from.
 */
function seenRevisionOf(value) {
    return isRevision(value) ? value : null;
}

/** What a browser is handed about edits, beside the answers. */
function clientCompanyEdits(data) {
    return {
        companyRevision: companyRevisionOf(data),
        companyEdits: companyEditsOf(data),
    };
}

/**
 * Refuses a submission from a copy that has not taken the latest edits.
 *
 * Only for a browser that said which revision it holds; see the header for the
 * one that does not. The Review page is where the driver is sent, because what
 * changed has to be in front of them before they sign.
 */
function assertCompanyEditsSeen(seenRevision, data) {
    if (seenRevision === null) return;
    if (companyRevisionOf(data) <= seenRevision) return;
    throw new functions.https.HttpsError(
        'failed-precondition',
        'Your carrier updated your application after this page loaded. Check the changes on the Review page, then sign again.',
        { issues: [{ code: 'carrier-updated', semanticStep: 'review', fieldId: null }] },
    );
}

/**
 * The revision a new edit takes: its time, or one past the draft's latest when
 * a clock lags, so a later edit always has the larger one.
 */
function nextCompanyRevision(data, now = Date.now()) {
    return Math.max(Math.trunc(now), companyRevisionOf(data) + 1);
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isScalar(value) {
    return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

/** `{ name, storagePath }`: the shape every upload on an application has. */
function isUpload(value) {
    return isPlainObject(value) && typeof value.storagePath === 'string'
        && Object.values(value).every(isScalar);
}

/** One answer: a value, a multiple choice's values, or an upload. */
function isAnswer(value) {
    return isScalar(value) || (Array.isArray(value) && value.every(isScalar)) || isUpload(value);
}

/**
 * Is this the shape the wizard stores for this answer?
 *
 * A repeating answer is a list of rows, a document is an upload, the company's
 * questions are a map of answers, and everything else is a value or a multiple
 * choice's values. Nothing may be cleared to anything but null.
 */
function fitsField(fieldId, value) {
    if (value === null) return true;
    if (fieldId === CUSTOM_ANSWERS) return isPlainObject(value) && Object.values(value).every(isAnswer);
    const field = FIELDS.get(fieldId);
    if (!field) return false;
    if (field.repeating) {
        return Array.isArray(value)
            && value.every((row) => isPlainObject(row) && Object.values(row).every(isAnswer));
    }
    if (field.type === 'file') return isUpload(value);
    return isScalar(value) || (Array.isArray(value) && value.every(isScalar));
}

/** A value with its keys in one order, so two copies of it compare equal. */
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (isPlainObject(value)) {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value === undefined ? null : value;
}

/** Are these the same answer, whatever order their keys arrived in? */
function sameAnswer(first, second) {
    return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}

module.exports = {
    CUSTOM_ANSWERS,
    EDITABLE_FIELDS,
    assertCompanyEditsSeen,
    clientCompanyEdits,
    companyEditsOf,
    companyRevisionOf,
    fitsField,
    mergeCompanyEdits,
    nextCompanyRevision,
    sameAnswer,
    seenRevisionOf,
};
