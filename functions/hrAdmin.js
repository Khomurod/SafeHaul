// hr portal/functions/hrAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db, auth } = require("./firebaseAdmin");

// --- 1. CREATE USER ---
exports.createPortalUser = onCall({ maxInstances: 2 }, async (request) => {
  const { fullName, email, password, companyId, role } = request.data;

  if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");

  const roles = request.auth.token.roles || {};
  const isSuperAdmin = roles.globalRole === "super_admin";

  if (role === "super_admin") {
    if (!isSuperAdmin) throw new HttpsError("permission-denied", "Super Admin only.");
  } else if (role === "company_admin" || role === "hr_user") {
    const isAdminForThisCompany = roles[companyId] === "company_admin";
    if (!isSuperAdmin && !isAdminForThisCompany) throw new HttpsError("permission-denied", "Permission denied.");
  } else {
    throw new HttpsError("invalid-argument", "Invalid role.");
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

// --- 2. SYNC CLAIMS TRIGGER ---
exports.onMembershipWrite = onDocumentWritten({
    document: "memberships/{membershipId}",
    maxInstances: 2
}, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const userId = after ? after.userId : before?.userId;
    if (!userId) return;

    let newClaims = { roles: {} };

    try {
        const userRecord = await auth.getUser(userId);
        const existingClaims = userRecord.customClaims || {};
        if (existingClaims.roles && existingClaims.roles.globalRole) {
            newClaims.roles.globalRole = existingClaims.roles.globalRole;
        }
    } catch (e) {
        console.error("Error fetching user for claims sync:", e);
        return; // Exit if user doesn't exist
    }

    const memSnap = await db.collection("memberships").where("userId", "==", userId).get();
    memSnap.forEach(doc => {
        const m = doc.data();
        if (m.companyId && m.role) {
            newClaims.roles[m.companyId] = m.role;
        }
    });

    await auth.setCustomUserClaims(userId, newClaims);
});

// --- 3. DELETE USER (Scoped) ---
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
        // Super Admin Force Delete (Everything)
        await auth.deleteUser(userId);
        await db.collection("users").doc(userId).delete();
        const membershipsSnap = await db.collection("memberships").where("userId", "==", userId).get();
        const batch = db.batch();
        membershipsSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        return { message: "User completely deleted." };
    } else {
        // Company Admin Delete (Remove Membership)
        const memQuery = await db.collection("memberships")
            .where("userId", "==", userId)
            .where("companyId", "==", companyId)
            .get();

        const batch = db.batch();
        memQuery.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();

        // Check if user has any OTHER memberships
        const remaining = await db.collection("memberships").where("userId", "==", userId).get();
        if (remaining.empty) {
            // Orphaned user -> Delete account
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
    
// --- 4. UPDATE USER (Name/Email) ---
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

// --- 5. JOIN TEAM (Invite) ---
exports.joinCompanyTeam = onCall({ maxInstances: 2 }, async (request) => {
    const { companyId, fullName, email, password } = request.data;

    let userId;
    try {
        const user = await auth.getUserByEmail(email);
        userId = user.uid;
    } catch (e) {
        if (e.code === 'auth/user-not-found') {
            const newUser = await auth.createUser({
                email, password, displayName: fullName, emailVerified: true
            });
            userId = newUser.uid;

            await db.collection("users").doc(userId).set({ 
                name: fullName, email, createdAt: admin.firestore.FieldValue.serverTimestamp() 
            });
        } else {
            throw e;
        }
    }

    await db.collection("memberships").add({
        userId,
        companyId,
        role: "hr_user",
        createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true };
});