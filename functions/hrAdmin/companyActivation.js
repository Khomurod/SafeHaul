// functions/hrAdmin/companyActivation.js
//
// Super Admin → Companies deactivates a company by writing `isActive: false`
// on its document. Firestore and Storage rules read only the token's roles, so
// this trigger takes the company's roles out of its staff's tokens and ends
// their sessions; re-activating puts the roles back. A super admin keeps every
// role and every session. An hourly pass fixes what a run left behind, each
// run continuing where the last one stopped.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");
const { isSuperAdminClaims } = require("../shared/superAdmin");
const { syncClaimsAndSessions, OWED_USERS, TEAM_ROLES, timing } = require("./claims");

/**
 * Where the hourly pass stopped: the company it was in and the last member it
 * finished there. Server-only: `system_jobs` has no Firestore rule. Without it,
 * a run out of time would start again at the first company every hour, and a
 * company whose members keep failing would hold back every later one.
 */
const RESUME_REF = () => db.collection("system_jobs").doc("companyClaims");
/** Companies read per page, two fields each. */
const PAGE_SIZE = 200;
/** Firebase Auth answers at most 100 uids per getUsers() call. */
const AUTH_LOOKUP_CHUNK = 100;
/** No member is started after this, inside the 300 s timeout: one member's tries take seconds. */
const RUN_BUDGET_MS = 240 * 1000;
/** The share of a run the users owed a sync may take, so the walk always moves on. */
const OWED_BUDGET_MS = 80 * 1000;

/** Each member's role in the company, from the memberships; the claims carry nothing for one without a role. */
const memberRoles = async (companyId) => {
    const memSnap = await db.collection("memberships").where("companyId", "==", companyId).get();
    const roles = new Map();
    memSnap.docs.map((doc) => doc.data()).filter((m) => m.userId && m.role).forEach((m) => roles.set(m.userId, m.role));
    return roles;
};

exports.onCompanyActivationChange = onDocumentUpdated({
    document: "companies/{companyId}",
    maxInstances: 2,
    // One claims rebuild per member, one after another, with their retries: room for a large team.
    timeoutSeconds: 300,
}, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    const deactivated = isCompanyDeactivated(after);
    // Every other update (the team cache, a profile edit) leaves the tokens alone.
    if (isCompanyDeactivated(before) === deactivated) return;

    const { companyId } = event.params;
    const userIds = [...(await memberRoles(companyId)).keys()];
    for (const userId of userIds) {
        try {
            await syncClaimsAndSessions(userId, companyId);
        } catch (err) {
            // The hourly pass below removes a role this run could not.
            console.error(`[onCompanyActivationChange] ${companyId}: claims for ${userId} not updated:`, err.message || err);
        }
    }
    console.log(`[onCompanyActivationChange] ${companyId} ${deactivated ? 'deactivated' : 're-activated'}: ${userIds.length} member(s).`);
});

/** Does the user's token still grant this company, for anyone but a super admin? */
function stillGranted(customClaims, companyId) {
    if (isSuperAdminClaims(customClaims)) return false;
    return companyId in (customClaims?.roles || {}) || (customClaims?.companyTeamIds || []).includes(companyId);
}

/** Does the token carry exactly the role the membership gives, a staff role in the team list too? */
function holdsRole(customClaims, companyId, role) {
    const inTeam = (customClaims?.companyTeamIds || []).includes(companyId);
    return customClaims?.roles?.[companyId] === role && inTeam === TEAM_ROLES.includes(role);
}

async function resumePoint() {
    try {
        const snap = await RESUME_REF().get();
        const data = (snap.exists && snap.data()) || {};
        return { companyId: data.resumeCompanyId || null, afterUserId: data.resumeAfterUserId || null };
    } catch (err) {
        console.warn('[reconcileCompanyClaims] Could not read the resume point:', err.message || err);
        return { companyId: null, afterUserId: null };
    }
}

/** The Auth records of those uids that have an account; null when the lookup failed. */
async function authUsers(companyId, userIds) {
    try {
        const result = await auth.getUsers(userIds.map((uid) => ({ uid })));
        return new Map((result.users || []).map((user) => [user.uid, user]));
    } catch (err) {
        // Looked up again by the next walk; this one moves on.
        console.error(`[reconcileCompanyClaims] ${companyId}: ${userIds.length} member(s) not looked up:`, err.message || err);
        return null;
    }
}

/**
 * Checks the company's members, in id order after `afterUserId`, and re-syncs
 * each whose token disagrees with the company: a deactivated company's role
 * still there (that session is ended), or an active company's role missing or
 * not the one the membership gives. A super admin, who keeps every role, is
 * held to the membership's role either way. Out of time, it returns the last
 * member it finished.
 */
