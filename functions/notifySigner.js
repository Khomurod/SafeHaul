const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

exports.notifySigner = functions.firestore
  .document('companies/{companyId}/signing_requests/{requestId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const { companyId, requestId } = context.params;

    try {
        console.log(`[Notify] Preparing email for ${requestId}`);

        // 1. Get Company Settings for Email Credentials
        const companySnap = await db.collection('companies').doc(companyId).get();
        if (!companySnap.exists) {
            console.log("Company not found");
            return;
        }
        const companyData = companySnap.data();
        const settings = companyData.emailSettings || {};

        // 2. Check for Credentials (Required to send mail)
        if (!settings.email || !settings.appPassword) {
            console.log(`[Notify] Skipped: No email credentials configured for ${companyData.companyName}`);
            return;
        }

        // 3. Configure Gmail Transporter
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: settings.email,
                pass: settings.appPassword
            }
        });

        // 4. Build the Link
        // We use the project ID to guess the hosting URL, or fallback to the one you are using
        const projectId = process.env.GCLOUD_PROJECT || 'truckerapp-system';
        const baseUrl = `https://${projectId}.web.app`;
        const link = `${baseUrl}/sign/${companyId}/${requestId}?token=${data.accessToken}`;

        // 5. Send with PROFESSIONAL DISPLAY NAME
        // This makes it look like "SafeHaul Documents" instead of "gmail.com"
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
                    </p>
                </div>
            `
        };

        await transporter.sendMail(mailOptions);
        console.log(`[Notify] Email sent to ${data.recipientEmail}`);

    } catch (err) {
        console.error("[Notify] Failed:", err);
    }
});