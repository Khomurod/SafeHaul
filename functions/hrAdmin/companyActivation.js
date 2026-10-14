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
const { syncUserClaims } = require("./claims");

/** The waits before a member's second and third try. */
const RETRY_WAITS_MS = Object.freeze([2000, 6000]);

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

/** Replaced by the tests, which have no seconds to spend. */
const timing = {
    wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
    now: () => Date.now(),
};

/** Re-syncs one member's claims, three tries; ends their sessions when a role was taken away. */
async function updateMember(userId, endSessions) {
    // Shared by the tries: a role one of them wrote and the claims then lost
    // ends the sessions, even when that try failed and the next sync is quiet.
    const written = new Set();
    for (let attempt = 0; ; attempt += 1) {
        try {
            const synced = await syncUserClaims(userId, written);
            // A session keeps its current token for up to an hour; revoking makes the
            // next refresh fail, so the new claims cannot be ignored.
            if (synced && !synced.isGlobalAdmin && (endSessions || synced.removedDuringSync)) {
                await auth.revokeRefreshTokens(userId);
            }
            return;
        } catch (err) {
            if (attempt === RETRY_WAITS_MS.length) throw err;
            await timing.wait(RETRY_WAITS_MS[attempt]);
        }
    }
}

/** The users whose membership gives them a role in the company: the claims carry nothing for any other. */
const memberIds = async (companyId) => {
    const memSnap = await db.collection("memberships").where("companyId", "==", companyId).get();
    const members = memSnap.docs.map((doc) => doc.data()).filter((m) => m.userId && m.role);
    return [...new Set(members.map((m) => m.userId))];
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
    const userIds = await memberIds(companyId);
    for (const userId of userIds) {
        try {
            await updateMember(userId, deactivated);
        } catch (err) {
            // The hourly pass below removes a role this run could not.
            console.error(`[onCompanyActivationChange] ${companyId}: claims for ${userId} not updated:`, err.message || err);
        }
    }
    console.log(`[onCompanyActivationChange] ${companyId} ${deactivated ? 'deactivated' : 're-activated'}: ${userIds.length} member(s).`);
});

/** Does the user's token still grant this company, for anyone but a super admin? */
function stillGranted(customClaims, companyId) {
    const roles = customClaims?.roles || {};
    if ((customClaims?.globalRole || roles.globalRole) === 'super_admin') return false;
    return companyId in roles || (customClaims?.companyTeamIds || []).includes(companyId);
}

/** Does the user's token lack the role their membership gives them? */
const lacksRole = (customClaims, companyId) => !(companyId in (customClaims?.roles || {}));

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
 * still there (that session is ended), or an active company's role missing.
 * Out of time, it returns the last member it finished.
 */
async function reconcileCompany(companyId, deactivated, afterUserId, stopAt, counts) {
    const userIds = (await memberIds(companyId)).sort().filter((id) => !afterUserId || id > afterUserId);
    let last = afterUserId;
    for (let i = 0; i < userIds.length; i += AUTH_LOOKUP_CHUNK) {
        const chunk = userIds.slice(i, i + AUTH_LOOKUP_CHUNK);
        const users = await authUsers(companyId, chunk);
        for (const userId of chunk) {
            if (timing.now() >= stopAt) return { finished: false, afterUserId: last };
            const claims = users?.get(userId)?.customClaims;
            const wrong = users?.has(userId)
                && (deactivated ? stillGranted(claims, companyId) : lacksRole(claims, companyId));
            if (wrong) {
                try {
                    await updateMember(userId, deactivated);
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
 * an active company's role missing from a token (a re-activation or a
 * membership write whose run failed) is put back. Companies are read in id
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
    const counts = { companies: 0, fixed: 0 };
    const stoppedAt = await walkCompanies(await resumePoint(), stopAt, counts);
    // Cleared once the walk is complete, so the next run starts again from the
    // first company.
    await RESUME_REF().set({
        resumeCompanyId: stoppedAt?.companyId || null,
        resumeAfterUserId: stoppedAt?.afterUserId || null,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[reconcileCompanyClaims] ${counts.companies} compan(ies) checked; ${counts.fixed} member(s) re-synced`
        + (stoppedAt ? `; out of time, the next run continues in ${stoppedAt.companyId}.` : '.'));
});

exports.__test = { timing };
