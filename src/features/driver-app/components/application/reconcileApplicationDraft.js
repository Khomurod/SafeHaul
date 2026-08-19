/**
 * Decides which unfinished-application copy holds the freshest progress.
 *
 * Pure: no React, no storage, no network, and **no clock**. Every branch below is
 * an integer or string comparison, which is what makes the whole decision table
 * directly testable and what keeps a wrong device clock from mattering.
 *
 * ## The rule
 *
 * **An older server draft must never overwrite newer locally saved work.**
 *
 * The local copy is written synchronously on every forward step; the server copy
 * is written in the background and can fail, lag, or be superseded. Restoring the
 * server copy over the local one used to be unconditional, so the local backup
 * was destroyed by the exact failure it exists to survive.
 *
 * ## Why sequence numbers rather than timestamps
 *
 * The server stamps `updatedAt` with a Firestore `serverTimestamp`; a local stamp
 * would come from the driver's phone. Those are different clocks and phone clocks
 * are routinely wrong, so comparing them would mark some drivers' local work
 * permanently stale and others' permanently fresh. Instead the local copy counts
 * its own writes (`localSeq`) and remembers which of them the server confirmed
 * (`syncedSeq`), and the server stores the sequence that accompanied its copy
 * (`clientSeq`). Two questions, both integers:
 *
 * - does this device hold unacknowledged work? `localSeq > syncedSeq`
 * - did the server move on without us? `clientSeq !== syncedSeq`
 *
 * The second uses `!==` and never `>`: sequences are per-device counters, so a
 * number from another browser is not comparable in magnitude, only in identity.
 *
 * ## The loser is merged, never discarded
 *
 * Whichever side wins, the other is merged *underneath* it. Only keys present in
 * both are actually decided by the winner, so a field that exists on one side
 * only always survives — which is what "the freshest progress wins without
 * losing newer field values" has to mean when both copies contain real work.
 */

/** Values that carry no answer, so they never outrank a stored one. */
function isEmpty(value) {
    return value === undefined || value === null || value === '';
}

/**
 * Whether two draft values are the same answer.
 *
 * By value, not by reference. Uploads and the repeating sections (employment,
 * accidents) are objects and arrays, and the live copy is a *different* parse of
 * the same stored JSON — so `!==` reported every one of them as freshly typed,
 * which would have let local uploads beat a server copy that genuinely had newer
 * ones. Draft data is plain JSON by construction, so serializing is a fair
 * comparison; when it is not, the mismatch counts as an edit, which errs toward
 * keeping what is on the applicant's screen.
 */
function sameAnswer(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/**
 * Keys the applicant changed in this session, after the local copy was written.
 *
 * The server fetch is a round trip; anything typed while it was in flight is the
 * newest work on the page and must not be replaced by either stored copy.
 *
 * Only **non-empty** live values count. The wizard seeds `formData` with empty
 * defaults for fields nobody has touched, and treating those as edits would make
 * the live object win everywhere and defeat restoring at all. The honest limit:
 * a field *cleared* within the second before the server responds is
 * indistinguishable from an untouched default and can be re-filled by the
 * restore.
 */
function sessionEdits(live, storedData) {
    const edits = {};
    if (!live || typeof live !== 'object') return edits;
    for (const [key, value] of Object.entries(live)) {
        if (isEmpty(value)) continue;
        if (!sameAnswer(value, storedData?.[key])) edits[key] = value;
    }
    return edits;
}

/** Higher of two step indices, treating absent as "no progress". */
function furthestStep(...steps) {
    return steps.reduce((best, step) => (Number.isInteger(step) && step > best ? step : best), 0);
}

/**
 * @param {object} input
 * @param {{ data: object, lastStep: number|null, meta: object|null }|null} input.local
 *   as returned by `readApplicationDraft`. `meta: null` marks a **legacy** draft,
 *   written before sync metadata existed and already sitting in real drivers'
 *   browsers.
 * @param {{ formData: object, stepIndex: number|null, clientSeq: number|null }|null} input.server
 * @param {object} [input.live] the in-memory form data right now
 * @returns {{ formData: object, stepIndex: number, source: string, reason: string }|null}
 *   `null` when there is nothing to restore from either side.
 */
export function reconcileApplicationDraft({ local, server, live } = {}) {
    const hasLocal = Boolean(local && local.data);
    const hasServer = Boolean(server && server.formData);

    if (!hasLocal && !hasServer) return null;

    if (!hasServer) {
        return {
            formData: { ...local.data, ...sessionEdits(live, local.data) },
            stepIndex: furthestStep(local.lastStep),
            source: 'local',
            reason: 'no-server-draft',
        };
    }

    if (!hasLocal) {
        return {
            formData: { ...server.formData, ...sessionEdits(live, null) },
            stepIndex: furthestStep(server.stepIndex),
            source: 'server',
            reason: 'no-local-draft',
        };
    }

    const localWins = decideLocalWins(local, server);

    // The winner's values go last, so they take precedence on overlapping keys;
    // the loser still contributes everything the winner does not have.
    const merged = localWins.wins
        ? { ...server.formData, ...local.data }
        : { ...local.data, ...server.formData };

    return {
        // Typed-this-session always outranks both stored copies.
        formData: { ...merged, ...sessionEdits(live, local.data) },
        // Never backwards: whichever copy won, the applicant keeps the furthest
        // page either of them reached, and the merge above means it has data.
        stepIndex: furthestStep(local.lastStep, server.stepIndex),
        source: localWins.wins ? 'local' : 'server',
        reason: localWins.reason,
    };
}

function decideLocalWins(local, server) {
    // A legacy local draft cannot say whether it holds unsynced work. Progress is
    // the least-lossy proxy available, and the merge means the other side's
    // fields survive either way. Self-resolving: the next local write annotates
    // the draft, and unannotated ones expire with the 30-day retention.
    if (!local.meta) {
        const localStep = furthestStep(local.lastStep);
        const serverStep = furthestStep(server.stepIndex);
        return { wins: localStep > serverStep, reason: 'legacy-progress' };
    }

    // This device holds work the server never acknowledged — a failed, slow or
    // superseded save. This is the case the whole mechanism exists for.
    if (local.meta.localSeq > local.meta.syncedSeq) {
        return { wins: true, reason: 'local-unsynced' };
    }

    // Fully synced locally, but the server copy is not the one we synced: another
    // browser or device advanced it since.
    if (Number.isInteger(server.clientSeq) && server.clientSeq !== local.meta.syncedSeq) {
        return { wins: false, reason: 'server-advanced' };
    }

    // The server copy has no sequence at all — written before `clientSeq`
    // existed. Treat it like a legacy comparison rather than assuming either way.
    if (!Number.isInteger(server.clientSeq)) {
        const localStep = furthestStep(local.lastStep);
        const serverStep = furthestStep(server.stepIndex);
        return { wins: localStep > serverStep, reason: 'server-unsequenced' };
    }

    // Identical: the server holds exactly what this device last synced.
    return { wins: false, reason: 'in-sync' };
}

export default reconcileApplicationDraft;
