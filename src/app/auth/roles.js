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
 * Whether Firebase custom claims make a super admin: `globalRole` at the root
 * (older tokens) or under `roles`, as the Firestore and Storage rules and the
 * server's checks read it.
 *
 * @param {object|null|undefined} claims - Firebase custom claims (currentUserClaims)
 * @returns {boolean}
 */
export function isSuperAdminClaims(claims) {
  return claims?.globalRole === 'super_admin' || claims?.roles?.globalRole === 'super_admin';
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
  return isSuperAdminClaims(claims) || (!!companyId && claims?.roles?.[companyId] === 'company_admin');
}
