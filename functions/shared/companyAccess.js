const { HttpsError } = require("firebase-functions/v2/https");
const { admin, db } = require("../firebaseAdmin");

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

/**
 * Strict company-access assertion used by callable functions that take `companyId`.
 * Access is granted when the user is:
 *  - super_admin (custom claims)
 *  - assigned a role for the company in custom claims
 *  - present in companies/{companyId}/team/{uid}
 *  - owner/creator of the company doc
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
    const globalRole = claims.globalRole || roles.globalRole;
    const isSuperAdmin = globalRole === 'super_admin';

    if (isSuperAdmin || isCompanyTeamRole(roles[companyId])) {
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
    const globalRole = claims.globalRole || roles.globalRole;
    if (globalRole === 'super_admin') return;
    if (isAdminRole(roles[companyId])) return;

    const [membershipSnap, companySnap] = await Promise.all([
        db.collection('memberships')
            .where('userId', '==', userId)
            .where('companyId', '==', companyId)
            .limit(1)
            .get(),
        db.collection('companies').doc(companyId).get(),
    ]);

    if (!membershipSnap.empty) {
        const role = membershipSnap.docs[0].data()?.role;
        if (isAdminRole(role)) return;
    }

    const companyData = companySnap.exists ? companySnap.data() : {};
    if (companyData.ownerId === userId || companyData.createdBy === userId || companyData.adminId === userId) {
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
    assertCompanyAdminStrict,
    assertCompanyAccessForRequest,
    isPermissionDeniedError,
};