async function reconcileCompany(companyId, deactivated, afterUserId, stopAt, counts) {
    const roles = await memberRoles(companyId);
    const userIds = [...roles.keys()].sort().filter((id) => !afterUserId || id > afterUserId);
    let last = afterUserId;
    for (let i = 0; i < userIds.length; i += AUTH_LOOKUP_CHUNK) {
        const chunk = userIds.slice(i, i + AUTH_LOOKUP_CHUNK);
        const users = await authUsers(companyId, chunk);
        for (const userId of chunk) {
            if (timing.now() >= stopAt) return { finished: false, afterUserId: last };
            const claims = users?.get(userId)?.customClaims;
            const role = roles.get(userId);
            const keepsEveryRole = role === 'super_admin' || isSuperAdminClaims(claims);
            const wrong = users?.has(userId) && (deactivated && !keepsEveryRole
                ? stillGranted(claims, companyId)
                : !holdsRole(claims, companyId, role));
            if (wrong) {
                try {
                    await syncClaimsAndSessions(userId, companyId);
                    counts.fixed += 1;
                } catch (err) {
                    // Tried again by the next walk; this one moves on.
                    console.error(`[reconcileCompanyClaims] ${companyId}: claims for ${userId} not updated:`, err.message || err);
                }
            }
            last = userId;
        }
    }
    return { finished: true };
}

/**
 * Users whose claims sync failed every try (claims.js records them, a removed
 * member included): synced again, and their sessions ended while a recorded
 * role is still missing, so a role given back since ends nothing. Oldest first,
 * within a share of the run; a record that fails again moves to the back.
 */
async function settleOwedUsers(stopAt, counts) {
    const owedStopAt = Math.min(stopAt, timing.now() + OWED_BUDGET_MS);
    let owed;
    try {
        owed = await OWED_USERS().orderBy("since").limit(PAGE_SIZE).get();
    } catch (err) {
        console.error('[reconcileCompanyClaims] Could not read the users owed a sync:', err.message || err);
        return;
    }
    for (const doc of owed.docs) {
        if (timing.now() >= owedStopAt) return;
        try {
            const synced = await syncClaimsAndSessions(doc.id);
            const companyIds = doc.data()?.companyIds || [];
            if (synced && !synced.isGlobalAdmin && companyIds.some((id) => !(id in synced.roles))) {
                await auth.revokeRefreshTokens(doc.id);
                counts.ended += 1;
            }
            counts.settled += 1;
            // Only the record this run read: one written since stays for the next run.
            await doc.ref.delete({ lastUpdateTime: doc.updateTime }).catch((err) => {
                console.log(`[reconcileCompanyClaims] A newer record for ${doc.id} is kept for the next run:`, err.message || err);
            });
        } catch (err) {
            console.error(`[reconcileCompanyClaims] ${doc.id} not settled; tried again next run:`, err.message || err);
            await doc.ref.set({ since: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});
        }
    }
}

/** Walks the companies in id order from `resume`, a page at a time; returns where it stopped, or null at the end. */
async function walkCompanies(resume, stopAt, counts) {
    const companies = db.collection("companies").select("isActive", "status").orderBy("__name__");
    let page = await (resume.companyId ? companies.startAt(resume.companyId) : companies).limit(PAGE_SIZE).get();
    for (;;) {
        for (const company of page.docs) {
            const deactivated = isCompanyDeactivated(company.data());
            counts.companies += 1;
            const afterUserId = company.id === resume.companyId ? resume.afterUserId : null;
            const result = await reconcileCompany(company.id, deactivated, afterUserId, stopAt, counts);
            if (!result.finished) return { companyId: company.id, afterUserId: result.afterUserId };
        }
        if (page.size < PAGE_SIZE) return null;
        page = await companies.startAfter(page.docs[page.docs.length - 1].id).limit(PAGE_SIZE).get();
    }
}

/**
 * Every hour: a member whose token disagrees with their company is re-synced.
 * A deactivated company's role still in a token (a run that failed, a company
 * deactivated before the trigger existed) is removed and that session ended;
 * an active company's role missing from a token, or not the membership's (a
 * re-activation or a membership write whose run failed), is set right. Users
 * an earlier run could not sync at all are synced again first. Companies are read in id
 * order, two fields each, and judged as the trigger judges them; members are
 * looked up 100 at a time. A run out of time records where it stopped, and the
 * next run continues from there.
 */
exports.reconcileCompanyClaims = onSchedule({
    schedule: 'every 60 minutes',
    region: 'us-central1',
    timeoutSeconds: 300,
}, async () => {
    const stopAt = timing.now() + RUN_BUDGET_MS;
    const counts = { companies: 0, fixed: 0, settled: 0, ended: 0 };
    await settleOwedUsers(stopAt, counts);
    const stoppedAt = await walkCompanies(await resumePoint(), stopAt, counts);
    // Cleared once the walk is complete, so the next run starts again from the
    // first company.
    await RESUME_REF().set({
        resumeCompanyId: stoppedAt?.companyId || null,
        resumeAfterUserId: stoppedAt?.afterUserId || null,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[reconcileCompanyClaims] ${counts.settled} owed user(s) synced, ${counts.ended} session end(s); ${counts.companies} compan(ies) checked; ${counts.fixed} member(s) re-synced`
        + (stoppedAt ? `; out of time, the next run continues in ${stoppedAt.companyId}.` : '.'));
});

exports.__test = { timing };
