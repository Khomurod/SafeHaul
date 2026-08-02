import React from 'react';
import { COMPANY_ROUTE_MANIFEST } from './companyRouteManifest';
import { LegacyInterestRedirect } from './LegacyInterestRedirect';

const lazyNamed = (loader, exportName) =>
  React.lazy(() => loader().then((module) => ({ default: module[exportName] })));

const lazyDefault = (loader) => React.lazy(loader);

/**
 * Central feature registration for route-mounted screens.
 * Adding new screens should happen here first.
 */
export const featureScreens = Object.freeze({
  superAdminDashboard: lazyNamed(
    () => import('@features/super-admin/components/SuperAdminDashboard'),
    'SuperAdminDashboard',
  ),
  companyAdminDashboard: lazyNamed(
    () => import('@features/company-admin/components/CompanyAdminDashboard'),
    'CompanyAdminDashboard',
  ),
  companyAppShell: lazyNamed(
    () => import('@features/company-admin/layout/CompanyAppShell'),
    'CompanyAppShell',
  ),
  companyCandidatesListPage: lazyNamed(
    () => import('@features/company-admin/views/CompanyCandidatesListPage'),
    'CompanyCandidatesListPage',
  ),
  companyCampaignsPage: lazyNamed(
    () => import('@features/campaigns/pages/CompanyCampaignsPage'),
    'CompanyCampaignsPage',
  ),
  importLeadsPage: lazyNamed(
    () => import('@features/company-admin/views/ImportLeadsPage'),
    'ImportLeadsPage',
  ),
  quickAddLeadPage: lazyNamed(
    () => import('@features/company-admin/views/QuickAddLeadPage'),
    'QuickAddLeadPage',
  ),
  userProfilePage: lazyNamed(
    () => import('@features/company-admin/views/UserProfilePage'),
    'UserProfilePage',
  ),
  companySettings: lazyNamed(
    () => import('@features/settings/components/CompanySettings'),
    'CompanySettings',
  ),
  publicApplyHandler: lazyNamed(
    () => import('@features/driver-app/components/application/PublicApplyHandler'),
    'PublicApplyHandler',
  ),
  // Tiny synchronous redirect — not worth a lazy chunk.
  legacyInterestRedirect: LegacyInterestRedirect,
  signingRoom: lazyDefault(() => import('@features/signing/SigningRoom')),
  verificationPortal: lazyNamed(
    () => import('@features/verification/VerificationPortal'),
    'VerificationPortal',
  ),
  changeReviewPortal: lazyNamed(
    () => import('@features/driver-changes/ReviewChangePortal'),
    'ReviewChangePortal',
  ),
  sandboxApplyHandler: lazyNamed(
    () => import('@features/sandbox/SandboxApplyHandler'),
    'SandboxApplyHandler',
  ),
  sandboxTransferSuccess: lazyNamed(
    () => import('@features/sandbox/SandboxTransferSuccess'),
    'SandboxTransferSuccess',
  ),
  documentsManager: lazyDefault(() => import('@features/company-admin/views/DocumentsManager')),
});

export const companyChildRouteDefs = Object.freeze(
  COMPANY_ROUTE_MANIFEST.map((route) => ({
    id: route.id,
    path: route.path,
    screen: route.screen,
    featureName: route.featureName,
    props: route.props,
    requiresCompanyProfile: route.requiresCompanyProfile,
    // UI-006: mirror the sidebar's adminOnly flag onto the route so the route
    // guard and menu visibility stay in lockstep.
    adminOnly: route.nav?.adminOnly === true,
  })),
);
