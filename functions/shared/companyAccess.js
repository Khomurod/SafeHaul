const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");
const { isCompanyDeactivated } = require("./companyTenant");
const { isSuperAdminClaims } = require("./superAdmin");

const COMPANY_TEAM_ROLES = new Set(['company_admin', 'hr_user', 'recruiter', 'admin', 'owner']);

function isCompanyTeamRole(role) {
    return typeof role === 'string' && COMPANY_TEAM_ROLES.has(role);
}

function isPermissionDeniedError(err) {
    if (!err || typeof err.code !== 'string') return false;
    const normalized = err.code.startsWith('functions/')
        ? err.code.slice('functions/'.length)
        : err.code;
    return normalized === 'permission-denied';
}

function refuseIfDeactivated(companyData) {
    if (isCompanyDeactivated(companyData)) {
        throw new HttpsError('permission-denied', 'This company has been deactivated.');
    }
}

async function readCompany(companyId) {
    const snap = await db.collection('companies').doc(companyId).get();
    return snap.exists ? snap.data() : null;
}

/**
 * Refuses a company that Super Admin deactivated. For callables that check the
 * caller's role themselves: call it after that check, except for a super admin.
 */
async function assertCompanyActive(companyId) {
    refuseIfDeactivated(await readCompany(companyId));
}

/**
 * Strict company-access assertion used by callable functions that take `companyId`.
 * Access is granted when the user is:
 *  - super_admin (custom claims), even for a deactivated company
 *  - assigned a role for the company in custom claims
 *  - present in companies/{companyId}/team/{uid}
 *  - owner/creator of the company doc
 * and, but for a super admin, the company is not deactivated.
 */
async function assertCompanyAccess(userId, companyId) {
    if (!userId) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }

    let claims = {};
    try {
        const userRecord = await admin.auth().getUser(userId);
        claims = userRecord.customClaims || {};
    } catch (err) {
        console.warn(`[assertCompanyAccess] Unable to load custom claims for ${userId}: ${err?.message || err}`);
    }
    const roles = claims.roles || {};
    if (isSuperAdminClaims(claims)) return;
    if (isCompanyTeamRole(roles[companyId])) {
        await assertCompanyActive(companyId);
        return;
    }

    const [memberSnap, membershipSnap, companySnap] = await Promise.all([
        db.collection('companies').doc(companyId).collection('team').doc(userId).get(),
        db.collection('memberships')
            .where('userId', '==', userId)
            .where('companyId', '==', companyId)
            .limit(1)
            .get(),
        db.collection('companies').doc(companyId).get(),
    ]);

    const teamRole = memberSnap.exists ? memberSnap.data()?.role : null;
    const membershipRole = !membershipSnap.empty ? membershipSnap.docs[0].data()?.role : null;

    const companyData = companySnap.exists ? companySnap.data() : {};
    const isOwner =
        companyData.ownerId === userId ||
        companyData.createdBy === userId;

    if (isCompanyTeamRole(teamRole) || isCompanyTeamRole(membershipRole) || isOwner) {
        refuseIfDeactivated(companyData);
        return;
    }

    throw new HttpsError('permission-denied', 'You do not have access to this company.');
}

function isAdminRole(role) {
    return role === 'company_admin' || role === 'admin' || role === 'owner';
}

/**
 * Strict admin assertion for sensitive configuration and outbound actions.
 * Unlike general access checks, this does NOT allow generic team membership.
 * A deactivated company is refused, but for a super admin.
 */
async function assertCompanyAdminStrict(userId, companyId) {
    if (!userId) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }
    if (!companyId) {
        throw new HttpsError('invalid-argument', 'companyId is required.');
    }

    let claims = {};
    try {
        const userRecord = await admin.auth().getUser(userId);
        claims = userRecord.customClaims || {};
    } catch (err) {
        console.warn(`[assertCompanyAdminStrict] Unable to load custom claims for ${userId}: ${err?.message || err}`);
    }
    const roles = claims.roles || {};
    if (isSuperAdminClaims(claims)) return;
    if (isAdminRole(roles[companyId])) {
        await assertCompanyActive(companyId);
        return;
    }

    const [membershipSnap, companySnap] = await Promise.all([
        db.collection('memberships')
            .where('userId', '==', userId)
            .where('companyId', '==', companyId)
            .limit(1)
            .get(),
        db.collection('companies').doc(companyId).get(),
    ]);

    const companyData = companySnap.exists ? companySnap.data() : {};
    const membershipRole = !membershipSnap.empty ? membershipSnap.docs[0].data()?.role : null;
    if (isAdminRole(membershipRole)
        || companyData.ownerId === userId || companyData.createdBy === userId || companyData.adminId === userId) {
        refuseIfDeactivated(companyData);
        return;
    }

    throw new HttpsError('permission-denied', 'Company admin access required.');
}

/**
 * Helper wrapper for callable handlers. Converts unexpected auth errors to
 * a safe internal error while preserving explicit permission-denied results.
 */
async function assertCompanyAccessForRequest(request, companyId, logLabel = 'company-access') {
    if (!request?.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Login required.');
    }

    try {
        await assertCompanyAccess(request.auth.uid, companyId);
    } catch (err) {
        if (isPermissionDeniedError(err)) throw err;
        console.warn(`[${logLabel}] Auth check failed:`, err?.message || err);
        throw new HttpsError('internal', 'Unable to verify company access.');
    }
}

module.exports = {
    assertCompanyAccess,
    assertCompanyActive,
    assertCompanyAdminStrict,
    assertCompanyAccessForRequest,
    isPermissionDeniedError,
};
