const functions = require('firebase-functions/v1');
const { db } = require('./firebaseAdmin'); // Use the shared admin instance
const nodemailer = require('nodemailer');

exports.notifySigner = functions.firestore
  .document('companies/{companyId}/signing_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { companyId, requestId } = context.params;

    // 1. Basic Check: Do we need to send an email?
    if (!data.sendEmail || !data.recipientEmail) {
        console.log(`[Notify] Skipped ${requestId}: sendEmail false or missing recipient.`);
        return null;
    }

    try {
        console.log(`[Notify] Preparing email for ${requestId}`);

        // 2. Fetch Company Settings for Custom Email Credentials
        const companySnap = await db.collection('companies').doc(companyId).get();
        if (!companySnap.exists) {
            console.error(`[Notify] Company ${companyId} not found.`);
            return null;
        }

        const companyData = companySnap.data();
        const settings = companyData.emailSettings || {};

        // 3. Validate Credentials (Required to send mail)
        // If a company hasn't set up their email, we log it and exit.
        if (!settings.email || !settings.appPassword) {
            console.warn(`[Notify] Skipped: No email credentials configured for company: ${companyData.companyName || companyId}`);
            // Optional: You could fallback to a system-wide "no-reply" email here if you wanted.
            return null;
        }

        // 4. Configure Gmail Transporter Dynamically
        // We create this ON THE FLY because every company has different credentials.
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: settings.email,
                pass: settings.appPassword
            }
        });

        // 5. Build the Link
        // We try to guess the hosting URL based on the project ID
        const projectId = process.env.GCLOUD_PROJECT || 'truckerapp-system';
        const baseUrl = `https://${projectId}.web.app`;

        // Construct the secure link
        const link = `${baseUrl}/sign/${companyId}/${requestId}?token=${data.accessToken}`;

        // 6. Send with PROFESSIONAL DISPLAY NAME
        const senderName = companyData.companyName || "SafeHaul Documents";
        const fromAddress = `"${senderName}" <${settings.email}>`;

        const mailOptions = {
            from: fromAddress,
            to: data.recipientEmail,
            subject: `Action Required: Please sign ${data.title}`,
            html: `
                <div style="font-family: Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h2 style="color: #0F172A; margin: 0;">${senderName}</h2>
                        <p style="color: #64748B; font-size: 14px;">Secure Document Delivery</p>
                    </div>

                    <div style="background-color: #F8FAFC; padding: 20px; border-radius: 8px; text-align: center;">
                        <p style="font-size: 16px; color: #334155; margin-bottom: 24px;">
                            <strong>${data.recipientName}</strong>,<br/>
                            You have received a document that requires your signature.
                        </p>

                        <a href="${link}" style="background-color: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px; display: inline-block;">
                            Review & Sign Document
                        </a>
                    </div>

                    <p style="font-size: 12px; color: #94A3B8; text-align: center; margin-top: 30px;">
                        Securely powered by SafeHaul. If you did not expect this, please ignore this email.
                        <br/>
                        <a href="${link}" style="color: #cbd5e1; text-decoration: none;">${link}</a>
                    </p>
                </div>
            `
        };

        // 7. Send
        await transporter.sendMail(mailOptions);
        console.log(`[Notify] Email sent to ${data.recipientEmail} via ${settings.email}`);

        // 8. Update Status in Firestore
        await snap.ref.update({ 
            emailSentAt: new Date().toISOString(),
            emailStatus: 'sent',
            emailSentVia: settings.email
        });

    } catch (err) {
        console.error("[Notify] Failed:", err);
        await snap.ref.update({ 
            emailStatus: 'failed', 
            emailError: err.message 
        });
    }
});