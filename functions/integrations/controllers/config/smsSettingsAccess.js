/**
 * Who may manage a company's SMS settings: the one rule every SMS settings
 * callable asks (owner decision K1) — the provider's config (save, verify), its
 * lines (add, remove, test, verify), who texts from which line, and the test
 * text.
 *
 * It is the shared `assertCompanyAdminStrict`: a Company Admin of the company
 * (`company_admin`, or the older `admin`/`owner` role, in the token or a
 * membership) or its owner (`ownerId`, `createdBy` or `adminId` on the company
 * document), with a deactivated company refused. A super admin by token is let
 * through first, without that read, as these callables always did. Recruiters,
 * HR users and other companies' admins are refused.
 *
 * Settings itself stays a Company Admin page (`isCompanyAdminForRoute`) and the
 * `integrations` documents stay Company Admin reads in the Firestore rules.
 */
const { assertCompanyAdminStrict } = require('../../../shared/companyAccess');
const { isSuperAdminClaims } = require('../../../shared/superAdmin');

async function assertSmsSettingsAccess(auth, companyId) {
    if (isSuperAdminClaims(auth?.token)) return;
    await assertCompanyAdminStrict(auth?.uid, companyId);
}

module.exports = { assertSmsSettingsAccess };
