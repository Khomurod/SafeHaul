// functions/hrAdmin/membership.js
//
// The membership-write trigger that keeps custom claims and the company team
// cache in sync with `memberships/`. The claims come from claims.js.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db } = require("./../firebaseAdmin");
const { syncUserClaims } = require("./claims");


// --- 2. SYNC CLAIMS TRIGGER (The Critical Fix) ---
exports.onMembershipWrite = onDocumentWritten({
    document: "memberships/{membershipId}",
    maxInstances: 2
}, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const userId = after ? after.userId : before?.userId;
    if (!userId) return;

    // Claims from every membership; a deactivated company's role stays out (claims.js).
    const synced = await syncUserClaims(userId);
    if (!synced) return;

    // SEC-002: mirror the user's company memberships onto users/{uid}.companyIds so
    // Firestore rules can allow same-company teammate reads (readerSharesCompany)
    // without exposing the profile across tenants. Server-only write (Admin SDK);
    // clients are blocked from editing companyIds. merge:true preserves name/email.
    try {
        const companyIdsList = [...synced.memberCompanyIds].sort();
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
