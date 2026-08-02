export function extractRoleContext(claims = {}) {
  const roles = claims.roles || {};
  const companyRoleKeys = Object.keys(roles).filter((key) => key !== 'globalRole');
  const isSuperAdmin = claims.globalRole === 'super_admin' || roles.globalRole === 'super_admin';
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
