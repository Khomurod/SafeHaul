// functions/hrAdmin/companyActivation.js
//
// Super Admin → Companies deactivates a company by writing `isActive: false`
// on its document. Firestore and Storage rules read only the token's roles, so
// this trigger takes the company's roles out of its staff's tokens and ends
// their sessions; re-activating puts the roles back. A super admin keeps every
// role and every session. An hourly pass removes a role a run left behind.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");
const { syncUserClaims } = require("./claims");

/** The waits before a member's second and third try. */
const RETRY_WAITS_MS = Object.freeze([2000, 6000]);

/** Replaced by the tests, which have no seconds to spend. */
const timing = { wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }) };

/** Re-syncs one member's claims, three tries; ends their sessions when a role was taken away. */
async function updateMember(userId, endSessions) {
    // Kept across the tries: a role taken back in one try still ends the
    // sessions when that try's revocation failed and the next sync is quiet.
    let revoke = endSessions;
    for (let attempt = 0; ; attempt += 1) {
        try {
            const synced = await syncUserClaims(userId);
            if (synced?.removedDuringSync) revoke = true;
            // A session keeps its current token for up to an hour; revoking makes the
            // next refresh fail, so the new claims cannot be ignored.
            if (synced && !synced.isGlobalAdmin && revoke) {
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

/**
 * Every hour: a deactivated company's members whose claims still carry its role
 * (a run that failed, a company deactivated before the trigger existed) are
 * re-synced and their sessions ended. Every company is read, two fields each,
 * and judged as the trigger judges it: `isActive: false` or an inactive status.
 */
exports.reconcileDeactivatedCompanyClaims = onSchedule({
    schedule: 'every 60 minutes',
    region: 'us-central1',
    timeoutSeconds: 300,
}, async () => {
    const snap = await db.collection("companies").select("isActive", "status").get();
    const companies = snap.docs.filter((doc) => isCompanyDeactivated(doc.data()));
    let fixed = 0;
    for (const company of companies) {
        for (const userId of await memberIds(company.id)) {
            try {
                const user = await auth.getUser(userId);
                if (!stillGranted(user.customClaims, company.id)) continue;
                await updateMember(userId, true);
                fixed += 1;
            } catch (err) {
                if (err?.code === 'auth/user-not-found') continue;
                console.error(`[reconcileDeactivatedCompanyClaims] ${company.id}: claims for ${userId} not updated:`, err.message || err);
            }
        }
    }
    console.log(`[reconcileDeactivatedCompanyClaims] ${companies.length} deactivated compan(ies); ${fixed} member(s) re-synced.`);
});

exports.__test = { timing };
