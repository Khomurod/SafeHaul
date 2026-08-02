// functions/backfillUserCompanyIds.js
//
// SEC-002 companion: one-time (idempotent) backfill that populates
// users/{uid}.companyIds from the memberships collection.
//
// WHY: the SEC-002 Firestore rules allow a staff member to read another user's
// profile only when they share a company (readerSharesCompany intersects the
// caller's companyTeamIds claim with the target's companyIds array). Going
// forward, onMembershipWrite keeps companyIds in sync. But EXISTING user docs
// predate that field, so this callable must be run BEFORE the new rules are
// deployed — otherwise legitimate same-company teammate lookups (lead upload,
// lead assignment, team management, SMS number assignment) would be denied until
// each user's next membership write.
//
// Safe to run multiple times. Super-admin only. Rate limited.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("./firebaseAdmin");
const { checkRateLimit } = require("./shared/rateLimiter");

function hasSuperAdminRole(claims = {}) {
    const globalRole = claims.globalRole || claims.roles?.globalRole;
    return globalRole === 'super_admin';
}

/**
 * Build userId -> sorted[companyId] from every membership that has both fields.
 * super_admin memberships (no companyId) contribute nothing, which is correct:
 * a platform admin is not "in" a tenant for the purpose of profile visibility.
 */
async function buildUserCompanyMap() {
    const map = new Map(); // userId -> Set(companyId)
    const snap = await db.collection('memberships').get();
    snap.forEach((doc) => {
        const m = doc.data() || {};
        if (!m.userId || !m.companyId) return;
        if (!map.has(m.userId)) map.set(m.userId, new Set());
        map.get(m.userId).add(m.companyId);
    });
    return map;
}

exports.backfillUserCompanyIds = onCall(
    { cors: true, timeoutSeconds: 300, memory: '512MiB' },
    async (request) => {
        if (!request.auth) throw new HttpsError('unauthenticated', 'Login required.');

        // Super admin only — reads all memberships and writes every user doc.
        const userRecord = await admin.auth().getUser(request.auth.uid);
        const claims = userRecord.customClaims || {};
        if (!hasSuperAdminRole(claims)) {
            throw new HttpsError('permission-denied', 'Super admin access required.');
        }

        const isAllowed = await checkRateLimit(`backfill_user_companyids_${request.auth.uid}`, 5, 3600, 'closed');
        if (!isAllowed) throw new HttpsError('resource-exhausted', 'Too many backfill requests. Please wait.');

        const { dryRun = true } = request.data || {};

        const userCompanyMap = await buildUserCompanyMap();

        let batch = db.batch();
        let pending = 0;
        let usersWritten = 0;

        for (const [userId, companySet] of userCompanyMap.entries()) {
            const companyIds = Array.from(companySet).sort();
            if (!dryRun) {
                batch.set(db.collection('users').doc(userId), { companyIds }, { merge: true });
                pending++;
                usersWritten++;
                if (pending >= 400) {
                    await batch.commit();
                    batch = db.batch();
                    pending = 0;
                }
            } else {
                usersWritten++;
            }
        }
        if (!dryRun && pending > 0) await batch.commit();

        console.log(`[backfillUserCompanyIds] ${dryRun ? 'DRY-RUN' : 'LIVE'} — ${usersWritten} users mapped from memberships.`);
        return {
            success: true,
            dryRun,
            usersProcessed: usersWritten,
            message: `${dryRun ? 'Would set' : 'Set'} companyIds on ${usersWritten} user docs.`,
        };
    }
);
