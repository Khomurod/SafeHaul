const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

/**
 * Allows a signed-in driver to apply to a company with one click using their Master Profile.
 * Params: { companyId: string }
 */
exports.submitEasyApplication = functions.https.onCall(async (data, context) => {
    // 1. Auth Validation
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'You must be logged in to apply.');
    }

    const { uid } = context.auth;
    const { companyId } = data;

    if (!companyId) {
        throw new functions.https.HttpsError('invalid-argument', 'Company ID is required.');
    }

    try {
        // 2. Fetch Driver Master Profile
        const driverDoc = await db.collection('drivers').doc(uid).get();
        if (!driverDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Driver profile not found.');
        }

        const driverData = driverDoc.data();
        const personalInfo = driverData.personalInfo || {};

        // 3. Duplicate Check
        const applicationsRef = db.collection('companies').doc(companyId).collection('applications');
        const duplicateCheck = await applicationsRef
            .where('applicantId', '==', uid)
            .limit(1)
            .get();

        if (!duplicateCheck.empty) {
            throw new functions.https.HttpsError('already-exists', 'You have already applied to this company.');
        }

        // 4. Create Application Document
        const newApp = {
            companyId: companyId, // Redundant but useful for Collection Group Queries
            applicantId: uid,
            driverId: uid, // Use consistent ID naming

            // Snapshot of profile data
            personalInfo: {
                firstName: personalInfo.firstName || '',
                lastName: personalInfo.lastName || '',
                email: personalInfo.email || '',
                phone: personalInfo.phone || '',
                // Include other relevant fields if available in Master Profile
            },

            // Metadata
            status: 'New Application',
            source: 'Job Board (One-Click)',
            submittedAt: admin.firestore.FieldValue.serverTimestamp(),
            lastActivityAt: admin.firestore.FieldValue.serverTimestamp(),
            isRead: false,

            // Placeholders for advanced data if the driver has filled them out
            licenses: driverData.licenses || [],
            experience: driverData.experience || [],
            violations: driverData.violations || [],
            medicalCard: driverData.medicalCard || {}
        };

        const appRef = await applicationsRef.add(newApp);

        // 5. Update Driver's "Saved Jobs" or "Activity Log" (Optional but good practice)
        await db.collection('drivers').doc(uid).collection('activities').add({
            type: 'application_submitted',
            companyId,
            applicationId: appRef.id,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });

        return { success: true, applicationId: appRef.id };

    } catch (error) {
        console.error("Submit Easy Application Error:", error);
        // Re-throw HttpsErrors, wrap others
        if (error.code === 'already-exists') throw error;
        throw new functions.https.HttpsError('internal', 'Application submission failed. Please try again.');
    }
});
