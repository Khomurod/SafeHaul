// functions/hrAdmin/companyActivation.js
//
// Super Admin → Companies deactivates a company by writing `isActive: false`
// on its document. Firestore and Storage rules read only the token's roles, so
// this trigger takes the company's roles out of its staff's tokens and ends
// their sessions; re-activating puts the roles back. A super admin keeps every
// role and every session.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { db, auth } = require("./../firebaseAdmin");
const { isCompanyDeactivated } = require("../shared/companyTenant");
const { syncUserClaims } = require("./claims");

exports.onCompanyActivationChange = onDocumentUpdated({
    document: "companies/{companyId}",
    maxInstances: 2,
    // One claims rebuild per member, one after another: room for a large team.
    timeoutSeconds: 300,
}, async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    const deactivated = isCompanyDeactivated(after);
    // Every other update (the team cache, a profile edit) leaves the tokens alone.
    if (isCompanyDeactivated(before) === deactivated) return;

    const { companyId } = event.params;
    const memSnap = await db.collection("memberships").where("companyId", "==", companyId).get();
    const userIds = [...new Set(memSnap.docs.map((doc) => doc.data().userId).filter(Boolean))];

    for (const userId of userIds) {
        try {
            const synced = await syncUserClaims(userId);
            // A session keeps its current token for up to an hour; revoking makes the
            // next refresh fail, so the new claims cannot be ignored.
            if (synced && deactivated && !synced.isGlobalAdmin) {
                await auth.revokeRefreshTokens(userId);
            }
        } catch (err) {
            console.error(`[onCompanyActivationChange] ${companyId}: claims for ${userId} not updated:`, err.message || err);
        }
    }
    console.log(`[onCompanyActivationChange] ${companyId} ${deactivated ? 'deactivated' : 're-activated'}: ${userIds.length} member(s) updated.`);
});
