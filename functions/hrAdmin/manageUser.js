// functions/hrAdmin/manageUser.js
//
// Changing and removing a portal user: the SMS-line unassignment that keeps
// number assignments from ghosting, `deletePortalUser`, and
// `updatePortalUser`. Extracted verbatim from `hrAdmin.js`.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, auth } = require("./../firebaseAdmin");

// Remove a user's dedicated SMS line assignment when they leave a company. Without
// this, deleting a recruiter who had a line assigned leaves an orphaned entry in
// companies/{companyId}/integrations/sms_provider.assignments keyed by a uid that no
// longer appears in the company roster — which then renders as an invisible "ghost"
// assignment in Number Assignments (a linked, sending line that shows nowhere). It also
// keeps the line tied up so it can't be cleanly reassigned. Best-effort: user removal
// must still succeed even if the integrations doc is missing or the prune fails.
async function clearSmsAssignment(companyId, userId) {
    if (!companyId || !userId) return;
    const ref = db
        .collection('companies').doc(companyId)
        .collection('integrations').doc('sms_provider');
    try {
        const snap = await ref.get();
        const assignments = (snap.exists && snap.data() && snap.data().assignments) || null;
        if (assignments && Object.prototype.hasOwnProperty.call(assignments, userId)) {
            await ref.update({ [`assignments.${userId}`]: admin.firestore.FieldValue.delete() });
            console.log(`[deletePortalUser] Cleared SMS line assignment for ${userId} in company ${companyId}.`);
        }
    } catch (e) {
        console.error(`[deletePortalUser] Failed to clear SMS assignment for ${userId} in ${companyId}:`, e.message || e);
    }
}

// --- 3. DELETE USER ---
exports.deletePortalUser = onCall({ maxInstances: 2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const { userId, companyId } = request.data;
    if (!userId) throw new HttpsError("invalid-argument", "Missing User ID.");

    const roles = request.auth.token.roles || {};
    const isSuperAdmin = roles.globalRole === "super_admin";
    const isCompanyAdmin = companyId && roles[companyId] === "company_admin";

    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError("permission-denied", "Permission denied.");
    }

    try {
        if (isSuperAdmin && !companyId) {
            // Super Admin Force Delete
            await auth.deleteUser(userId);
            await db.collection("users").doc(userId).delete();
            const membershipsSnap = await db.collection("memberships").where("userId", "==", userId).get();
            // Free any SMS line assignments in every company this user belonged to.
            const affectedCompanyIds = new Set();
            membershipsSnap.forEach((doc) => {
                const cid = doc.data() && doc.data().companyId;
                if (cid) affectedCompanyIds.add(cid);
            });
            const batch = db.batch();
            membershipsSnap.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            await Promise.all([...affectedCompanyIds].map((cid) => clearSmsAssignment(cid, userId)));
            return { message: "User completely deleted." };
        } else {
            // Company Admin remove
            const memQuery = await db.collection("memberships")
                .where("userId", "==", userId)
                .where("companyId", "==", companyId)
                .get();

            const batch = db.batch();
            memQuery.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();

            // Free the user's dedicated SMS line in this company (if any).
            await clearSmsAssignment(companyId, userId);

            // Cleanup orphaned users
            const remaining = await db.collection("memberships").where("userId", "==", userId).get();
            if (remaining.empty) {
                try {
                    await auth.deleteUser(userId);
                    await db.collection("users").doc(userId).delete();
                    return { message: "User removed and account deleted (orphaned)." };
                } catch (e) {
                    console.log("Could not delete auth user (likely already gone):", e);
                }
            }
            return { message: "User removed from team." };
        }
    } catch (error) {
        console.error("Error deleting user:", error);
        throw new HttpsError("internal", error.message);
    }
});

// --- 4. UPDATE USER ---
exports.updatePortalUser = onCall({ maxInstances: 2 }, async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const { userId, companyId, name, email } = request.data;

    if (!userId) {
        throw new HttpsError("invalid-argument", "userId is required.");
    }

    const roles = request.auth.token.roles || {};
    const isSuperAdmin = roles.globalRole === "super_admin";
    const isCompanyAdmin = companyId && roles[companyId] === "company_admin";

    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError("permission-denied", "Permission denied.");
    }

    // BUG-11 FIX: A Company Admin's `roles[companyId] === 'company_admin'` claim only
    // proves they're an admin OF that company — it does NOT prove the target user
    // actually belongs to that company. Without this check, any company admin who
    // could guess/leak a foreign userId could mutate that user's name + email and
    // (via Firebase Auth) hijack the account by triggering a password reset to a
    // new attacker-controlled address. Super Admins skip the check.
    if (!isSuperAdmin) {
        const targetUserSnap = await db.collection('users').doc(userId).get();
        if (!targetUserSnap.exists) {
            throw new HttpsError('not-found', 'Target user not found.');
        }
        const targetUser = targetUserSnap.data() || {};
        const targetCompanyIds = new Set([
            targetUser.companyId,
            ...(Array.isArray(targetUser.companyIds) ? targetUser.companyIds : []),
            ...(targetUser.companies && typeof targetUser.companies === 'object'
                ? Object.keys(targetUser.companies)
                : []),
        ].filter(Boolean));
        if (!targetCompanyIds.has(companyId)) {
            console.warn(
                `[updatePortalUser] BLOCKED: ${request.auth.uid} (admin of ${companyId}) tried to edit ${userId} which belongs to companies: ${[...targetCompanyIds].join(',') || 'none'}`
            );
            throw new HttpsError(
                'permission-denied',
                'You can only edit users that belong to your company.'
            );
        }
    }

    try {
        const updateData = {};
        if (name) updateData.displayName = name;
        if (email) updateData.email = email;

        if (Object.keys(updateData).length > 0) {
            await auth.updateUser(userId, updateData);
        }

        const firestoreData = {};
        if (name) firestoreData.name = name;
        if (email) firestoreData.email = email;

        if (Object.keys(firestoreData).length > 0) {
            await db.collection("users").doc(userId).update(firestoreData);
        }

        return { success: true, message: "User profile updated." };
    } catch (error) {
        console.error("Update User Error:", error);
        throw new HttpsError("internal", error.message);
    }
});

module.exports = {
    deletePortalUser: exports.deletePortalUser,
    updatePortalUser: exports.updatePortalUser,
};
