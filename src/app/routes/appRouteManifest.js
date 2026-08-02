import {
  COMPANY_WORKSPACE_ROLES,
  SUPER_ADMIN_ROLES,
} from '@app/auth/roles';

/**
 * Route-level manifest for app-level features.
 * Keeps route wiring declarative so new features can be mounted with
 * one entry instead of hand-editing JSX blocks in App.jsx.
 */
export const PUBLIC_FEATURE_ROUTE_MANIFEST = Object.freeze([
  {
    id: 'publicApply',
    path: '/apply/:slug',
    screen: 'publicApplyHandler',
    featureName: 'Driver Application',
  },
  {
    // Compatibility only: old "Are You Interested?" links forward to the
    // public application. See LegacyInterestRedirect.
    id: 'legacyInterestRedirect',
    path: '/interest/:slug',
    screen: 'legacyInterestRedirect',
    featureName: 'Driver Application',
  },
  {
    id: 'signingRoom',
    path: '/sign/:companyId/:requestId',
    screen: 'signingRoom',
    featureName: 'E-Signature Room',
  },
  {
    id: 'verificationPortal',
    path: '/verify/:token',
    screen: 'verificationPortal',
    featureName: 'Verification Portal',
  },
  {
    id: 'changeReviewPortal',
    path: '/review-change/:token',
    screen: 'changeReviewPortal',
    featureName: 'Change Review Portal',
  },
  {
    id: 'sandboxApply',
    path: '/sandbox/apply',
    screen: 'sandboxApplyHandler',
    featureName: 'Sandbox Application',
  },
  {
    id: 'sandboxTransferSuccess',
    path: '/sandbox/transfer-success',
    screen: 'sandboxTransferSuccess',
    featureName: 'Sandbox Transfer',
  },
]);

export const PROTECTED_FEATURE_ROUTE_MANIFEST = Object.freeze([
  {
    id: 'superAdmin',
    path: '/super-admin/*',
    screen: 'superAdminDashboard',
    featureName: 'Super Admin',
    allowedRoles: SUPER_ADMIN_ROLES,
  },
]);

export const COMPANY_WORKSPACE_ROUTE = Object.freeze({
  path: '/company',
  screen: 'companyAppShell',
  featureName: 'Company Workspace',
  allowedRoles: COMPANY_WORKSPACE_ROLES,
  indexRedirect: 'dashboard',
});
