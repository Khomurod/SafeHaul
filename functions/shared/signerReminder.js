/**
 * signerReminder.js — what sending an unsigned document's link to its signer
 * again is, for a team member's Remind (`remindSigner.js`) and the automatic
 * reminder (`remindUnsignedSigners.js`): the one set of rules both follow.
 *
 * Only a request still waiting for its signer (`sent`) is reminded, its link
 * expired or not. The link goes again on each channel the request sends by
 * (`deliveryChannels`): email unless switched off, a text when asked for. It is
 * the same link with seven more days or, when a correction left it with an
 * email or phone the request no longer has, a new one; the same rules every
 * sender settles a link by (`settleSigningLink` in resend mode,
 * `signingLink.js`).
 *
 * One reminder is one send: `claimReminder`, in the caller's transaction,
 * refuses a reminder within ten minutes of the last (`details.reason:
 * 'cooldown'`), records this one in `reminders` (`{ count, lastAt, lastBy }`)
 * and claims the channels, all before anything is sent. Nothing it writes
 * changes where the link goes, so the correction trigger sends nothing more.
 * `deliverReminder` then sends each claimed channel once, and a reminder whose
 * every send failed puts `reminders` back as it was, so it neither counts nor
 * holds up the next one.
 *
 * Texts follow the signing-text rules: a request for an application
 * (`sourceApplicationId`) is texted only after the driver's explicit "Yes" to
 * texts (`sms-consent`, `smsPermission.js`); a number on the opt-out list is
 * never texted (`textSigningLink` records why: skipped beside an email, else
 * failed). With no channel left the
 * reminder is refused with the reason (`details.reason: 'no-channel'`),
 * writing nothing.
 *
 * A refusal is an `HttpsError` `failed-precondition` thrown inside the
 * transaction, so nothing the claim wrote is kept.
 */
const { HttpsError } = require('firebase-functions/v2/https');
const { admin } = require('../firebaseAdmin');
const { agreedToSms } = require('./smsPermission');
const { deliveryChannels, settleSigningLink } = require('./signingLink');
const { COMPLETED_REQUEST_STATUSES } = require('./postApplicationRequest');
const { emailSigningLink } = require('../notifySigner');
const { textSigningLink } = require('../notifySignerSMS');

/** The least time between two reminders of one document. */
const REMINDER_COOLDOWN_MS = 10 * 60 * 1000;

const NO_LINK = 'This document has no working link to send. Void it and send it again.';
const COPIED_LINK = 'This document was shared by a copied link, not sent by email or text, so there is nothing '
    + 'to send again. Correct it to add an email address or a phone number.';
const NO_TEXT = 'Not sent: this document is sent only by text, and the driver did not answer Yes to text messages.';

const refusal = (message, reason) => new HttpsError('failed-precondition', message, reason ? { reason } : undefined);

/** Whether `error` is a reminder refused for its reason (not a failure to retry). */
const isRefusal = (error) => error instanceof HttpsError && error.code === 'failed-precondition';

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

/**
 * In transaction `tx`, after it read request `ref` (of `companyRef`) as `data`:
 * refuses a reminder that may not go, else records it in `reminders` as sent by
 * `by` (with `record`, written in the same update) and claims its channels.
 * Answers what `deliverReminder` sends: the token, the channels claimed, and
 * whether a text was left out for want of the driver's "Yes".
 */
async function claimReminder(tx, { companyRef, ref, data, by, record = {} }) {
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
                lastBy: by,
            },
            ...record,
        },
    });
    // Thrown inside the transaction, so nothing it wrote is kept.
    if (!settled.accessToken) throw refusal(NO_LINK);
    return { data, ...settled, textSkipped: channels.sms && !texts };
}

/**
 * Puts back the reminder record as it was before a claim whose every send
 * failed. Best effort: a release that fails leaves the ten-minute wait.
 */
async function releaseReminder(ref, before, requestId, logTag) {
    try {
        await ref.update({ reminders: before.reminders ?? admin.firestore.FieldValue.delete() });
    } catch (error) {
        console.error(`[${logTag}] requestId=${requestId} could not release the reminder: ${error.message}`);
    }
}

/**
 * Sends a reminder `claimReminder` claimed: each channel once, its sender
 * recording on the request how it went. Answers that, not the claim: the
 * channels that `went`, the text `skipped` for an opted-out number beside an
 * email, and those claimed that `failed`. One that reached no one is not one:
 * `reminders` goes back as it was.
 */
async function deliverReminder({ companyId, requestId, ref, claimed, logTag }) {
    const { data, accessToken } = claimed;
    if (claimed.email) {
        await emailSigningLink({
            companyId, requestId, ref, data, accessToken, replacesEarlierLink: claimed.emailHeldOldLink, reminder: true,
        });
    }
    if (claimed.sms) await textSigningLink({ companyId, requestId, ref, data, accessToken, reminder: true });

    const after = (await ref.get()).data() || {};
    const went = { email: claimed.email && after.emailStatus === 'sent', sms: claimed.sms && after.smsStatus === 'sent' };
    const skipped = { sms: claimed.sms && after.smsStatus === 'skipped' };
    const failed = { email: claimed.email && !went.email, sms: claimed.sms && !went.sms && !skipped.sms };

    if (!went.email && !went.sms) await releaseReminder(ref, data, requestId, logTag);
    return { went, skipped, failed };
}

module.exports = { REMINDER_COOLDOWN_MS, claimReminder, deliverReminder, isRefusal, millisOf };
