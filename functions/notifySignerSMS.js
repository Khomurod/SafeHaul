/**
 * notifySignerSMS.js — FEAT-3: SMS notification for signing requests.
 *
 * Triggered when a signing_request is created with `sendSms: true`.
 * Sends the signing link to the recipient's phone number via the company's
 * configured SMS provider (RingCentral/8x8).
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { admin } = require('./firebaseAdmin');
const SMSAdapterFactory = require('./integrations/factory');
const { readSigningToken, signingLinkFor } = require('./notifySigner');
const { phoneOf } = require('./shared/signingLink');
const db = admin.firestore();

/**
 * Claims a signing request's delivery for one event, in a transaction: true for
 * the first run that claims it under `field`, false for any other. Firestore
 * delivers an event at least once, so a trigger can run twice for one event.
 * `record` is written with the claim.
 */
function claimDelivery(ref, field, eventId, record = {}) {
    return db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (current.get(field) === eventId) return false;
        tx.update(ref, { [field]: eventId, ...record });
        return true;
    });
}

/**
 * Texts a signing request's link to its signer and records on the request how
 * that went. `accessToken` may be a promise of it, and `claim` decides first
 * whether this run sends at all; a failure of either is recorded as a failed send.
 */
async function textSigningLink({ companyId, requestId, ref, data, accessToken: token, claim = async () => true }) {
    try {
        if (!(await claim())) {
            console.log(`[NotifySignerSMS] Skipped: request ${requestId} is already texted for this event`);
            return;
        }
        const accessToken = await token;
        if (!accessToken) {
            console.warn(`[NotifySignerSMS] No accessToken found for ${requestId}`);
            return;
        }

        const signingLink = signingLinkFor(companyId, requestId, data, accessToken);

        // Compose SMS message
        const senderName = data.senderName || 'Your Employer';
        const docTitle = data.title || 'Document';
        const message = `📄 ${senderName} sent you "${docTitle}" to sign. Sign here: ${signingLink}`;

        // Get SMS adapter using sender's assigned phone number (smart routing)
        const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, data.senderId);

        // Send the SMS — adapter routes via: sender assignment → default → fallback
        await adapter.sendSMS(data.recipientPhone, message, data.senderId);

        // Update the signing request with SMS delivery status
        await ref.update({
            smsSentAt: admin.firestore.FieldValue.serverTimestamp(),
            smsStatus: 'sent'
        });

        console.log(`[NotifySignerSMS] SMS sent to ${data.recipientPhone} for request ${requestId}`);

    } catch (error) {
        console.error(`[NotifySignerSMS] Failed to send SMS for ${requestId}:`, error);

        // Log failure but don't crash the function
        try {
            await ref.update({
                smsStatus: 'failed',
                smsError: error.message
            });
        } catch (updateErr) {
            console.error('[NotifySignerSMS] Failed to update smsStatus:', updateErr);
        }
    }
}

exports.notifySignerSMS = onDocumentCreated(
    {
        document: 'companies/{companyId}/signing_requests/{requestId}',
        region: 'us-central1',
        secrets: ['SMS_ENCRYPTION_KEY']
    },
    async (event) => {
        const data = event.data.data();
        const { companyId, requestId } = event.params;

        // Only proceed if SMS delivery was requested
        if (!data.sendSms || !data.recipientPhone) {
            console.log(`[NotifySignerSMS] Skipped: sendSms=${data.sendSms}, recipientPhone=${data.recipientPhone}`);
            return null;
        }

        const ref = event.data.ref;
        await textSigningLink({
            companyId,
            requestId,
            ref,
            data,
            accessToken: readSigningToken(ref, data),
            // The phone goes into `linkSentTo` with the claim, before the text
            // is sent (`shared/signingLink.js`).
            claim: () => claimDelivery(ref, 'smsDeliveryId', event.id, { 'linkSentTo.phone': phoneOf(data) }),
        });
        return null;
    }
);

exports.claimDelivery = claimDelivery;
exports.textSigningLink = textSigningLink;
