/**
 * Single source of truth for company workspace routes and sidebar navigation.
 * Route registration and menu rendering should read from this manifest to avoid drift.
 */
export const COMPANY_ROUTE_MANIFEST = Object.freeze([
  {
    id: 'dashboard',
    path: 'dashboard',
    screen: 'companyAdminDashboard',
    featureName: 'Company Dashboard',
    requiresCompanyProfile: true,
    nav: { kind: 'item', section: 'top', label: 'Dashboard', icon: 'LayoutDashboard' },
  },
  {
    id: 'applications',
    path: 'drivers/applications',
    screen: 'companyCandidatesListPage',
    featureName: 'Applications',
    props: { scope: 'applications' },
    nav: { kind: 'group-item', group: 'applications', label: 'Applications', icon: 'FileText' },
  },
  {
    id: 'unfinishedApplications',
    path: 'drivers/unfinished',
    screen: 'companyUnfinishedApplications',
    featureName: 'Unfinished Applications',
    // Its own item rather than a tab on Applications, because an unfinished
    // application is not a submitted one: nothing is signed, no consent has been
    // given and no snapshot exists. Mixing them into the ATS funnel would mean
    // statuses, assignment and exports treating a half-typed form as a candidate
    // record the applicant never agreed to file.
    nav: { kind: 'group-item', group: 'applications', label: 'Started (unfinished)', icon: 'Hourglass' },
  },
  {
    id: 'startApplication',
    path: 'drivers/start-application',
    screen: 'startApplicationPage',
    featureName: 'Start an Application',
    // Not `adminOnly`: a recruiter with a driver's paperwork in hand is exactly
    // who starts one of these, and they already reach every other applications
    // screen. Nothing it produces is filed — the driver still completes and signs
    // it — so the bar is company-workspace access, as it is for the dossier.
    nav: { kind: 'group-item', group: 'applications', label: 'Start an application', icon: 'FilePlus' },
  },
  {
    id: 'companyLeads',
    path: 'drivers/leads/company',
    screen: 'companyCandidatesListPage',
    featureName: 'Company Leads',
    props: { scope: 'company_leads' },
    nav: { kind: 'group-item', group: 'applications', label: 'Company Leads', icon: 'Building2' },
  },
  {
    id: 'myLeads',
    path: 'drivers/leads/my',
    screen: 'companyCandidatesListPage',
    featureName: 'My Leads',
    props: { scope: 'my_leads' },
    nav: { kind: 'group-item', group: 'applications', label: 'My Leads', icon: 'User' },
  },
  {
    id: 'campaigns',
    path: 'campaigns',
    screen: 'companyCampaignsPage',
    featureName: 'Campaigns',
    requiresCompanyProfile: true,
    nav: {
      kind: 'item',
      section: 'main',
      label: 'Campaigns',
      icon: 'Megaphone',
      featureFlag: 'campaignsEnabled',
    },
  },
  {
    id: 'eDocs',
    path: 'e-docs',
    screen: 'documentsManager',
    featureName: 'E-Docs',
    nav: { kind: 'item', section: 'main', label: 'E-Docs', icon: 'FileText', featureFlag: 'eDocs' },
  },
  {
    id: 'importLeads',
    path: 'import-leads',
    screen: 'importLeadsPage',
    featureName: 'Import Leads',
    nav: {
      kind: 'item',
      section: 'admin',
      label: 'Import Leads',
      icon: 'Upload',
      adminOnly: true,
      featureFlag: 'importLeads',
    },
  },
  {
    id: 'quickAddLead',
    path: 'quick-add-lead',
    screen: 'quickAddLeadPage',
    featureName: 'Quick Add Lead',
    nav: { kind: 'item', section: 'admin', label: 'Quick Add Leads', icon: 'PlusCircle', adminOnly: true },
  },
  {
    id: 'profile',
    path: 'profile',
    screen: 'userProfilePage',
    featureName: 'Profile',
    nav: { kind: 'item', section: 'account', label: 'Profile', icon: 'User' },
  },
  {
    id: 'settings',
    path: 'settings',
    screen: 'companySettings',
    featureName: 'Company Settings',
    requiresCompanyProfile: true,
    nav: { kind: 'item', section: 'account', label: 'Settings', icon: 'Settings', adminOnly: true },
  },
]);

export const COMPANY_NAV_GROUPS = Object.freeze({
  applications: {
    id: 'applications',
    label: 'Driver Applications & Leads',
    icon: 'Users',
  },
});

export const COMPANY_NAV_LAYOUT = Object.freeze([
  { type: 'route', routeId: 'dashboard' },
  { type: 'group', group: 'applications' },
  { type: 'divider' },
  { type: 'section', section: 'main' },
  { type: 'divider' },
  { type: 'section', section: 'admin' },
  { type: 'divider' },
  { type: 'section', section: 'account' },
]);
