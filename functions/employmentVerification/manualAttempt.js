/**
 * PEV — a phone call, fax or note a recruiter records against an employer's
 * request ("Record attempt" on the PEV tab).
 *
 * The team cannot write `verification_requests` (rules), so this callable adds
 * the entry to the request's attempt log (./attemptLog.js) and its short copy to
 * the employer row in one transaction: the row never shows an attempt the log
 * lacks, and the row is read and written together, as every server writer of
 * it does (./employerMirror.js).
 *
 * The entry is dated the day the recruiter gives (12:00 UTC, so it reads as
 * that day in any US time zone) and keeps when it was recorded and by whom.
 */
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");
const { assertCompanyAccessForRequest } = require("../shared/companyAccess");
const { resolveEmployerTarget } = require("../shared/employerIdentity");
const { clipText } = require("../shared/plainText");
const { mirrorInTransaction } = require("./employerMirror");
const { LIVE_STATUSES, requestsForEmployer } = require("./requestLifecycle");
const { MANUAL_KINDS, attemptEntry, rowEntryOf, teamMemberName, withAttempt } = require("./attemptLog");

const ALLOWED_COLLECTIONS = ['applications', 'leads'];
const NOTE_CHARS = 300;
/** Recorded attempts one request holds at most, which keeps the request far under Firestore's size limit. */
const MAX_RECORDED = 50;
/** How far ahead of the server's clock a day may be: a recruiter east of UTC is already in tomorrow. */
const FUTURE_SLACK_MS = 36 * 60 * 60 * 1000;

/** A `YYYY-MM-DD` calendar day as 12:00 UTC that day, or null. */
function dayOf(date) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const at = new Date(`${date}T12:00:00.000Z`);
    return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === date ? at : null;
}

const createdMs = (doc) => doc.data()?.createdAt?.toMillis?.() || 0;

/** The request an attempt belongs to: the employer's newest live one, else its newest a resend did not replace. */
function pickRequest(docs) {
    const newest = [...docs].sort((a, b) => createdMs(b) - createdMs(a));
    return newest.find((doc) => LIVE_STATUSES.includes(doc.data()?.status))
        || newest.find((doc) => doc.data()?.status !== 'superseded')
        || newest[0]
        || null;
}

function validate(data) {
    const { companyId, applicationId, collectionName = 'applications', employerIndex, kind, date, note } = data;
    if (!companyId || !applicationId) throw new HttpsError('invalid-argument', 'Missing required fields.');
    if (!ALLOWED_COLLECTIONS.includes(collectionName)) {
        throw new HttpsError('invalid-argument', `Invalid collection: ${collectionName}`);
    }
    const index = Number(employerIndex);
    if (!Number.isInteger(index) || index < 0) {
        throw new HttpsError('invalid-argument', 'employerIndex must be a non-negative integer.');
    }
    if (!Object.hasOwn(MANUAL_KINDS, kind)) throw new HttpsError('invalid-argument', 'Choose a phone call, a fax or a note.');
    const day = dayOf(date);
    if (!day) throw new HttpsError('invalid-argument', 'Give the day of the attempt.');
    if (day.getTime() > Date.now() + FUTURE_SLACK_MS) throw new HttpsError('invalid-argument', 'The day cannot be in the future.');
    const text = clipText(note, NOTE_CHARS);
    if (kind === 'note' && !text) throw new HttpsError('invalid-argument', 'Write the note.');
    return { companyId, applicationId, collectionName, index, kind, day, text };
}

exports.recordVerificationAttempt = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const { companyId, applicationId, collectionName, index, kind, day, text } = validate(request.data || {});
    const { employerId, employerName } = request.data;
    await assertCompanyAccessForRequest(request, companyId, 'PEV/recordVerificationAttempt');

    const record = { companyId, collectionName, applicationId };
    const recordRef = db.collection('companies').doc(companyId).collection(collectionName).doc(applicationId);
    // The name the press was on: a row without an id is trusted at its index
    // only while it is still that employer (`resolveEmployerTarget`).
    const identity = { employerId, employerIndex: index, employerName };
    const gone = () => new HttpsError('not-found', 'That employer is no longer on this application. Refresh and try again.');

    const snap = await recordRef.get();
    const employers = snap.exists ? snap.data()?.employers || [] : [];
    const target = resolveEmployerTarget(employers, identity);
    if (!target) throw gone();
    const chosen = pickRequest(await requestsForEmployer(record, employers, target.index));
    if (!chosen) throw new HttpsError('failed-precondition', 'Send a verification request to this employer first.');

    const company = (await db.collection('companies').doc(companyId).get()).data() || {};
    const entry = attemptEntry(kind, {
        at: admin.firestore.Timestamp.fromMillis(day.getTime()),
        by: request.auth.uid,
        note: text,
        recordedAt: admin.firestore.Timestamp.now(),
    });

    const verification = await db.runTransaction(async (tx) => {
        const stored = (await tx.get(chosen.ref)).data() || {};
        // A resend replaced it since it was picked: its day-30 record is never
        // made, so the attempt would be lost from the good-faith record.
        if (stored.status === 'superseded') {
            throw new HttpsError('failed-precondition', 'This request was replaced by a newer one. Refresh and try again.');
        }
        const held = (stored.attempts || []).filter((attempt) => Object.hasOwn(MANUAL_KINDS, attempt?.kind)).length;
        if (held >= MAX_RECORDED) {
            throw new HttpsError('resource-exhausted', `This request already holds ${MAX_RECORDED} recorded attempts.`);
        }
        const mirrored = await mirrorInTransaction(tx, recordRef, identity, (current) => {
            if (!current.status) current.status = 'Not Started';
            current.history.push(rowEntryOf(entry, { recordedBy: teamMemberName(company, request.auth.uid) }));
        });
        if (!mirrored) throw gone();
        tx.update(chosen.ref, withAttempt({}, entry));
        return mirrored.verification;
    });

    return { success: true, verification };
});
