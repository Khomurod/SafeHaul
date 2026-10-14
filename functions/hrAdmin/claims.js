// functions/hrAdmin/claims.js
//
// Rebuilds a user's custom claims from all of their memberships, and ends
// their sessions when a role a token may carry was taken away. The membership
// trigger, the company activation trigger and its hourly reconciliation use
// it, so a deactivated company's role never comes back with an unrelated write.

const { db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");

const TEAM_ROLES = ["company_admin", "hr_user", "recruiter"];
/** Writes that may be followed by a change before the claims settle. */
const MAX_WRITES = 3;
/** The waits before a user's second and third try. */
const RETRY_WAITS_MS = Object.freeze([2000, 6000]);

/** Replaced by the tests, which have no seconds to spend. */
const timing = {
    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now: () => Date.now(),
};

async function deactivatedCompanyIds(companyIds) {
    const snaps = await Promise.all(companyIds.map((id) => db.collection("companies").doc(id).get()));
    return new Set(companyIds.filter((id, i) => snaps[i].exists && isCompanyDeactivated(snaps[i].data())));
}

/** The claims the user's memberships and companies call for now. */
async function computeClaims(userId) {
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

    const claims = { roles: {} };
    const teamRoleCompanyIds = new Set();
    for (const m of memberships) {
        if (deactivated.has(m.companyId)) continue;
        claims.roles[m.companyId] = m.role;
        if (TEAM_ROLES.includes(m.role)) teamRoleCompanyIds.add(m.companyId);
    }
    if (teamRoleCompanyIds.size > 0) {
        claims.companyTeamIds = Array.from(teamRoleCompanyIds).sort();
    }
    if (isGlobalAdmin) {
        claims.roles.globalRole = 'super_admin';
    }
    return { claims, isGlobalAdmin, memberCompanyIds, deactivated };
}

const companyRoles = (claims) => Object.keys(claims?.roles || {}).filter((key) => key !== 'globalRole');
const sameClaims = (a, b) => JSON.stringify(Object.entries(a.roles).sort()) === JSON.stringify(Object.entries(b.roles).sort())
    && JSON.stringify(a.companyTeamIds || []) === JSON.stringify(b.companyTeamIds || []);

/**
 * Sets the user's claims from scratch: `roles[companyId]`, `roles.globalRole`
 * for a super_admin membership, and `companyTeamIds` for the staff roles. A
 * deactivated company's role is left out, except for a super admin, who keeps
 * every role. Returns null when the user has no Auth account.
 *
 * After each write the claims are worked out again: a company deactivated or a
 * membership changed in the meantime would otherwise leave what an earlier
 * reading called for. `written` collects every company whose role a live token
 * may carry: one a write put in the token, or a deactivated company's role the
 * stored claims still held (a run that failed left it). A caller that tries
 * again passes the same set, so a try that failed counts too.
 * `removedDuringSync` says one of them is not in the claims that settled.
 */
async function syncUserClaims(userId, written = new Set()) {
    let user;
    try {
        // We verify the user exists before trying to set claims
        user = await auth.getUser(userId);
    } catch (e) {
        console.error("Error fetching user for claims sync:", e);
        if (e.code === 'auth/user-not-found') return null;
        throw e;
    }

    let wanted = await computeClaims(userId);
    companyRoles(user.customClaims).filter((id) => wanted.deactivated.has(id)).forEach((id) => written.add(id));
    for (let write = 1; ; write += 1) {
        // Counted before the write: one that fails may still have been applied.
        companyRoles(wanted.claims).forEach((id) => written.add(id));
        await auth.setCustomUserClaims(userId, wanted.claims);
        const now = await computeClaims(userId);
        if (sameClaims(now.claims, wanted.claims)) {
            console.log(`Claims synced for user ${userId}. Global Admin: ${now.isGlobalAdmin}`);
            const removedDuringSync = [...written].some((id) => !(id in now.claims.roles));
            return { isGlobalAdmin: now.isGlobalAdmin, memberCompanyIds: now.memberCompanyIds, removedDuringSync };
        }
        if (write === MAX_WRITES) throw new Error(`Claims for ${userId} kept changing while they were written.`);
        wanted = now;
    }
}

/**
 * Re-syncs one user's claims, three tries, and ends their sessions when
 * `endSessions` asks or a role a live token may carry was taken away: a
 * session keeps its current token for up to an hour, and revoking makes the
 * next refresh fail. Never a super admin's. Returns what syncUserClaims did.
 */
async function syncClaimsAndSessions(userId, endSessions) {
    // Shared by the tries: a role one of them saw in a token and the claims
    // then lost ends the sessions, even when that try failed and the next
    // sync is quiet.
    const written = new Set();
    for (let attempt = 0; ; attempt += 1) {
        try {
            const synced = await syncUserClaims(userId, written);
            if (synced && !synced.isGlobalAdmin && (endSessions || synced.removedDuringSync)) {
                await auth.revokeRefreshTokens(userId);
            }
            return synced;
        } catch (err) {
            if (attempt === RETRY_WAITS_MS.length) throw err;
            await timing.wait(RETRY_WAITS_MS[attempt]);
        }
    }
}

module.exports = { syncUserClaims, syncClaimsAndSessions, TEAM_ROLES, timing };
