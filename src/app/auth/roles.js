export const SUPER_ADMIN_ROLES = Object.freeze(['super_admin']);
export const COMPANY_WORKSPACE_ROLES = Object.freeze([
  'company_admin',
  'super_admin',
  'hr_user',
  'recruiter',
]);

export function isCompanyWorkspaceRole(role) {
  return COMPANY_WORKSPACE_ROLES.includes(role);
}

/**
 * UI-006: single source of truth for "is this caller an admin of this company".
 * Used by BOTH the sidebar (to hide adminOnly nav) and the route guard (to block
 * direct-URL access), so menu visibility and route access can never drift apart.
 * Company admin of the selected company, or a global super admin.
 *
 * @param {object|null|undefined} claims - Firebase custom claims (currentUserClaims)
 * @param {string|null|undefined} companyId - the currently selected company id
 * @returns {boolean}
 */
export function isCompanyAdminForRoute(claims, companyId) {
  const roles = claims?.roles || {};
  return roles.globalRole === 'super_admin' || (!!companyId && roles[companyId] === 'company_admin');
}
