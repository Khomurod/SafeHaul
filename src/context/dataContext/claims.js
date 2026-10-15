import { isSuperAdminClaims } from '@app/auth/roles';

export function extractRoleContext(claims = {}) {
  const roles = claims.roles || {};
  const companyRoleKeys = Object.keys(roles).filter((key) => key !== 'globalRole');
  const isSuperAdmin = isSuperAdminClaims(claims);
  const hasCompanyRoles = companyRoleKeys.length > 0;

  return {
    roles,
    companyRoleKeys,
    isSuperAdmin,
    hasCompanyRoles,
  };
}

export function getPrimaryCompanyRole(claims = {}) {
  const { roles, companyRoleKeys } = extractRoleContext(claims);
  const firstCompanyKey = companyRoleKeys[0];
  return roles[firstCompanyKey] || 'company_admin';
}
