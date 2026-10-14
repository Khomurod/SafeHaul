// functions/hrAdmin/companyActivation.js
//
// Super Admin → Companies deactivates a company by writing `isActive: false`
// on its document. Firestore and Storage rules read only the token's roles, so
// this trigger takes the company's roles out of its staff's tokens and ends
// their sessions; re-activating puts the roles back. A super admin keeps every
// role and every session. An hourly pass removes a role a run left behind,
// each run continuing where the last one stopped.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { admin, db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");
const { syncUserClaims } = require("./claims");

/** The waits before a member's second and third try. */
const RETRY_WAITS_MS = Object.freeze([2000, 6000]);

/**
 * Where the hourly pass stopped. Server-only: `system_jobs` has no Firestore
 * rule. Without it, a run out of time would start again at the first company
 * every hour and never reach the last ones.
 */
const RESUME_REF = () => db.collection("system_jobs").doc("deactivatedCompanyClaims");
/** Companies read per page, two fields each. */
const PAGE_SIZE = 200;
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

const memberIds = async (companyId) => {
    const memSnap = await db.collection("memberships").where("companyId", "==", companyId).get();
    return [...new Set(memSnap.docs.map((doc) => doc.data().userId).filter(Boolean))];
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

async function resumePoint() {
    try {
        const snap = await RESUME_REF().get();
        return (snap.exists && snap.data()?.resumeAfterCompanyId) || null;
    } catch (err) {
        console.warn('[reconcileDeactivatedCompanyClaims] Could not read the resume point:', err.message || err);
        return null;
    }
}

/** Re-syncs the company's members whose claims still grant it; false when the run's time ran out first. */
async function reconcileCompany(companyId, stopAt, counts) {
    for (const userId of await memberIds(companyId)) {
        if (timing.now() >= stopAt) return false;
        try {
            const user = await auth.getUser(userId);
            if (!stillGranted(user.customClaims, companyId)) continue;
            await updateMember(userId, true);
            counts.fixed += 1;
        } catch (err) {
            if (err?.code === 'auth/user-not-found') continue;
            console.error(`[reconcileDeactivatedCompanyClaims] ${companyId}: claims for ${userId} not updated:`, err.message || err);
        }
    }
    return true;
}

/** Walks the companies after `startAfter`, a page at a time; `resumeAfter` is the last one finished. */
async function walkCompanies(startAfter, stopAt, counts) {
    const companies = db.collection("companies").select("isActive", "status").orderBy("__name__");
    let done = startAfter;
    for (;;) {
        const page = await (done ? companies.startAfter(done) : companies).limit(PAGE_SIZE).get();
        for (const company of page.docs) {
            if (isCompanyDeactivated(company.data())) {
                counts.deactivated += 1;
                if (!(await reconcileCompany(company.id, stopAt, counts))) return { finished: false, resumeAfter: done };
            }
            done = company.id;
        }
        if (page.size < PAGE_SIZE) return { finished: true, resumeAfter: null };
    }
}

/**
 * Every hour: a deactivated company's members whose claims still carry its role
 * (a run that failed, a company deactivated before the trigger existed) are
 * re-synced and their sessions ended. Companies are read in id order, two
 * fields each, and judged as the trigger judges them: `isActive: false` or an
 * inactive status. A run out of time records the last company it finished, and
 * the next run continues after it.
 */
exports.reconcileDeactivatedCompanyClaims = onSchedule({
    schedule: 'every 60 minutes',
    region: 'us-central1',
    timeoutSeconds: 300,
}, async () => {
    const stopAt = timing.now() + RUN_BUDGET_MS;
    const counts = { deactivated: 0, fixed: 0 };
    const { finished, resumeAfter } = await walkCompanies(await resumePoint(), stopAt, counts);
    // Null once the walk is complete, so the next run starts again from the
    // first company and finds the ones deactivated since.
    await RESUME_REF().set({
        resumeAfterCompanyId: resumeAfter,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`[reconcileDeactivatedCompanyClaims] ${counts.deactivated} deactivated compan(ies); ${counts.fixed} member(s) re-synced`
        + (finished ? '.' : `; out of time, the next run continues ${resumeAfter ? `after ${resumeAfter}` : 'from the first company'}.`));
});

exports.__test = { timing };
