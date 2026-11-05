/**
 * remindSigner.js — Remind: a team member sends an unsigned document's signing
 * link to its signer again, from the document's details or the dossier.
 *
 * What a reminder is (`shared/signerReminder.js`, shared with the automatic
 * reminder, `remindUnsignedSigners.js`): only a request still waiting for its
 * signer (`sent`), its link expired or not; the link again on each channel the
 * request sends by, with seven more days, or a new one when a correction left
 * it with an email or phone the request no longer has (`settleSigningLink` in
 * resend mode); a text to an application's driver only after their explicit
 * "Yes" (`sms-consent`), as Send to driver, and never to a number on the
 * opt-out list (`textSigningLink` records why).
 *
 * One press is one send: one transaction refuses a reminder within ten minutes
 * of the last (`details.reason: 'cooldown'`), records this one in `reminders`
 * (`{ count, lastAt, lastBy }`, `lastBy` the caller's uid) and claims the
 * channels, all before anything is sent. A reminder whose every send failed
 * puts `reminders` back as it was, so it neither counts nor holds up the next
 * press. With no channel left the press is refused with the reason
 * (`details.reason: 'no-channel'`), writing nothing.
 *
 * It answers with what each sender recorded: `channels` that went and, when a
 * claimed one did not (an SMTP error, an opted-out number), `failed`, whose
 * reason the document's details show (`emailError`, `smsError`).
 *
 * Not a security boundary: the team may write any signing-request field (rules).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { REMINDER_COOLDOWN_MS, claimReminder, deliverReminder } = require('./shared/signerReminder');

function documentId(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('/')) {
        throw new HttpsError('invalid-argument', `${name} is required.`);
    }
    return value;
}

exports.remindSigner = onCall({ cors: true, secrets: ['SMS_ENCRYPTION_KEY'] }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to send a reminder.');
    const companyId = documentId(request.data?.companyId, 'companyId');
    const requestId = documentId(request.data?.requestId, 'requestId');
    await assertCompanyAccessForRequest(request, companyId, 'remindSigner');

    const companyRef = db.collection('companies').doc(companyId);
    const ref = companyRef.collection('signing_requests').doc(requestId);
    const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new HttpsError('not-found', 'This document could not be found.');
        return claimReminder(tx, { companyRef, ref, data: snap.data() || {}, by: request.auth.uid });
    });

    // Claimed: each channel once, answered as each sender recorded it.
    const { went, failed } = await deliverReminder({ companyId, requestId, ref, claimed, logTag: 'remindSigner' });

    // Ids only, never tokens or contact details.
    console.log(`[remindSigner] companyId=${companyId} requestId=${requestId} email=${went.email} sms=${went.sms}`);
    return {
        success: true,
        requestId,
        channels: went,
        ...((failed.email || failed.sms) && { failed }),
        ...(claimed.textSkipped && { textSkipped: 'no-sms-consent' }),
    };
});

exports.REMINDER_COOLDOWN_MS = REMINDER_COOLDOWN_MS;
