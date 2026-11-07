const { HttpsError } = require("firebase-functions/v2/https");
const { assertCompanyActive } = require("./companyAccess");
const { isSuperAdminClaims } = require("./superAdmin");

/**
 * Refuses a callable unless its verified token makes the caller a super admin
 * or the Company Admin of `companyId` (`roles[companyId] === 'company_admin'`).
 * Only the token is read: no membership, no company owner, no legacy `admin` or
 * `owner` role (that wider rule is `assertCompanyAdminStrict`). A deactivated
 * company's admin is refused; a super admin never is, and may name no company.
 *
 * `auth` is a v2 `request.auth`. Returns `{ isSuperAdmin }` for the caller's
 * own super-admin paths.
 */
async function assertCompanyAdminByToken(auth, companyId, deniedMessage = 'Permission denied.') {
    if (!auth) throw new HttpsError('unauthenticated', 'Login required.');
    const isSuperAdmin = isSuperAdminClaims(auth.token);
    if (isSuperAdmin) return { isSuperAdmin };
    if (!companyId || auth.token?.roles?.[companyId] !== 'company_admin') {
        throw new HttpsError('permission-denied', deniedMessage);
    }
    await assertCompanyActive(companyId);
    return { isSuperAdmin };
}

module.exports = { assertCompanyAdminByToken };
