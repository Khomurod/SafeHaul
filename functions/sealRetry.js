/**
 * retrySealDocument — "Retry seal" for a signed document that did not seal.
 *
 * Only the company's team (`assertCompanyAccessForRequest`) or a Super Admin
 * may ask, and only for a request whose seal failed (`error_sealing`) or that
 * was left `pending_seal` for more than ten minutes (`shared/sealAttempts.js`:
 * a seal runs 300 s at most, so nothing is sealing it). It takes no values
 * from the caller but which document: it seals what the signer submitted, as
 * stored. In one transaction it records the attempt in `sealAttempts`
 * (`{ at, by, previousStatus, previousError }`), clears `errorLog` and
 * `missingFields`, and sets `pending_seal`; that update is what `sealDocument`
 * seals, once. A signed document, or one that may still be sealing, is refused
 * and nothing is written.
 *
 * The signer's images are kept by every failed seal, so a retry can use them.
 * A failed retry does not notify again: the bell said "Seal failed" for the
 * document once (`seal_failed_<id>`), and the person who retried sees the
 * outcome in the list. A seal that succeeds says "Document signed" as ever.
 *
 * Not a security boundary: the team may write any signing-request field (rules),
 * so it guards against mistakes and concurrent presses, not a team member.
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { sealAttemptCount, sealLeftUnfinished } = require('./shared/sealAttempts');

const notReady = (message) => new HttpsError('failed-precondition', message);

function documentId(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('/')) {
        throw new HttpsError('invalid-argument', `${name} is required.`);
    }
    return value;
}

/** Refuses a request that may not be sealed again now. */
function refuseUnlessRetriable(request) {
    if (request.status === 'error_sealing' || sealLeftUnfinished(request)) return;
    if (request.status === 'signed') throw notReady('This document is already signed and sealed.');
    if (request.status === 'pending_seal') {
        throw notReady('This document is still being sealed. If it has not finished ten minutes after it was signed, try again.');
    }
    throw notReady('Only a signed document whose seal failed can be sealed again.');
}

exports.retrySealDocument = onCall({ cors: true }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');
    const data = request.data || {};
    const companyId = documentId(data.companyId, 'companyId');
    const requestId = documentId(data.requestId, 'requestId');
    await assertCompanyAccessForRequest(request, companyId, 'retrySealDocument');

    const { FieldValue, Timestamp } = admin.firestore;
    const ref = db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId);
    const attempt = await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'This document could not be found.');
        const current = snap.data() || {};
        refuseUnlessRetriable(current);
        txn.update(ref, {
            status: 'pending_seal',
            sealAttempts: FieldValue.arrayUnion({
                at: Timestamp.now(),
                by: request.auth.uid,
                previousStatus: current.status,
                previousError: typeof current.errorLog === 'string' && current.errorLog ? current.errorLog : null,
            }),
            errorLog: FieldValue.delete(),
            missingFields: FieldValue.delete(),
        });
        return sealAttemptCount(current) + 1;
    });

    // Ids only: never the signer, the values or the error text.
    console.log(`[retrySealDocument] companyId=${companyId} requestId=${requestId} attempt=${attempt}`);
    return { success: true, status: 'pending_seal', attempt };
});
