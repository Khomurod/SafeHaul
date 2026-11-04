/**
 * remindSigner.js — Remind: a team member sends an unsigned document's signing
 * link to its signer again, from the document's details or the dossier.
 *
 * Only a request still waiting for its signer (`sent`) is reminded, its link
 * expired or not. The link goes again on each channel the request sends by
 * (`deliveryChannels`): email unless switched off, a text when asked for. It is
 * the same link with seven more days or, when a correction left it with an
 * email or phone the request no longer has, a new one; the same rules every
 * sender settles a link by (`settleSigningLink` in resend mode,
 * `shared/signingLink.js`).
 *
 * One press is one send: one transaction refuses a reminder within ten minutes
 * of the last (`details.reason: 'cooldown'`), records this one in `reminders`
 * (`{ count, lastAt, lastBy }`) and claims the channels, all before anything is
 * sent. Nothing it writes changes where the link goes, so the correction trigger
 * sends nothing more.
 *
 * Texts follow the signing-text rules: a request for an application
 * (`sourceApplicationId`) is texted only after the driver's explicit "Yes" to
 * texts (`sms-consent`), as Send to driver; a number on the opt-out list is
 * never texted (`textSigningLink` records why). With no channel left the press
 * is refused with the reason (`details.reason: 'no-channel'`), writing nothing.
 *
 * Not a security boundary: the team may write any signing-request field (rules).
 */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db } = require('./firebaseAdmin');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { agreedToSms } = require('./shared/smsPermission');
const { deliveryChannels, settleSigningLink } = require('./shared/signingLink');
const { COMPLETED_REQUEST_STATUSES } = require('./shared/postApplicationRequest');
const { emailSigningLink } = require('./notifySigner');
const { textSigningLink } = require('./notifySignerSMS');

/** The least time between two reminders of one document. */
const REMINDER_COOLDOWN_MS = 10 * 60 * 1000;

const NO_LINK = 'This document has no working link to send. Void it and send it again.';
const COPIED_LINK = 'This document was shared by a copied link, not sent by email or text, so there is nothing '
    + 'to send again. Correct it to add an email address or a phone number.';
const NO_TEXT = 'Not sent: this document is sent only by text, and the driver did not answer Yes to text messages.';

const refusal = (message, reason) => new HttpsError('failed-precondition', message, reason ? { reason } : undefined);

function documentId(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > 200 || value.includes('/')) {
        throw new HttpsError('invalid-argument', `${name} is required.`);
    }
    return value;
}

function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
    return null;
}

/** Refuses a request that is not waiting for its signer. */
function refuseUnlessWaiting(data) {
    const status = typeof data.status === 'string' ? data.status.trim() : '';
    if (status === 'sent') return;
    if (COMPLETED_REQUEST_STATUSES.has(status)) throw refusal('This document is already signed, so no reminder is sent.');
    if (status === 'voided') throw refusal('This document was voided, so no reminder is sent.');
    if (status === 'processing') throw refusal('The signer is submitting this document right now.');
    throw refusal('Only a document waiting for its signature can be reminded.');
}

/** Refuses a reminder within ten minutes of the last, saying when the next may go. */
function refuseWithinCooldown(data, now) {
    const last = millisOf(data.reminders?.lastAt);
    if (last === null || now - last >= REMINDER_COOLDOWN_MS) return;
    const minutes = Math.max(1, Math.ceil((last + REMINDER_COOLDOWN_MS - now) / 60000));
    throw refusal(
        `A reminder was sent less than ten minutes ago. You can send another in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        'cooldown',
    );
}

/** Whether the request's signer may be texted: an application's driver only after their "Yes". */
async function textAllowed(tx, companyRef, data) {
    const applicationId = typeof data.sourceApplicationId === 'string' ? data.sourceApplicationId.trim() : '';
    if (!applicationId) return true;
    if (applicationId.includes('/')) return false;
    const application = await tx.get(companyRef.collection('applications').doc(applicationId));
    return application.exists && agreedToSms(application.data());
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
        const data = snap.data() || {};
        refuseUnlessWaiting(data);
        refuseWithinCooldown(data, Date.now());

        const channels = deliveryChannels(data);
        const texts = channels.sms && await textAllowed(tx, companyRef, data);
        if (!channels.email && !texts) throw refusal(channels.sms ? NO_TEXT : COPIED_LINK, 'no-channel');

        const settled = await settleSigningLink(tx, ref, data, {
            resend: { email: channels.email, sms: texts },
            record: {
                reminders: {
                    count: (Number(data.reminders?.count) || 0) + 1,
                    lastAt: admin.firestore.Timestamp.now(),
                    lastBy: request.auth.uid,
                },
            },
        });
        // Thrown inside the transaction, so nothing it wrote is kept.
        if (!settled.accessToken) throw refusal(NO_LINK);
        return { data, ...settled, textSkipped: channels.sms && !texts };
    });

    // Claimed: each channel once, its sender recording on the request how it went.
    const { data, accessToken } = claimed;
    if (claimed.email) {
        await emailSigningLink({
            companyId, requestId, ref, data, accessToken, replacesEarlierLink: claimed.emailHeldOldLink, reminder: true,
        });
    }
    if (claimed.sms) await textSigningLink({ companyId, requestId, ref, data, accessToken, reminder: true });

    // Ids only, never tokens or contact details.
    console.log(`[remindSigner] companyId=${companyId} requestId=${requestId} email=${claimed.email} sms=${claimed.sms}`);
    return {
        success: true,
        requestId,
        channels: { email: claimed.email, sms: claimed.sms },
        ...(claimed.textSkipped && { textSkipped: 'no-sms-consent' }),
    };
});

exports.REMINDER_COOLDOWN_MS = REMINDER_COOLDOWN_MS;
