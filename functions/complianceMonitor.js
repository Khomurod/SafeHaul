const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");
const { logger } = require("firebase-functions");
const { sendDynamicEmail } = require('./emailService');

exports.checkExpiringDocuments = onSchedule("every 24 hours", async (event) => {
    // 1. Calculate Target Date (Today + 7 Days)
    const today = new Date();
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + 7);
    const targetDateString = targetDate.toISOString().split('T')[0]; // "YYYY-MM-DD"

    const db = getFirestore();

    try {
        logger.info(`Checking for documents expiring on: ${targetDateString}`);

        // 2. Query Collection Group
        // Note: Requires Index on 'expirationDate' ASC/DESC
        const snapshot = await db.collectionGroup('dq_files')
            .where('expirationDate', '==', targetDateString)
            .get();

        if (snapshot.empty) {
            logger.info("No expiring documents found.");
            return;
        }

        // 3. Process Results
        const notifications = [];
        for (const doc of snapshot.docs) {
            const data = doc.data();
            // The parent path is companies/{cid}/applications/{aid}/dq_files/{docId}
            const parentPath = doc.ref.parent.parent ? doc.ref.parent.parent.path : 'unknown';

            notifications.push({
                fileType: data.fileType,
                fileName: data.fileName,
                path: parentPath,
                expirationDate: data.expirationDate
            });
        }

        logger.info(`Found ${notifications.length} expiring documents. Sending alerts...`);

        // 4. Send Compliance Alert Emails (Concurrent Batches)
        let emailsSent = 0;
        let emailsFailed = 0;

        const processNotification = async (note) => {
            try {
                // Extract companyId from path: "companies/{companyId}/applications/..."
                const pathParts = note.path.split('/');
                const companyId = pathParts.length >= 2 ? pathParts[1] : null;

                if (!companyId) {
                    logger.warn(`Could not extract companyId from path: ${note.path}`);
                    return false;
                }

                // Get company admin email
                const companyDoc = await db.collection('companies').doc(companyId).get();
                if (!companyDoc.exists) {
                    logger.warn(`Company not found: ${companyId}`);
                    return false;
                }

                const companyData = companyDoc.data();
                const adminEmail = companyData.adminEmail || companyData.email;

                if (!adminEmail) {
                    logger.warn(`No admin email configured for company: ${companyId}`);
                    return false;
                }

                await sendDynamicEmail(
                    companyId,
                    adminEmail,
                    `⚠️ Document Expiring: ${note.fileName}`,
                    `<div style="font-family: Arial, sans-serif; max-width: 600px;">
                        <h2 style="color: #d97706;">⚠️ Compliance Alert</h2>
                        <p>The following document will expire in <strong>7 days</strong>:</p>
                        <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
                            <tr style="background: #f3f4f6;">
                                <td style="padding: 10px; border: 1px solid #e5e7eb;"><strong>File Name</strong></td>
                                <td style="padding: 10px; border: 1px solid #e5e7eb;">${note.fileName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 10px; border: 1px solid #e5e7eb;"><strong>Document Type</strong></td>
                                <td style="padding: 10px; border: 1px solid #e5e7eb;">${note.fileType}</td>
                            </tr>
                            <tr style="background: #f3f4f6;">
                                <td style="padding: 10px; border: 1px solid #e5e7eb;"><strong>Expiration Date</strong></td>
                                <td style="padding: 10px; border: 1px solid #e5e7eb;">${note.expirationDate}</td>
                            </tr>
                        </table>
                        <p>Please ensure this document is renewed before expiration to maintain compliance.</p>
                    </div>`
                );

                logger.info(`Email sent to ${adminEmail} for ${note.fileName}`);
                return true;
            } catch (emailErr) {
                logger.error(`Failed to send alert for ${note.fileName}:`, { error: emailErr.message });
                return false;
            }
        };

        // Process in batches of 10 to prevent rate limits/memory spikes while ensuring speed
        const BATCH_SIZE = 10;
        for (let i = 0; i < notifications.length; i += BATCH_SIZE) {
            const batch = notifications.slice(i, i + BATCH_SIZE);
            const results = await Promise.all(batch.map(note => processNotification(note)));

            results.forEach(success => {
                if (success) emailsSent++;
                else emailsFailed++;
            });
        }

        logger.info(`Compliance check complete. Emails sent: ${emailsSent}, Failed: ${emailsFailed}`);

    } catch (error) {
        logger.error("Compliance Monitor Error:", { error: error.message, stack: error.stack });
    }
});
