/**
 * An answer within a time, for work that has to finish what it started.
 *
 * The Storage and Firestore clients keep retrying a request on their own, long
 * enough to outlast the function that sent it, so work that must still record
 * what it could not do (`drafts/draftFiles.js`), or must not hold a driver's
 * submission up (`shared/guestUploads.js`), stops waiting at a time of its own.
 * Stopping waiting does not stop the request: a delete given up on may still
 * land later.
 */

/**
 * `promise`, or a refusal (`code: 'step-timeout'`) once `ms` pass without an
 * answer; `promise` itself without `ms`.
 */
function withinStep(promise, ms) {
    if (!ms) return promise;
    let timer;
    const late = new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: 'step-timeout' })), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/**
 * How long the next step may take: at most `stepMs`, and never past `deadline`
 * (a time in milliseconds); no limit without either.
 */
function stepLimit(stepMs, deadline) {
    const left = Number.isFinite(deadline) ? Math.max(1, deadline - Date.now()) : Infinity;
    const limit = Math.min(stepMs || Infinity, left);
    return Number.isFinite(limit) ? limit : undefined;
}

module.exports = { stepLimit, withinStep };
