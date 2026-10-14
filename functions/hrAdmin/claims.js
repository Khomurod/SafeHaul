// functions/hrAdmin/claims.js
//
// Rebuilds a user's custom claims from all of their memberships. The
// membership trigger and the company activation trigger both use it, so a
// deactivated company's role never comes back with an unrelated write.

const { db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");

const TEAM_ROLES = ["company_admin", "hr_user", "recruiter"];

async function deactivatedCompanyIds(companyIds) {
    const snaps = await Promise.all(companyIds.map((id) => db.collection("companies").doc(id).get()));
    return new Set(companyIds.filter((id, i) => snaps[i].exists && isCompanyDeactivated(snaps[i].data())));
}

/**
 * Sets the user's claims from scratch: `roles[companyId]`, `roles.globalRole`
 * for a super_admin membership, and `companyTeamIds` for the staff roles. A
 * deactivated company's role is left out, except for a super admin, who keeps
 * every role. Returns null when the user has no Auth account.
 */
async function syncUserClaims(userId) {
    try {
        // We verify the user exists before trying to set claims
        await auth.getUser(userId);
    } catch (e) {
        console.error("Error fetching user for claims sync:", e);
        if (e.code === 'auth/user-not-found') return null;
        throw e;
    }

    // Fetch ALL memberships to rebuild the permissions from scratch
    const memSnap = await db.collection("memberships").where("userId", "==", userId).get();
    const memberships = memSnap.docs.map((doc) => doc.data()).filter((m) => m.companyId && m.role);
    const isGlobalAdmin = memSnap.docs.some((doc) => doc.data().role === 'super_admin');
    // EVERY company this user belongs to, whatever the role, deactivated or not:
    // it decides who may read THIS user's profile (users/{uid}.companyIds), not
    // what this user may read. Derived from the staff roles, a member holding
    // any other role would be unreadable to their own teammates.
    const memberCompanyIds = [...new Set(memberships.map((m) => m.companyId))];
    const deactivated = isGlobalAdmin ? new Set() : await deactivatedCompanyIds(memberCompanyIds);

    const newClaims = { roles: {} };
    const teamRoleCompanyIds = new Set();
    for (const m of memberships) {
        if (deactivated.has(m.companyId)) continue;
        newClaims.roles[m.companyId] = m.role;
        if (TEAM_ROLES.includes(m.role)) teamRoleCompanyIds.add(m.companyId);
    }
    if (teamRoleCompanyIds.size > 0) {
        newClaims.companyTeamIds = Array.from(teamRoleCompanyIds).sort();
    }
    if (isGlobalAdmin) {
        newClaims.roles.globalRole = 'super_admin';
    }

    await auth.setCustomUserClaims(userId, newClaims);
    console.log(`Claims synced for user ${userId}. Global Admin: ${isGlobalAdmin}`);
    return { isGlobalAdmin, memberCompanyIds };
}

module.exports = { syncUserClaims };
