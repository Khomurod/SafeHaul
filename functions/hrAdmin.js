// hr portal/functions/hrAdmin.js

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db, auth } = require("./firebaseAdmin");
const { resolveUserIdentity, profileRepairPayload, cleanString } = require("./shared/userIdentity");

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
    // Companies where this user holds a STAFF role. Drives the `companyTeamIds`
    // capability claim — i.e. which companies' data this user may read.
    const teamRoleCompanyIds = new Set();
    // EVERY company this user belongs to, whatever the role. Drives
    // `users/{uid}.companyIds`, which is about who may read THIS user's profile,
    // not about what this user may read.
    //
    // These two sets are deliberately different. Deriving profile visibility from
    // the staff-role allowlist meant a member holding any other role (e.g. a
    // company-scoped super_admin) got `companyIds: []` and became unreadable to
    // their own teammates, so the team roster showed them as "Unknown / No Email".
    // It also silently contradicted backfillUserCompanyIds, which maps every
    // membership with a companyId: the backfill repaired such a user, then the very
    // next membership write reverted them. This set matches the backfill.
    const memberCompanyIds = new Set();
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
            memberCompanyIds.add(m.companyId);
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
        const companyIdsList = Array.from(memberCompanyIds).sort();
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

// --- 6. LIST COMPANY TEAM ---
//
// Authoritative roster for "Manage Team & Links".
//
// The modal used to resolve each member in the browser: query `memberships`, then
// read `users/{membership.userId}` per row. Every failure of that per-row read was
// collapsed into a literal fake member `{ name: 'Unknown', email: 'No Email' }`,
// which made four unrelated causes indistinguishable from each other and from a
// genuinely unknown person:
//
//   1. No `users/{uid}` document at all (a pre-existing Auth account added to a
//      company — see ensureUserProfile).
//   2. The SEC-002 rule denying the read: `users/{uid}` get requires the TARGET's
//      server-maintained `companyIds` to intersect the READER's `companyTeamIds`
//      claim. Profiles predating that field, and readers holding a stale token,
//      are denied — exactly what backfillUserCompanyIds warns about.
//   3. A profile whose name lives in a different field (`fullName`,
//      `displayName`, `firstName`/`lastName`).
//   4. A membership pointing at a uid with no Auth account — genuinely orphaned.
//
// Resolving this server-side with the Admin SDK removes causes 1–3 outright: the
// Admin SDK bypasses rules, Firebase Auth backstops a missing profile, and the
// shared resolver understands every historical name field. What remains is
// reported as a typed status per row instead of being disguised as a normal user.
//
// Authorization deliberately mirrors the existing UI gate and the `memberships`
// Firestore rule exactly — company_admin of this company, or a super admin. No
// permission is widened: this callable answers a question the caller could
// already ask, it just answers it correctly.

/** Firebase Auth allows 100 uids per getUsers() call. */
const AUTH_LOOKUP_CHUNK = 100;

/** Map of uid -> Auth UserRecord for the uids that still have an account. */
async function fetchAuthUsers(userIds) {
    const found = new Map();
    for (let i = 0; i < userIds.length; i += AUTH_LOOKUP_CHUNK) {
        const chunk = userIds.slice(i, i + AUTH_LOOKUP_CHUNK);
        try {
            const result = await auth.getUsers(chunk.map((uid) => ({ uid })));
            (result.users || []).forEach((u) => found.set(u.uid, u));
        } catch (e) {
            // Never fail the whole roster because one Auth lookup failed; those
            // members simply resolve from their Firestore profile instead.
            console.error('[listCompanyTeam] Auth lookup failed for a chunk:', e.message || e);
        }
    }
    return found;
}

exports.listCompanyTeam = onCall({ maxInstances: 3 }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const companyId = cleanString(request.data && request.data.companyId);
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');

    const roles = request.auth.token.roles || {};
    const isSuperAdmin = roles.globalRole === 'super_admin';
    const isCompanyAdmin = roles[companyId] === 'company_admin';
    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError('permission-denied', 'Permission denied.');
    }

    const memSnap = await db.collection('memberships').where('companyId', '==', companyId).get();

    // Group by userId so duplicate membership documents surface as one member
    // carrying a duplicate count, rather than as repeated identical rows.
    const byUser = new Map();
    const invalidMemberships = [];
    memSnap.forEach((doc) => {
        const m = doc.data() || {};
        const userId = cleanString(m.userId);
        if (!userId) {
            // A membership with no userId can never resolve to a person.
            invalidMemberships.push({ membershipId: doc.id, role: cleanString(m.role) });
            return;
        }
        if (!byUser.has(userId)) {
            byUser.set(userId, { userId, membershipIds: [], role: cleanString(m.role) });
        }
        const entry = byUser.get(userId);
        entry.membershipIds.push(doc.id);
        if (!entry.role) entry.role = cleanString(m.role);
    });

    const userIds = [...byUser.keys()];

    // `undefined` marks a profile the server could not read (distinct from `null`,
    // which means the document genuinely does not exist).
    const profiles = await Promise.all(userIds.map(async (uid) => {
        try {
            const snap = await db.collection('users').doc(uid).get();
            return snap.exists ? (snap.data() || {}) : null;
        } catch (e) {
            console.error(`[listCompanyTeam] Could not read users/${uid}:`, e.message || e);
            return undefined;
        }
    }));

    const authUsers = await fetchAuthUsers(userIds);

    const members = [];
    const repairs = [];

    userIds.forEach((userId, index) => {
        const entry = byUser.get(userId);
        const profile = profiles[index];
        const authUser = authUsers.get(userId) || null;
        const identity = resolveUserIdentity(profile || null, authUser);

        let status = 'active';
        if (profile === undefined) {
            status = 'unreadable';
        } else if (!authUser) {
            // No sign-in account behind this membership: stale or orphaned.
            status = 'auth_missing';
        } else if (!identity.name && !identity.email) {
            status = 'unidentified';
        }

        const repairPayload = profileRepairPayload(identity);
        const repaired = status !== 'unreadable' && Object.keys(repairPayload).length > 0;
        if (repaired) repairs.push({ userId, payload: repairPayload });

        members.push({
            id: userId,
            name: identity.name,
            email: identity.email,
            role: entry.role,
            status,
            // Explains WHY a row needed help, so the UI can say so rather than
            // presenting a recovered or broken record as an ordinary member.
            profileMissing: profile === null,
            repaired,
            duplicateMembershipCount: Math.max(0, entry.membershipIds.length - 1),
            membershipIds: entry.membershipIds,
        });
    });

    // Data repair: persist identity recovered from Auth so the profile stops
    // depending on a lookup, and so the direct-read screens (lead assignment,
    // number assignment) resolve these members too. Best-effort — the roster must
    // still return if a write fails.
    if (repairs.length > 0) {
        try {
            const batch = db.batch();
            repairs.forEach(({ userId, payload }) => {
                batch.set(db.collection('users').doc(userId), payload, { merge: true });
            });
            await batch.commit();
            console.log(`[listCompanyTeam] Repaired ${repairs.length} profile(s) for company ${companyId}.`);
        } catch (repairErr) {
            console.error('[listCompanyTeam] Profile repair failed:', repairErr.message || repairErr);
        }
    }

    members.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));

    return {
        companyId,
        members,
        invalidMemberships,
        repairedCount: repairs.length,
    };
});
