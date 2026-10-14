// src/config/companyStatus.js
//
// ESM mirror of `isCompanyDeactivated` in `functions/shared/companyTenant.js`,
// which loads firebase-functions and so cannot ship to the browser. The
// workspace closes for exactly the companies the server already refuses;
// companyStatus.test.js fails when the two copies differ.

const INACTIVE_STATUSES = ['inactive', 'suspended', 'disabled'];

/** Super Admin → Companies deactivated it (`isActive: false`), or its status says so. */
function isCompanyDeactivated(company) {
  if (!company) return false;
  if (company.isActive === false) return true;
  const st = typeof company.status === 'string' ? company.status.toLowerCase() : '';
  return st !== '' && INACTIVE_STATUSES.includes(st);
}

export { INACTIVE_STATUSES, isCompanyDeactivated };
