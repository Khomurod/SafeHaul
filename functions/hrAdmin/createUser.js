// functions/hrAdmin/createUser.js
//
// Creating a portal user: the roles a company admin may grant, the profile
// backstop for pre-existing Auth accounts, and the `createPortalUser`
// callable. Extracted verbatim from `hrAdmin.js`.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db, auth } = require("./../firebaseAdmin");
const { resolveUserIdentity, profileRepairPayload, cleanString } = require("../shared/userIdentity");

// --- 1. CREATE USER ---
// Roles a company admin may grant within their own company. `super_admin` is
// deliberately excluded — only an existing global super admin can mint one.
const ASSIGNABLE_PORTAL_ROLES = ["company_admin", "hr_user", "recruiter"];

/**
 * Make sure `users/{userId}` carries a name and email.
 *
 * WHY: `createPortalUser` only wrote a profile document when it had to create a
 * brand-new Auth account. Adding an email that ALREADY had an Auth user — the
 * normal case for a driver, a former employee, or someone who belongs to another
 * company — created the membership and no profile at all, so the team roster had
 * no name or email to show and rendered the member as "Unknown / No Email".
 *
 * Non-destructive: fills in only the fields that are missing, so re-adding a user
 * never clobbers a name they have since corrected. `preferredName` (what the admin
 * typed in the Add User form) wins over the Auth displayName, but never over a
 * name already stored in the profile.
 *
 * @returns {Promise<object>} the fields actually written (empty when nothing was missing)
 */
async function ensureUserProfile(userId, { preferredName, authUser } = {}) {
    const ref = db.collection("users").doc(userId);
    const snap = await ref.get();
    const profile = snap.exists ? (snap.data() || {}) : null;

    const identity = resolveUserIdentity(profile, authUser);
    const payload = profileRepairPayload(identity);

    // The admin-supplied name is only used when the profile itself has none.
    const typedName = cleanString(preferredName);
    if (typedName && identity.nameSource !== 'profile') payload.name = typedName;

    if (!snap.exists) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();

    if (Object.keys(payload).length === 0) return {};
    await ref.set(payload, { merge: true });
    return payload;
}

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
        let existingAuthUser = null;
        try {
            const userRecord = await auth.getUserByEmail(email);
            userId = userRecord.uid;
            existingAuthUser = userRecord;
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
                    name: cleanString(fullName) || cleanString(email),
                    email,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
            } else {
                throw e;
            }
        }

        // The email already had an Auth account. Historically this path created ONLY
        // the membership, leaving `users/{uid}` absent — the team roster then had no
        // name or email for a perfectly valid member and rendered it as
        // "Unknown / No Email". Mirror the Auth identity into Firestore, filling gaps
        // only. Best-effort: a profile write must never block adding someone to a
        // company, and `listCompanyTeam` repairs anything missed here.
        if (existingAuthUser) {
            try {
                await ensureUserProfile(userId, { preferredName: fullName, authUser: existingAuthUser });
            } catch (profileErr) {
                console.error(`[createPortalUser] Could not mirror profile for existing user ${userId}:`, profileErr.message || profileErr);
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

module.exports = {
    ASSIGNABLE_PORTAL_ROLES,
    ensureUserProfile,
    createPortalUser: exports.createPortalUser,
};
