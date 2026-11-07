/**
 * Who may manage a company's SMS settings: the one rule every SMS settings
 * callable asks (owner decision K1) — the provider's config (save, verify), its
 * lines (add, remove, test, verify), who texts from which line, and the test
 * text.
 *
 * It is the shared `assertCompanyAdminStrict`: a Company Admin of the company
 * (`company_admin`, or the older `admin`/`owner` role, in the token or a
 * membership) or its owner (`ownerId`, `createdBy` or `adminId` on the company
 * document), with a deactivated company refused. A super admin passes too, read
 * from the Auth record on every call like every other role, so a removed super
 * admin is refused at once (owner decision K4), never on a token's claims alone.
 * Recruiters, HR users and other companies' admins are refused.
 *
 * Settings itself stays a Company Admin page (`isCompanyAdminForRoute`) and the
 * `integrations` documents stay Company Admin reads in the Firestore rules.
 */
const { assertCompanyAdminStrict } = require('../../../shared/companyAccess');

async function assertSmsSettingsAccess(auth, companyId) {
    await assertCompanyAdminStrict(auth?.uid, companyId);
}

module.exports = { assertSmsSettingsAccess };
