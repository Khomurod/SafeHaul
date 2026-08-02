// hr portal/functions/hrAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db, auth } = require("./firebaseAdmin");

// --- 1. CREATE USER ---
// Roles a company admin may grant within their own company. `super_admin` is
// deliberately excluded — only an existing global super admin can mint one.
const ASSIGNABLE_PORTAL_ROLES = ["company_admin", "hr_user", "recruiter"];

exports.createPortalUser = onCall({ maxInstances: 2 }, async (request) => {
    const { fullName, email, password, companyId, role } = request.data;

    if (!request.auth) throw new HttpsError("unauthenticated", "Login required.");
    if (!email || !companyId || !role) {
        throw new HttpsError("invalid-argument", "email, companyId and role are required.");
    }

    const roles = request.auth.token.roles || {};
    const isGlobalSuperAdmin = roles.globalRole === "super_admin";

    // DEFAULT-DENY authorization. Previously only `super_admin` and
    // `company_admin`/`hr_user` were gated, so any OTHER role string (e.g.
    // "recruiter", a typo, or empty) fell through with NO permission check and
    // created a cross-tenant membership. Now every path is explicitly authorized.
    if (role === "super_admin") {
        if (!isGlobalSuperAdmin) {
            throw new HttpsError("permission-denied", "Only Super Admins can create other Super Admins.");
        }
    } else if (ASSIGNABLE_PORTAL_ROLES.includes(role)) {
        const isAdminForThisCompany = roles[companyId] === "company_admin";
        if (!isGlobalSuperAdmin && !isAdminForThisCompany) {
            throw new HttpsError("permission-denied", "You do not have permission to add users to this company.");
        }
    } else {
        // Unknown / unsupported role — reject outright.
        throw new HttpsError("invalid-argument", `Unsupported role: ${role}`);
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

    const newClaims = { roles: {} };
    const teamRoleCompanyIds = new Set();
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
            if (["company_admin", "hr_user", "recruiter"].includes(m.role)) {
                teamRoleCompanyIds.add(m.companyId);
            }
        }
    });

    if (teamRoleCompanyIds.size > 0) {
        newClaims.companyTeamIds = Array.from(teamRoleCompanyIds).sort();
    }

    // Apply the Global Role if found
    if (isGlobalAdmin) {
        newClaims.roles.globalRole = 'super_admin';
    }

    await auth.setCustomUserClaims(userId, newClaims);
    console.log(`Claims synced for user ${userId}. Global Admin: ${isGlobalAdmin}`);

    // SEC-002: mirror the user's company memberships onto users/{uid}.companyIds so
    // Firestore rules can allow same-company teammate reads (readerSharesCompany)
    // without exposing the profile across tenants. Server-only write (Admin SDK);
    // clients are blocked from editing companyIds. merge:true preserves name/email.
    try {
        const companyIdsList = Array.from(teamRoleCompanyIds).sort();
        await db.collection('users').doc(userId).set(
            { companyIds: companyIdsList },
            { merge: true }
        );
    } catch (companyIdsErr) {
        console.error(`[onMembershipWrite] Failed to sync companyIds for user ${userId}:`, companyIdsErr.message || companyIdsErr);
    }

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

// --- 5. JOIN TEAM (REMOVED) ---
// The `joinCompanyTeam` callable was permanently disabled because it had no
// real implementation behind it — any client invocation just returned an
// `unimplemented` HttpsError, and the matching `/join/:companyId` frontend
// route has been deleted. Use `createPortalUser` from the Super Admin /
// Company Admin "Add User" flow instead.
