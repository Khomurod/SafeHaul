const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * SECURE: Debug App Counts
 * Changed from onRequest (public) to onCall (authenticated)
 */
exports.debugAppCounts = onCall(async (request) => {
    // 1. Security Guard: Enforce Super Admin Role
    if (!request.auth || request.auth.token.globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'Super Admin access required.');
    }

    // 2. Get Data from Request Body
    const { companyId = 'iHexmEEmD8ygvL6qZ5Zd', fix = false } = request.data;

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

                if (fix) {
                    updates.push(doc.ref.update({
                        createdAt: admin.firestore.Timestamp.now(),
                        submittedAt: d.submittedAt || admin.firestore.Timestamp.now()
                    }));
                }
            }
            if (!d.submittedAt) missingSubmittedAt++;
        });

        if (fix && updates.length > 0) {
            await Promise.all(updates);
            fixedCount = updates.length;
        }

        return {
            companyId,
            total,
            missingCreatedAt,
            missingSubmittedAt,
            fixedCount,
            details,
            message: fix ? `Fixed ${fixedCount} documents.` : "Run with fix=true to repair."
        };
    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
});
