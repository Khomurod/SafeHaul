// functions/hrAdmin/membership.js
//
// The membership-write trigger that keeps custom claims and the company team
// cache in sync with `memberships/`. Extracted verbatim from `hrAdmin.js`.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db, auth } = require("./../firebaseAdmin");


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

module.exports = {
    onMembershipWrite: exports.onMembershipWrite,
};
