// functions/hrAdmin/claims.js
//
// Rebuilds a user's custom claims from all of their memberships, and ends
// their sessions when a role a token may carry was taken away. The membership
// trigger, the company activation trigger and its hourly reconciliation use
// it, so a deactivated company's role never comes back with an unrelated write.

const { admin, db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");

const TEAM_ROLES = ["company_admin", "hr_user", "recruiter"];
/** Writes that may be followed by a change before the claims settle. */
const MAX_WRITES = 3;
/** The waits before a user's second and third try. */
const RETRY_WAITS_MS = Object.freeze([2000, 6000]);

/**
 * Users whose claims sync failed every try. The hourly pass syncs them again,
 * and ends their sessions while a role a live token may carry, listed in
 * `companyIds`, is still missing. Server-only: `system_jobs` has no rule.
 */
const OWED_USERS = () => db.collection("system_jobs").doc("companyClaims").collection("owedUsers");

/** Replaced by the tests, which have no seconds to spend. */
const timing = {
    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now: () => Date.now(),
};

async function deactivatedCompanyIds(companyIds) {
    const snaps = await Promise.all(companyIds.map((id) => db.collection("companies").doc(id).get()));
    return new Set(companyIds.filter((id, i) => snaps[i].exists && isCompanyDeactivated(snaps[i].data())));
}

/**
 * The claims the user's memberships and companies call for now. A super admin
 * claim at the token root, which no membership grants, is kept as it is.
 */
async function computeClaims(userId, storedClaims) {
    // Fetch ALL memberships to rebuild the permissions from scratch
    const memSnap = await db.collection("memberships").where("userId", "==", userId).get();
    const memberships = memSnap.docs.map((doc) => doc.data()).filter((m) => m.companyId && m.role);
    const membershipSuperAdmin = memSnap.docs.some((doc) => doc.data().role === 'super_admin');
    const rootSuperAdmin = storedClaims?.globalRole === 'super_admin';
    const isGlobalAdmin = membershipSuperAdmin || rootSuperAdmin;
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
    if (membershipSuperAdmin) {
        claims.roles.globalRole = 'super_admin';
    }
    if (rootSuperAdmin) claims.globalRole = 'super_admin';
    return { claims, isGlobalAdmin, memberCompanyIds, deactivated };
}

/** What a user's tries share; see syncUserClaims. */
const newSyncState = () => ({ written: new Set(), isGlobalAdmin: false, roles: {}, deactivated: new Set() });

const companyRoles = (claims) => Object.keys(claims?.roles || {}).filter((key) => key !== 'globalRole');
const sameClaims = (a, b) => JSON.stringify(Object.entries(a.roles).sort()) === JSON.stringify(Object.entries(b.roles).sort())
    && JSON.stringify(a.companyTeamIds || []) === JSON.stringify(b.companyTeamIds || [])
    && a.globalRole === b.globalRole;

/**
 * Sets the user's claims from scratch: `roles[companyId]`, `roles.globalRole`
 * for a super_admin membership, and `companyTeamIds` for the staff roles. A
 * deactivated company's role is left out, except for a super admin, who keeps
 * every role. Returns null when the user has no Auth account.
 *
 * After each write the claims are worked out again: a company deactivated or a
 * membership changed in the meantime would otherwise leave what an earlier
 * reading called for. `state.written` collects every company whose role a live
 * token may carry: one a write put in the token, or a deactivated company's
 * role the stored claims still held (a run that failed left it). The state
 * also keeps what the latest reading called for. A caller that tries again
 * passes the same state, so a try that failed counts too.
 */
async function syncUserClaims(userId, state = newSyncState()) {
    const { written } = state;
    let user;
    try {
        // We verify the user exists before trying to set claims
        user = await auth.getUser(userId);
    } catch (e) {
        console.error("Error fetching user for claims sync:", e);
        if (e.code === 'auth/user-not-found') return null;
        throw e;
    }

    let wanted = await computeClaims(userId, user.customClaims);
    companyRoles(user.customClaims).filter((id) => wanted.deactivated.has(id)).forEach((id) => written.add(id));
    for (let write = 1; ; write += 1) {
        // What the latest reading called for, for a caller whose every try fails.
        Object.assign(state, { isGlobalAdmin: wanted.isGlobalAdmin, roles: wanted.claims.roles, deactivated: wanted.deactivated });
        // Counted before the write: one that fails may still have been applied.
        companyRoles(wanted.claims).forEach((id) => written.add(id));
        await auth.setCustomUserClaims(userId, wanted.claims);
        const now = await computeClaims(userId, user.customClaims);
        if (sameClaims(now.claims, wanted.claims)) {
            console.log(`Claims synced for user ${userId}. Global Admin: ${now.isGlobalAdmin}`);
            return {
                isGlobalAdmin: now.isGlobalAdmin,
                memberCompanyIds: now.memberCompanyIds,
                deactivated: now.deactivated,
                roles: now.claims.roles,
            };
        }
        if (write === MAX_WRITES) throw new Error(`Claims for ${userId} kept changing while they were written.`);
        wanted = now;
    }
}

/**
 * The companies whose role a live token may carry and the latest claims lack,
 * for anyone but a super admin. Decided by the state the claims came to, not
 * the event that asked: a deactivation handled after the re-activation that
 * followed it ends nothing.
 */
function rolesToEnd({ isGlobalAdmin, roles, deactivated, written }, companyId) {
    if (isGlobalAdmin) return [];
    const ids = new Set([...written].filter((id) => !(id in roles)));
    if (companyId !== null && deactivated.has(companyId)) ids.add(companyId);
    return [...ids].sort();
}

/** Records a user the hourly pass must sync again, three tries of its own. */
async function recordOwed(userId, companyIds) {
    const data = { since: admin.firestore.FieldValue.serverTimestamp() };
    if (companyIds.length > 0) data.companyIds = admin.firestore.FieldValue.arrayUnion(...companyIds);
    for (let attempt = 0; ; attempt += 1) {
        try {
            await OWED_USERS().doc(userId).set(data, { merge: true });
            return;
        } catch (err) {
            if (attempt === RETRY_WAITS_MS.length) {
                console.error(`[claims] ${userId} was not recorded for another sync:`, err.message || err);
                return;
            }
            await timing.wait(RETRY_WAITS_MS[attempt]);
        }
    }
}

/**
 * Re-syncs one user's claims, three tries, and ends their sessions when the
 * claims settle with `companyId` deactivated, or a role a live token may carry
 * was taken away (rolesToEnd): a session keeps its current token for up to an
 * hour, and revoking makes the next refresh fail. Never a super admin's. When
 * every try fails, the user is recorded for the hourly pass with the roles
 * still to end. Returns what syncUserClaims did.
 */
async function syncClaimsAndSessions(userId, companyId = null) {
    // Shared by the tries: a role one of them saw in a token and the claims
    // then lost ends the sessions, even when that try failed and the next
    // sync is quiet.
    const state = newSyncState();
    for (let attempt = 0; ; attempt += 1) {
        try {
            const synced = await syncUserClaims(userId, state);
            if (synced && rolesToEnd(state, companyId).length > 0) await auth.revokeRefreshTokens(userId);
            return synced;
        } catch (err) {
            if (attempt === RETRY_WAITS_MS.length) {
                await recordOwed(userId, rolesToEnd(state, companyId));
                throw err;
            }
            await timing.wait(RETRY_WAITS_MS[attempt]);
        }
    }
}

module.exports = { syncUserClaims, syncClaimsAndSessions, OWED_USERS, TEAM_ROLES, timing };
