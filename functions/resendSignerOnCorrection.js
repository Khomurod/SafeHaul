/**
 * resendSignerOnCorrection.js — a corrected signing request goes out again.
 *
 * A request is sent once, when it is created (`notifySigner`, `notifySignerSMS`).
 * A recruiter who corrects the email or phone the link went to (Correct
 * Document) is saying it went to the wrong place, so the request gets a new
 * token, the old link stops working, and the new link goes out on every channel
 * the request uses. A contact the link never went to, or a channel the
 * correction switches on, gets the current link. Only an unsigned request
 * (`sent`) is sent again. `correctionDelivery` in `envelopePersistence.js`
 * follows the same rule to word its confirmation: change both.
 */
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { randomUUID } = require('crypto');
const { emailSigningLink, readSigningToken } = require('./notifySigner');
const { claimDelivery, textSigningLink } = require('./notifySignerSMS');
const { normalizePhone } = require('./shared/normalizePhone');

const emailOf = (data) => (typeof data?.recipientEmail === 'string' ? data.recipientEmail.trim().toLowerCase() : '');
const phoneOf = (data) => normalizePhone(data?.recipientPhone)
    || (typeof data?.recipientPhone === 'string' ? data.recipientPhone.replace(/\D/g, '') : '');
// As the creation triggers read them: email unless switched off, a text only when asked for.
const emailsLink = (data) => data.sendEmail !== false && Boolean(emailOf(data));
const textsLink = (data) => Boolean(data.sendSms) && Boolean(phoneOf(data));

/**
 * What a change to a signing request sends, or null for nothing: `newToken`
 * when a contact the link went to changed, and the channels to send on.
 */
function correctionDelivery(before, after) {
    if (!before || !after || after.status !== 'sent') return null;
    const emailChanged = emailOf(before) !== emailOf(after);
    const phoneChanged = phoneOf(before) !== phoneOf(after);
    const newToken = (emailChanged && emailsLink(before)) || (phoneChanged && textsLink(before));
    const email = emailsLink(after) && (newToken || emailChanged || !emailsLink(before));
    const sms = textsLink(after) && (newToken || phoneChanged || !textsLink(before));
    if (!newToken && !email && !sms) return null;
    return { newToken, email, sms };
}

exports.resendSignerOnCorrection = onDocumentUpdated(
    {
        document: 'companies/{companyId}/signing_requests/{requestId}',
        region: 'us-central1',
        secrets: ['SMS_ENCRYPTION_KEY']
    },
    async (event) => {
        const after = event.data.after.data();
        const delivery = correctionDelivery(event.data.before.data(), after);
        if (!delivery) return null;

        const { companyId, requestId } = event.params;
        const ref = event.data.after.ref;
        // Firestore delivers an event at least once: only the first run for a
        // correction replaces the token and sends.
        if (!(await claimDelivery(ref, 'correctionDeliveryId', event.id))) return null;

        let accessToken;
        if (delivery.newToken) {
            // The signing room and Copy Link read `secrets/token` before any
            // older token kept on the request itself, so this retires both.
            accessToken = randomUUID();
            await ref.collection('secrets').doc('token').set({ accessToken });
        } else {
            accessToken = await readSigningToken(ref, after);
        }

        if (delivery.email) {
            await emailSigningLink({ companyId, requestId, ref, data: after, accessToken, replacesEarlierLink: delivery.newToken });
        }
        if (delivery.sms) {
            await textSigningLink({ companyId, requestId, ref, data: after, accessToken });
        }
        return null;
    }
);

exports.correctionDelivery = correctionDelivery;
