// functions/hrAdmin/team.js
//
// The authoritative company roster: `listCompanyTeam` and the chunked Auth
// lookup it resolves members with. Extracted verbatim from `hrAdmin.js`,
// including the note on the retired `joinCompanyTeam` callable.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { db, auth } = require("./../firebaseAdmin");
const { resolveUserIdentity, profileRepairPayload, cleanString } = require("../shared/userIdentity");

// --- 5. JOIN TEAM (REMOVED) ---
// The `joinCompanyTeam` callable was permanently disabled because it had no
// real implementation behind it — any client invocation just returned an
// `unimplemented` HttpsError, and the matching `/join/:companyId` frontend
// route has been deleted. Use `createPortalUser` from the Super Admin /
// Company Admin "Add User" flow instead.

// --- 6. LIST COMPANY TEAM ---
//
// Authoritative roster for "Manage Team & Links".
//
// The modal used to resolve each member in the browser: query `memberships`, then
// read `users/{membership.userId}` per row. Every failure of that per-row read was
// collapsed into a literal fake member `{ name: 'Unknown', email: 'No Email' }`,
// which made four unrelated causes indistinguishable from each other and from a
// genuinely unknown person:
//
//   1. No `users/{uid}` document at all (a pre-existing Auth account added to a
//      company — see ensureUserProfile).
//   2. The SEC-002 rule denying the read: `users/{uid}` get requires the TARGET's
//      server-maintained `companyIds` to intersect the READER's `companyTeamIds`
//      claim. Profiles predating that field, and readers holding a stale token,
//      are denied — exactly what backfillUserCompanyIds warns about.
//   3. A profile whose name lives in a different field (`fullName`,
//      `displayName`, `firstName`/`lastName`).
//   4. A membership pointing at a uid with no Auth account — genuinely orphaned.
//
// Resolving this server-side with the Admin SDK removes causes 1–3 outright: the
// Admin SDK bypasses rules, Firebase Auth backstops a missing profile, and the
// shared resolver understands every historical name field. What remains is
// reported as a typed status per row instead of being disguised as a normal user.
//
// Authorization deliberately mirrors the existing UI gate and the `memberships`
// Firestore rule exactly — company_admin of this company, or a super admin. No
// permission is widened: this callable answers a question the caller could
// already ask, it just answers it correctly.

/** Firebase Auth allows 100 uids per getUsers() call. */
const AUTH_LOOKUP_CHUNK = 100;

/** Map of uid -> Auth UserRecord for the uids that still have an account. */
async function fetchAuthUsers(userIds) {
    const found = new Map();
    for (let i = 0; i < userIds.length; i += AUTH_LOOKUP_CHUNK) {
        const chunk = userIds.slice(i, i + AUTH_LOOKUP_CHUNK);
        try {
            const result = await auth.getUsers(chunk.map((uid) => ({ uid })));
            (result.users || []).forEach((u) => found.set(u.uid, u));
        } catch (e) {
            // Never fail the whole roster because one Auth lookup failed; those
            // members simply resolve from their Firestore profile instead.
            console.error('[listCompanyTeam] Auth lookup failed for a chunk:', e.message || e);
        }
    }
    return found;
}

exports.listCompanyTeam = onCall({ maxInstances: 3 }, async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

    const companyId = cleanString(request.data && request.data.companyId);
    if (!companyId) throw new HttpsError('invalid-argument', 'companyId is required.');

    const roles = request.auth.token.roles || {};
    const isSuperAdmin = roles.globalRole === 'super_admin';
    const isCompanyAdmin = roles[companyId] === 'company_admin';
    if (!isSuperAdmin && !isCompanyAdmin) {
        throw new HttpsError('permission-denied', 'Permission denied.');
    }

    const memSnap = await db.collection('memberships').where('companyId', '==', companyId).get();

    // Group by userId so duplicate membership documents surface as one member
    // carrying a duplicate count, rather than as repeated identical rows.
    const byUser = new Map();
    const invalidMemberships = [];
    memSnap.forEach((doc) => {
        const m = doc.data() || {};
        const userId = cleanString(m.userId);
        if (!userId) {
            // A membership with no userId can never resolve to a person.
            invalidMemberships.push({ membershipId: doc.id, role: cleanString(m.role) });
            return;
        }
        if (!byUser.has(userId)) {
            byUser.set(userId, { userId, membershipIds: [], role: cleanString(m.role) });
        }
        const entry = byUser.get(userId);
        entry.membershipIds.push(doc.id);
        if (!entry.role) entry.role = cleanString(m.role);
    });

    const userIds = [...byUser.keys()];

    // `undefined` marks a profile the server could not read (distinct from `null`,
    // which means the document genuinely does not exist).
    const profiles = await Promise.all(userIds.map(async (uid) => {
        try {
            const snap = await db.collection('users').doc(uid).get();
            return snap.exists ? (snap.data() || {}) : null;
        } catch (e) {
            console.error(`[listCompanyTeam] Could not read users/${uid}:`, e.message || e);
            return undefined;
        }
    }));

    const authUsers = await fetchAuthUsers(userIds);

    const members = [];
    const repairs = [];

    userIds.forEach((userId, index) => {
        const entry = byUser.get(userId);
        const profile = profiles[index];
        const authUser = authUsers.get(userId) || null;
        const identity = resolveUserIdentity(profile || null, authUser);

        let status = 'active';
        if (profile === undefined) {
            status = 'unreadable';
        } else if (!authUser) {
            // No sign-in account behind this membership: stale or orphaned.
            status = 'auth_missing';
        } else if (!identity.name && !identity.email) {
            status = 'unidentified';
        }

        const repairPayload = profileRepairPayload(identity);
        const repaired = status !== 'unreadable' && Object.keys(repairPayload).length > 0;
        if (repaired) repairs.push({ userId, payload: repairPayload });

        members.push({
            id: userId,
            name: identity.name,
            email: identity.email,
            role: entry.role,
            status,
            // Explains WHY a row needed help, so the UI can say so rather than
            // presenting a recovered or broken record as an ordinary member.
            profileMissing: profile === null,
            repaired,
            duplicateMembershipCount: Math.max(0, entry.membershipIds.length - 1),
            membershipIds: entry.membershipIds,
        });
    });

    // Data repair: persist identity recovered from Auth so the profile stops
    // depending on a lookup, and so the direct-read screens (lead assignment,
    // number assignment) resolve these members too. Best-effort — the roster must
    // still return if a write fails.
    if (repairs.length > 0) {
        try {
            const batch = db.batch();
            repairs.forEach(({ userId, payload }) => {
                batch.set(db.collection('users').doc(userId), payload, { merge: true });
            });
            await batch.commit();
            console.log(`[listCompanyTeam] Repaired ${repairs.length} profile(s) for company ${companyId}.`);
        } catch (repairErr) {
            console.error('[listCompanyTeam] Profile repair failed:', repairErr.message || repairErr);
        }
    }

    members.sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || ''));

    return {
        companyId,
        members,
        invalidMemberships,
        repairedCount: repairs.length,
    };
});

module.exports = {
    listCompanyTeam: exports.listCompanyTeam,
};
