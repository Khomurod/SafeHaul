const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { sendDynamicEmail } = require('./emailService');
const db = admin.firestore();

/**
 * Scheduled Job: Check for Expiring Documents
 * Runs every 24 hours.
 * 
 * Logic:
 * 1. Calculate target date (Today + 30 days).
 * 2. Query 'dq_files' collection group for items expiring before target date.
 * 3. Group by Company -> Application.
 * 4. Send Notification via Company Email.
 */
exports.checkDocumentExpirations = functions.pubsub.schedule('every 24 hours').onRun(async (context) => {
    console.log("Starting Document Expiration Check...");

    const today = new Date();
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + 30); // Look ahead 30 days

    try {
        // NOTE: Collection Group Query requires an index on 'expirationDate'
        const snapshot = await db.collectionGroup('dq_files')
            .where('expirationDate', '<=', targetDate.toISOString().split('T')[0])
            .where('expirationDate', '>=', today.toISOString().split('T')[0])
            .get();

        if (snapshot.empty) {
            console.log("No expiring documents found.");
            return null;
        }

        console.log(`Found ${snapshot.size} expiring documents.`);

        const expirationsByCompany = {};

        // Process results
        for (const doc of snapshot.docs) {
            const data = doc.data();
            // Path: companies/{companyId}/applications/{appId}/dq_files/{fileId}
            const pathSegments = doc.ref.path.split('/');
            const companyId = pathSegments[1];
            const appId = pathSegments[3];

            if (!companyId || !appId) continue;

            if (!expirationsByCompany[companyId]) {
                expirationsByCompany[companyId] = [];
            }

            expirationsByCompany[companyId].push({
                fileType: data.fileType,
                fileName: data.fileName,
                expirationDate: data.expirationDate,
                appId: appId,
                applicantName: data.applicantName || 'Unknown'
            });
        }

        // Send Email Notifications to Company Admins
        for (const [companyId, files] of Object.entries(expirationsByCompany)) {
            console.log(`[Notification] Company ${companyId} has ${files.length} expiring documents.`);

            try {
                // Fetch company admin emails
                const companyDoc = await db.collection('companies').doc(companyId).get();
                if (!companyDoc.exists) {
                    console.warn(`Company ${companyId} not found, skipping email.`);
                    continue;
                }

                const companyData = companyDoc.data();
                const adminEmail = companyData.email || companyData.adminEmail;

                if (!adminEmail) {
                    console.warn(`No admin email for company ${companyId}, skipping.`);
                    continue;
                }

                // Build email HTML
                const emailHtml = buildExpirationEmailHtml(companyData.companyName, files);

                // Send via company's own email
                await sendDynamicEmail(
                    companyId,
                    adminEmail,
                    `⚠️ Document Expiration Alert - ${files.length} items expiring soon`,
                    emailHtml
                );

                console.log(`✅ Expiration email sent to ${adminEmail} for company ${companyId}`);

            } catch (emailError) {
                console.error(`Failed to send email for company ${companyId}:`, emailError.message);
                // Continue with other companies even if one fails
            }
        }

        return null;

    } catch (error) {
        console.error("Error in checkDocumentExpirations:", error);
        return null;
    }
});

/**
 * Build HTML email for document expirations
 */
function buildExpirationEmailHtml(companyName, files) {
    const fileRows = files.map(file => `
        <tr>
            <td style="padding: 12px; border: 1px solid #e0e0e0;">${file.fileType || 'Document'}</td>
            <td style="padding: 12px; border: 1px solid #e0e0e0;">${file.applicantName}</td>
            <td style="padding: 12px; border: 1px solid #e0e0e0;">${file.expirationDate}</td>
        </tr>
    `).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>Document Expiration Alert</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #d97706;">⚠️ Document Expiration Alert</h2>
                <p>Hello ${companyName} Team,</p>
                <p>The following <strong>${files.length}</strong> driver qualification document(s) will expire within the next 30 days:</p>
                
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <thead>
                        <tr style="background-color: #f3f4f6;">
                            <th style="padding: 12px; border: 1px solid #e0e0e0; text-align: left;">Document Type</th>
                            <th style="padding: 12px; border: 1px solid #e0e0e0; text-align: left;">Applicant</th>
                            <th style="padding: 12px; border: 1px solid #e0e0e0; text-align: left;">Expiration Date</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${fileRows}
                    </tbody>
                </table>

                <p><strong>Action Required:</strong> Please request updated documents from the drivers to maintain compliance.</p>
                
                <p style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #666; font-size: 12px;">
                    This is an automated notification from SafeHaul.
                </p>
            </div>
        </body>
        </html>
    `;
}

exports.debugAppCounts = functions.https.onRequest(async (req, res) => {
    const companyId = req.query.companyId || 'iHexmEEmD8ygvL6qZ5Zd';
    const doFix = req.query.fix === 'true';

    try {
        const appsRef = db.collection('companies').doc(companyId).collection('applications');
        const snap = await appsRef.get();

        let missingCreatedAt = 0;
        let missingSubmittedAt = 0;
        let total = snap.size;
        let details = [];
        let fixedCount = 0;

        const updates = [];

        snap.forEach(doc => {
            const d = doc.data();
            if (!d.createdAt) {
                missingCreatedAt++;
                details.push({ id: doc.id });

                if (doFix) {
                    updates.push(doc.ref.update({
                        createdAt: admin.firestore.Timestamp.now(),
                        submittedAt: d.submittedAt || admin.firestore.Timestamp.now()
                    }));
                }
            }
            if (!d.submittedAt) missingSubmittedAt++;
        });

        if (doFix && updates.length > 0) {
            await Promise.all(updates);
            fixedCount = updates.length;
        }

        res.json({
            companyId,
            total,
            missingCreatedAt,
            missingSubmittedAt,
            fixedCount,
            details,
            message: doFix ? `Fixed ${fixedCount} documents.` : "Run with ?fix=true to repair."
        });
    } catch (error) {
        res.status(500).send(error.message);
    }
});
