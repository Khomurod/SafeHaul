/**
 * notifySignerSMS.js — FEAT-3: SMS notification for signing requests.
 *
 * Triggered when a signing_request is created with `sendSms: true`.
 * Sends the signing link to the recipient's phone number via the company's
 * configured SMS provider (RingCentral/8x8).
 */
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const SMSAdapterFactory = require('./integrations/factory');
const db = admin.firestore();

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

        try {
            // Read accessToken from secrets subcollection (BUG-2 FIX)
            const secretSnap = await db.collection('companies').doc(companyId)
                .collection('signing_requests').doc(requestId)
                .collection('secrets').doc('token').get();

            // ADV-4: Fallback to parent doc for pre-migration signing requests
            const accessToken = secretSnap.exists ? secretSnap.data().accessToken : (data.accessToken || null);

            if (!accessToken) {
                console.warn(`[NotifySignerSMS] No accessToken found for ${requestId}`);
                return null;
            }

            // DOMAIN FIX: Use the sender's origin domain stored at creation time
            const baseUrl = data.appBaseUrl || process.env.APP_BASE_URL || 'https://app.safehaul.io';
            const signingLink = `${baseUrl}/sign/${companyId}/${requestId}?token=${accessToken}`;

            // Compose SMS message
            const senderName = data.senderName || 'Your Employer';
            const docTitle = data.title || 'Document';
            const message = `📄 ${senderName} sent you "${docTitle}" to sign. Sign here: ${signingLink}`;

            // Get SMS adapter using sender's assigned phone number (smart routing)
            const adapter = await SMSAdapterFactory.getAdapterForUser(companyId, data.senderId);

            // Send the SMS — adapter routes via: sender assignment → default → fallback
            await adapter.sendSMS(data.recipientPhone, message, data.senderId);

            // Update the signing request with SMS delivery status
            await db.collection('companies').doc(companyId)
                .collection('signing_requests').doc(requestId)
                .update({
                    smsSentAt: admin.firestore.FieldValue.serverTimestamp(),
                    smsStatus: 'sent'
                });

            console.log(`[NotifySignerSMS] SMS sent to ${data.recipientPhone} for request ${requestId}`);
            return { success: true };

        } catch (error) {
            console.error(`[NotifySignerSMS] Failed to send SMS for ${requestId}:`, error);

            // Log failure but don't crash the function
            try {
                await db.collection('companies').doc(companyId)
                    .collection('signing_requests').doc(requestId)
                    .update({
                        smsStatus: 'failed',
                        smsError: error.message
                    });
            } catch (updateErr) {
                console.error('[NotifySignerSMS] Failed to update smsStatus:', updateErr);
            }

            return null;
        }
    }
);
