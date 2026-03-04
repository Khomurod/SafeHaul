const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../../firebaseAdmin");

/**
 * SECURITY HELPER: Assert User is Company Admin/Member
 * Prevents IDOR attacks where a user manages another company's data.
 */
const assertCompanyAdmin = async (userId, companyId) => {
    if (!userId || !companyId) throw new HttpsError('invalid-argument', 'Missing authentication context.');

    // 1. Check Team Membership (Subcollection - Legacy)
    const memberSnap = await db.collection('companies').doc(companyId).collection('team').doc(userId).get();
    if (memberSnap.exists) return; // Success

    // 1b. Check Global Memberships Collection (New System)
    try {
        const memSnapshot = await db.collection('memberships')
            .where('userId', '==', userId)
            .where('companyId', '==', companyId)
            .limit(1)
            .get();
        if (!memSnapshot.empty) return; // Success
    } catch (err) {
        console.warn(`[Auth Warning] Failed to check memberships for ${userId}: ${err.message}`);
    }

    // 2. Check Company Document Fields (Owner/Creator Fallback)
    const companySnap = await db.collection('companies').doc(companyId).get();
    if (companySnap.exists) {
        const data = companySnap.data();
        // Check common ownership fields
        if (data.ownerId === userId) return;
        if (data.createdBy === userId) return;
        if (data.adminId === userId) return;
        if (data.userId === userId) return; // Some systems use this
    }

    // 3. Super Admin Bypass (Database Check)
    // REMOVED: Hardcoded Backdoor for 5921L...

    const userSnap = await db.collection('users').doc(userId).get();
    let userEmail = null;

    if (userSnap.exists) {
        const userData = userSnap.data();
        userEmail = userData.email;
        // console.log(`[Auth Debug] Checking user ${userId} (${userEmail}) for company ${companyId}. Role: ${userData.role}, CompanyId: ${userData.companyId}`);

        if (userData.role === 'super_admin' || userData.globalRole === 'super_admin') return;
        if (userData.role === 'admin') return;
        if (userData.companyId === companyId) return;
    } else {
        // Fallback: Try to get email from Auth if not in DB
        try {
            const userRecord = await admin.auth().getUser(userId);
            userEmail = userRecord.email;
            console.log(`[Auth Debug] User doc missing, fetched email from Auth: ${userEmail}`);
        } catch (e) {
            console.warn(`[Auth Debug] Failed to fetch user email for ${userId}: ${e.message}`);
        }
    }

    // 5. Email Fallback (Legacy/Simple Auth)
    if (userEmail) {
        const cSnap = await db.collection('companies').doc(companyId).get();
        if (cSnap.exists) {
            const cData = cSnap.data();
            if (cData.ownerEmail === userEmail) return;
            if (cData.email === userEmail) return;
            if (cData.teamEmails && Array.isArray(cData.teamEmails) && cData.teamEmails.includes(userEmail)) return;
        }
    }

    // console.warn(`[Auth Failure] User ${userId} denied access to Company ${companyId}.`);
    throw new HttpsError('permission-denied', 'You do not have administrative access to this company.');
};

module.exports = { assertCompanyAdmin };
