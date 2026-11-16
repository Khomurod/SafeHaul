// functions/hrAdmin/membership.js
//
// The membership-write trigger that keeps custom claims and the company team
// cache in sync with `memberships/`. The claims come from claims.js.

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { admin, db } = require("./../firebaseAdmin");
const { syncClaimsAndSessions } = require("./claims");
const { nameFromProfile, emailFromProfile } = require("../shared/userIdentity");
const { sameStoredValue } = require("../shared/unchangedWrite");

/**
 * The saved team list for one company's memberships: one entry per membership,
 * in their order, named by the rule Settings → Team uses (`userIdentity.js`).
 * `'Unknown'` and `''` stay the none values the screens read as "no name". All
 * profiles come from one `getAll` (it refuses zero references); a membership
 * without a usable `userId` is not read. If that read fails, this throws and the
 * company's rewrite is skipped and logged, rather than writing `'Unknown'` over
 * a good list; the next membership write rewrites it.
 */
async function teamOf(memberDocs) {
    const memberships = memberDocs.map((d) => d.data() || {});
    const uids = [...new Set(memberships.map((m) => m.userId).filter((id) => typeof id === 'string' && id))];
    const snaps = uids.length ? await db.getAll(...uids.map((id) => db.collection('users').doc(id))) : [];
    const profiles = new Map(snaps.map((s) => [s.id, s.exists ? s.data() : null]));
    return memberships.map((m) => {
        const p = profiles.get(m.userId) || null;
        return {
            userId: m.userId,
            role: m.role,
            name: nameFromProfile(p) || 'Unknown',
            email: emailFromProfile(p) || ''
        };
    });
}


// --- 2. SYNC CLAIMS TRIGGER (The Critical Fix) ---
exports.onMembershipWrite = onDocumentWritten({
    document: "memberships/{membershipId}",
    maxInstances: 2
}, async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    const userId = after ? after.userId : before?.userId;
    if (!userId) return;

    // Claims from every membership; a deactivated company's role stays out, and
    // one a live token may carry ends the sessions (claims.js).
    const synced = await syncClaimsAndSessions(userId);
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

    // A company whose saved list already reads so is not written: the write
    // would wake every open workspace's listener on the company and fire the
    // company's triggers for nothing. A company that cannot be read is written.
    for (const cid of validCompanyIds) {
        try {
            const companyRef = db.collection('companies').doc(cid);
            const [teamSnap, companySnap] = await Promise.all([
                db.collection('memberships').where('companyId', '==', cid).get(),
                companyRef.get().catch((readError) => {
                    console.warn(`Could not read company ${cid} before saving its team:`, readError.message || readError);
                    return null;
                }),
            ]);
            const resolvedTeam = await teamOf(teamSnap.docs);

            if (companySnap?.exists && sameStoredValue(companySnap.data()?.teamMembers, resolvedTeam)) {
                console.log(`teamMembers cache for Company ${cid} already current (${resolvedTeam.length} members).`);
                continue;
            }

            await companyRef.update({
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
