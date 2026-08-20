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

import STANDARD_SECTIONS from '../../../../../functions/shared/applicationSections.json';

/**
 * Field ids the shared schema marks as repeating rows.
 *
 * Derived, not hand-listed: `functions/shared/applicationSections.json` is the
 * one table both runtimes read, so a repeating field added there is covered here
 * without anybody remembering to. Today that is previousAddresses,
 * additionalLicenses, violations, accidents, employers, unemployment, schools and
 * military — and the point is that the list is not written down twice.
 */
const REPEATING_FIELDS = new Set(
    STANDARD_SECTIONS.flatMap((section) => (section.fields || [])
        .filter((field) => field.repeating)
        .map((field) => field.id)),
);

/**
 * Fields whose object keys are *independent answers* rather than parts of one.
 *
 * `customAnswers` is `{ [questionKey]: answer }` — a company's custom questions,
 * each answered separately — so a per-key merge is the only correct one: if one
 * copy answered question A and the other answered B, taking the winner's whole
 * object throws one answer away.
 *
 * It is explicit rather than derived because custom questions are defined per
 * company and so are absent from the shared schema. Every *other* object-valued
 * field is a value object — an upload is `{ name, url, storagePath }` — where
 * per-key merging would be actively wrong, stitching one file's name onto
 * another's URL. `reconcileApplicationDraft.test.js` asserts that every
 * object-shaped field in the schema is still accounted for, so this cannot rot
 * silently.
 */
const KEYED_ANSWER_MAPS = new Set(['customAnswers']);

/**
 * Ceiling on a merged repeating field.
 *
 * The server sanitizer caps arrays at 60 rows and rejects an oversized payload
 * outright, and a rejected payload means autosave stops. Capping here keeps a
 * union from growing past what the server will accept.
 */
const MAX_MERGED_ROWS = 60;

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

/** Every cell of a repeating row is blank, so the row is a template, not an answer. */
function isBlankRow(row) {
    if (!Array.isArray(row)) return isEmpty(row);
    return row.every((cell) => isEmpty(cell));
}

function fingerprint(value) {
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Winner's rows, plus any loser row the winner does not already have.
 *
 * Repeating rows have no stable identity — they are arrays of cells — so there is
 * no key to merge on and no way to tell an edited row from a different one. The
 * choice is therefore between dropping rows the loser alone has and keeping a row
 * the applicant may have deleted elsewhere.
 *
 * Keeping wins. A dropped employer is retyping, and under 49 CFR 391.21 the
 * application has to account for three years — while a row that comes back is
 * visible on the Review page and can be deleted again. Losing an applicant's work
 * silently is the failure this whole mechanism exists to prevent; a visible
 * duplicate is not.
 */
function unionRows(winnerRows, loserRows) {
    const merged = [...winnerRows];
    const seen = new Set(winnerRows.map(fingerprint));

    for (const row of loserRows) {
        if (merged.length >= MAX_MERGED_ROWS) break;
        if (isBlankRow(row)) continue;
        const print = fingerprint(row);
        if (seen.has(print)) continue;
        seen.add(print);
        merged.push(row);
    }
    return merged;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Merges one field, respecting what its shape means.
 *
 * The winner decides genuine conflicts; the loser still contributes anything the
 * winner has no answer for. A flat spread got this wrong for everything nested:
 * the winner's whole `customAnswers` object replaced the loser's, so an answer
 * that existed only on the losing copy was thrown away even though nothing about
 * it was in conflict.
 */
function mergeField(key, loserValue, winnerValue) {
    if (loserValue === undefined) return winnerValue;
    if (winnerValue === undefined) return loserValue;

    if (REPEATING_FIELDS.has(key) && Array.isArray(winnerValue) && Array.isArray(loserValue)) {
        return unionRows(winnerValue, loserValue);
    }

    if (KEYED_ANSWER_MAPS.has(key) && isPlainObject(winnerValue) && isPlainObject(loserValue)) {
        // Per key: the winner takes every question it answered, and a question
        // only the loser answered survives untouched.
        return { ...loserValue, ...winnerValue };
    }

    // Scalars, and value objects like an upload, where the winner's answer is the
    // whole answer and mixing halves would corrupt it.
    return winnerValue;
}

/** Merges two draft bodies, with `winner` deciding every genuine conflict. */
function mergeDraftData(loser, winner) {
    const merged = { ...(loser || {}) };
    for (const [key, winnerValue] of Object.entries(winner || {})) {
        merged[key] = mergeField(key, merged[key], winnerValue);
    }
    return merged;
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

    // Field-aware, not a flat spread. The winner decides genuine conflicts, but a
    // nested answer the loser alone holds — a custom question, an employer row —
    // is not a conflict and must survive. See `mergeField`.
    const merged = localWins.wins
        ? mergeDraftData(server.formData, local.data)
        : mergeDraftData(local.data, server.formData);

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

/** Exposed so a test can prove the classification still matches the shared schema. */
export const __private = { REPEATING_FIELDS, KEYED_ANSWER_MAPS, MAX_MERGED_ROWS, mergeDraftData };

export default reconcileApplicationDraft;
