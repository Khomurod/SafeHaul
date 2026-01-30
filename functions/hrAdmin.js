// hr portal/functions/hrAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db, auth } = require("./firebaseAdmin");

// --- 1. CREATE USER ---
exports.createPortalUser = onCall({ maxInstances: 2 }, async (request) => {
    const { fullName, email, password, companyId, role } = request.data;

    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

    const roles = request.auth.token.roles || {};

    // Security Check: Only a Super Admin can create another Super Admin
    if (role === "super_admin") {
        const isGlobalSuperAdmin = roles.globalRole === "super_admin";
        if (!isGlobalSuperAdmin) throw new HttpsError("permission-denied", "Only Super Admins can create other Super Admins.");
    }

    // Security Check: Regular admins can only add to their own company
    if (role === "company_admin" || role === "hr_user") {
        const isAdminForThisCompany = roles[companyId] === "company_admin";
        const isGlobalSuperAdmin = roles.globalRole === "super_admin";

        if (!isGlobalSuperAdmin && !isAdminForThisCompany) {
            throw new HttpsError("permission-denied", "You do not have permission to add users to this company.");
        }
    }

    let userId;
    let isNewUser = false;

    try {
        try {
            const userRecord = await auth.getUserByEmail(email);
            userId = userRecord.uid;
        } catch (e) {
            if (e.code === 'auth/user-not-found') {
                const newUserRecord = await auth.createUser({
                    email,
                    password,
                    displayName: fullName,
                    emailVerified: true,
                });
                userId = newUserRecord.uid;
                isNewUser = true;

                await db.collection("users").doc(userId).set({
                    name: fullName,
                    email,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                throw e;
            }
        }

        // Check if membership already exists to prevent duplicates
        const memQuery = await db.collection("memberships")
            .where("userId", "==", userId)
            .where("companyId", "==", companyId)
            .get();

        if (!memQuery.empty) {
            return { status: "success", message: "User is already in this company." };
        }

        await db.collection("memberships").add({
            userId,
            companyId,
            role,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const msg = isNewUser ? "User created successfully." : "User added to company.";
        return { status: "success", message: msg, userId };

    } catch (error) {
        console.error("Create User Error:", error);
        throw new HttpsError("internal", error.message);
    }
});

// --- 2. SYNC CLAIMS TRIGGER (The Critical Fix) ---
exports.onMembershipWrite = onDocumentWritten({
    document: "memberships/{membershipId}",
    maxInstances: 2
}, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const userId = after ? after.userId : before?.userId;
    if (!userId) return;

    let newClaims = { roles: {} };
    let isGlobalAdmin = false;

    try {
        // We verify the user exists before trying to set claims
        await auth.getUser(userId);
    } catch (e) {
        console.error("Error fetching user for claims sync:", e);
        if (e.code === 'auth/user-not-found') return;
        throw e;
    }

    // Fetch ALL memberships to rebuild the permissions from scratch
    const memSnap = await db.collection("memberships").where("userId", "==", userId).get();

    memSnap.forEach(doc => {
        const m = doc.data();

        // CRITICAL FIX: Detect the super_admin role and set the global flag
        if (m.role === 'super_admin') {
            isGlobalAdmin = true;
        }

        // Add company-specific roles
        if (m.companyId && m.role) {
            newClaims.roles[m.companyId] = m.role;
        }
    });

    // Apply the Global Role if found
    if (isGlobalAdmin) {
        newClaims.roles.globalRole = 'super_admin';
    }

    await auth.setCustomUserClaims(userId, newClaims);
    console.log(`Claims synced for user ${userId}. Global Admin: ${isGlobalAdmin}`);

    // --- 2. Sync Team List to Company Document (Prevention of N+1 Queries) ---
    const companyIdsToUpdate = new Set();
    if (before && before.companyId) companyIdsToUpdate.add(before.companyId);
    if (after && after.companyId) companyIdsToUpdate.add(after.companyId);

    // Filter out undefined/null
    const validCompanyIds = Array.from(companyIdsToUpdate).filter(cid => cid);

    for (const cid of validCompanyIds) {
        try {
            const teamSnap = await db.collection('memberships').where('companyId', '==', cid).get();

            // Parallel fetch of user profiles
            const userPromises = teamSnap.docs.map(async (doc) => {
                const m = doc.data();
                try {
                    const uSnap = await db.collection('users').doc(m.userId).get();
                    const uData = uSnap.exists ? uSnap.data() : {};
                    return {
                        userId: m.userId,
                        role: m.role,
                        name: uData.name || uData.displayName || 'Unknown',
                        email: uData.email || ''
                    };
                } catch (e) {
                    console.error(`Error fetching user ${m.userId} for company ${cid}:`, e);
                    return { userId: m.userId, role: m.role, name: 'Unknown', email: '' };
                }
            });

            const resolvedTeam = await Promise.all(userPromises);

            await db.collection('companies').doc(cid).update({
                teamMembers: resolvedTeam,
                teamUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Updated teamMembers cache for Company ${cid} (${resolvedTeam.length} members).`);
        } catch (companyError) {
            console.error(`Failed to update team cache for company ${cid}:`, companyError);
        }
    }
});

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
            const batch = db.batch();
            membershipsSnap.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
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

    const roles = request.auth.token.roles || {};
    const isSuperAdmin = roles.globalRole === "super_admin";
    const isCompanyAdmin = companyId && roles[companyId] === "company_admin";

    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError("permission-denied", "Permission denied.");
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

// --- 5. JOIN TEAM ---
// 5. JOIN COMPANY TEAM (Admin Only / Invite System Placeholder)
exports.joinCompanyTeam = onCall({ maxInstances: 2 }, async (request) => {
    // SECURITY FIX: This function previously allowed public registration into any company.
    // It is now disabled until a proper Invite System is implemented.

    // 1. Strict Auth Check
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    // 2. Strict Role Check (Super Admin Only for now)
    const roles = request.auth.token.roles || {};
    const globalRole = request.auth.token.globalRole || roles.globalRole;

    if (globalRole !== 'super_admin') {
        throw new HttpsError('permission-denied', 'This feature is currently disabled for security.');
    }

    // Original Logic (Commented out for reference/future restoration)
    /*
    const { companyId, fullName, email, password } = request.data;
    // ... impl ...
    */

    throw new HttpsError('unimplemented', 'Please use the "Add User" feature in the dashboard.');
});