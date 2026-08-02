// functions/notifySigner.js
// C1 FIX: Now uses the unified sendDynamicEmail() from emailService.js
// instead of its own hardcoded Gmail transporter.
// This means any SMTP provider configured in Company Settings will now work for signing emails.

const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin');
const { sendDynamicEmail } = require('./emailService');

exports.notifySigner = functions.firestore
    .document('companies/{companyId}/signing_requests/{requestId}')
    .onCreate(async (snap, context) => {
        const data = snap.data();
        const { companyId, requestId } = context.params;

        // FEAT-4: Skip email if sendEmail is explicitly false (Copy Link or SMS-only)
        if (data.sendEmail === false) {
            console.log(`[Notify] Skipped: sendEmail is false for request ${requestId}`);
            return null;
        }

        // BUG-2 FIX: Read accessToken from secrets subcollection
        const secretSnap = await db.collection('companies').doc(companyId)
            .collection('signing_requests').doc(requestId)
            .collection('secrets').doc('token').get();
        // ADV-4 FIX: Fallback to parent doc for pre-migration signing requests
        const accessToken = secretSnap.exists ? secretSnap.data().accessToken : (data.accessToken || null);

        // 1. Validate required fields before proceeding
        if (!data.recipientEmail || !accessToken) {
            console.warn(`[Notify] Skipped: Missing recipientEmail or accessToken for request ${requestId}`);
            return null;
        }

        // 2. Build signing link
        // DOMAIN FIX: Use the sender's origin domain stored at creation time,
        // falling back to env var, then hardcoded default for pre-migration docs.
        const baseUrl = data.appBaseUrl || process.env.APP_BASE_URL || 'https://app.safehaul.io';
        const signingLink = `${baseUrl}/sign/${companyId}/${requestId}?token=${accessToken}`;

        // 3. Build professional HTML email body (kept from original)
        const subject = `Action Required: Please Sign "${data.title || 'Document'}"`;
        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f8fafc; padding: 24px; border-radius: 8px;">
                <div style="background: white; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <div style="background: #2563eb; color: white; padding: 16px 24px; border-radius: 8px; margin-bottom: 24px;">
                        <h1 style="margin: 0; font-size: 20px;">📄 Document Signing Request</h1>
                    </div>
                    <p style="color: #374151; font-size: 16px;">Hello <strong>${data.recipientName || 'there'}</strong>,</p>
                    <p style="color: #4b5563;">You have a document that requires your signature. Please click the button below to review and sign it securely.</p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${signingLink}"
                           style="display: inline-block; background: #16a34a; color: white; text-decoration: none;
                                  padding: 14px 32px; border-radius: 8px; font-size: 16px; font-weight: bold;">
                            ✍️ Review & Sign Document
                        </a>
                    </div>
                    <div style="background: #f1f5f9; padding: 16px; border-radius: 6px; margin: 24px 0;">
                        <p style="margin: 0; color: #475569; font-size: 14px;">
                            <strong>Document:</strong> ${data.title || 'Untitled'}<br>
                            <strong>Requested by:</strong> ${data.senderName || 'Your Employer'}
                        </p>
                    </div>
                    <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
                        This link is secure and unique to you. If you did not expect this document, please ignore this email. Powered by SafeHaul.
                    </p>
                </div>
            </div>
        `;

        // 4. Send via unified email service (uses company's own SMTP settings)
        try {
            await sendDynamicEmail(companyId, data.recipientEmail, subject, html);
            console.log(`[Notify] Signing email sent to ${data.recipientEmail} for request ${requestId}`);

            // 5. Update Firestore with sent timestamp
            await snap.ref.update({
                emailSentAt: new Date().toISOString(),
                emailStatus: 'sent'
            });

        } catch (err) {
            console.error(`[Notify] Failed to send signing email for ${requestId}:`, err.message);
            await snap.ref.update({
                emailSentAt: new Date().toISOString(),
                emailStatus: 'failed',
                emailError: err.message
            });
        }

        return null;
    });