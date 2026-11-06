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
const { deliveryChannels, phoneOf } = require('./shared/signingLink');
const { onOptOutList } = require('./shared/smsPermission');
const { claimDelivery } = require('./shared/deliveryClaim');

/** Why a link was not texted to an opted-out number, as the request shows it. */
const OPTED_OUT_REASON = 'Not texted: this number opted out of texts.';

/**
 * Texts a signing request's link to its signer and records on the request how
 * that went. `accessToken` may be a promise of it, and `claim` decides first
 * whether this run sends at all; a failure of either is recorded as a failed send.
 * A number on the opt-out list is not texted (`shared/smsPermission.js`). When
 * the request also goes by email (`deliveryChannels`), that is a note, not a
 * failure: `smsStatus: 'skipped'` with the reason in `smsNote`. When the text
 * was its only channel nothing reached the signer, so it is a failed send with
 * the reason in `smsError`. `reminder` words it as one (`shared/signerReminder.js`).
 */
async function textSigningLink({ companyId, requestId, ref, data, accessToken: token, claim = async () => true, reminder = false }) {
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

        // A number on the opt-out list is not texted. The email goes on its own
        // (`notifySigner`), so beside one the text is only skipped, with why.
        if (await onOptOutList(companyId, data.recipientPhone)) {
            console.log(`[NotifySignerSMS] Not texted: the number of request ${requestId} opted out`);
            await ref.update(deliveryChannels(data).email
                ? { smsStatus: 'skipped', smsNote: OPTED_OUT_REASON }
                : { smsStatus: 'failed', smsError: OPTED_OUT_REASON });
            return;
        }

        const signingLink = signingLinkFor(companyId, requestId, data, accessToken);

        // Compose SMS message
        const senderName = data.senderName || 'Your Employer';
        const docTitle = data.title || 'Document';
        const message = `📄 ${reminder ? 'Reminder: ' : ''}${senderName} sent you "${docTitle}" to sign. Sign here: ${signingLink}`;

        // Get SMS adapter using sender's assigned phone number (smart routing)
        const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, data.senderId);

        // Send the SMS — adapter routes via: sender assignment → default → fallback
        await adapter.sendSMS(data.recipientPhone, message, data.senderId);

        // Update the signing request with SMS delivery status
        await ref.update({
            smsSentAt: admin.firestore.FieldValue.serverTimestamp(),
            smsStatus: 'sent'
        });

        // Ids only: a phone number in a log is read by everyone who reads the project's logs.
        console.log(`[NotifySignerSMS] SMS sent for request ${requestId}`);

    } catch (error) {
        console.error(`[NotifySignerSMS] Failed to send SMS for ${requestId}: ${error?.code || error?.name || 'error'}`);

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
            console.log(`[NotifySignerSMS] Skipped: request ${requestId} asks for no text or has no number`);
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
