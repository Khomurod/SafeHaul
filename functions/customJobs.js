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


/**
 * Build HTML email for document expirations
 */


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
