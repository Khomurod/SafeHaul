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
 * - **A submission from an older revision is refused** with a sentence and the
 *   Review page, so the driver never signs an application whose changes they
 *   have not been shown.
 *
 * A browser that sends no `seenRevision` predates this, and keeps exactly the
 * behaviour it had: Testing and Production share this backend, and the
 * Production page stays the old one until a release is promoted.
 */

const functions = require('firebase-functions/v1');

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

module.exports = {
    assertCompanyEditsSeen,
    clientCompanyEdits,
    companyEditsOf,
    companyRevisionOf,
    mergeCompanyEdits,
    seenRevisionOf,
};
