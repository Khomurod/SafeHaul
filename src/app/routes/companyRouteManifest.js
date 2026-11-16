/**
 * Single source of truth for company workspace routes and sidebar navigation.
 * Route registration and menu rendering should read from this manifest to avoid drift.
 *
 * Who may open a page belongs to the page, not to its menu item: `adminOnly`
 * (the route guard, `CompanyAdminRoute`, refuses everyone but a company admin)
 * and `featureFlag` (the company feature the page needs) sit on the entry
 * itself, so a page with no `nav`, or whose item is removed, keeps them. The
 * sidebar, and any page that links to another page as a button, offer a page
 * only when these allow it (`canOfferCompanyRoute`).
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
    // record the applicant never agreed to file. That separation is a rule.
    //
    // ONE destination for unfinished work: there is no second `Start an
    // application` item, so a carrier-prepared draft appears in one place and a
    // recruiter never has to know which page answers which question about the
    // same application. Starting one is the primary action inside this
    // workspace. Not `adminOnly`: a recruiter with a driver's
    // paperwork in hand is exactly who starts one, and nothing it produces is
    // filed — the driver still completes and signs it — so the bar is
    // company-workspace access, as it is for the dossier.
    nav: { kind: 'group-item', group: 'applications', label: 'Unfinished applications', icon: 'Hourglass' },
  },
  {
    // Kept as a route and deliberately given NO `nav`, so the sidebar offers one
    // destination while the old URL still works for a bookmark or an internal
    // link. `CompanySidebar` builds its menu by filtering on `nav.kind`, so an
    // entry without one contributes no item. See `StartApplicationRedirect`.
    id: 'startApplication',
    path: 'drivers/start-application',
    screen: 'startApplicationRedirect',
    featureName: 'Start an Application',
  },
  {
    // The menu's one Leads item. Its address has no screen: it opens the tab a
    // person starts on, All for a company admin and Assigned to me for anyone
    // else (`LeadsRedirect`). Every tab's address sits under this one, so the
    // menu reads the item as current on each of them. It picks by the person's
    // role in the company they work in, so it waits for that company.
    id: 'leads',
    path: 'drivers/leads',
    screen: 'leadsRedirect',
    featureName: 'Leads',
    requiresCompanyProfile: true,
    // Add lead and Import leads open from the Leads page's header and lead back
    // to it, so the menu shows Leads as where you are on them too (C2).
    nav: {
      kind: 'group-item', group: 'applications', label: 'Leads', icon: 'Building2',
      alsoCurrentOn: ['quick-add-lead', 'import-leads'],
    },
  },
  {
    // The Leads tabs (`LeadListTabs`): one route each and no menu item. All and
    // Assigned to me keep the old Company Leads and My Leads addresses, so a
    // bookmark or a dashboard tile still opens its list.
    id: 'companyLeads',
    path: 'drivers/leads/company',
    screen: 'companyCandidatesListPage',
    featureName: 'Leads',
    props: { scope: 'company_leads' },
  },
  {
    id: 'myLeads',
    path: 'drivers/leads/my',
    screen: 'companyCandidatesListPage',
    featureName: 'Leads',
    props: { scope: 'my_leads' },
  },
  {
    id: 'unassignedLeads',
    path: 'drivers/leads/unassigned',
    screen: 'companyCandidatesListPage',
    featureName: 'Leads',
    props: { scope: 'unassigned_leads' },
  },
  {
    id: 'referralLinks',
    path: 'referral-links',
    screen: 'referralLinksPage',
    featureName: 'Referral Links',
    // Any staff member makes links; what each comes in through is assigned to
    // its creator. A Company Admin sees every link, anyone else their own.
    nav: { kind: 'group-item', group: 'applications', label: 'Referral Links', icon: 'Share2' },
  },
  {
    id: 'campaigns',
    path: 'campaigns',
    screen: 'companyCampaignsPage',
    featureName: 'Campaigns',
    requiresCompanyProfile: true,
    featureFlag: 'campaignsEnabled',
    nav: { kind: 'item', section: 'main', label: 'Campaigns', icon: 'Megaphone' },
  },
  {
    id: 'eDocs',
    path: 'e-docs',
    screen: 'documentsManager',
    featureName: 'E-Docs',
    featureFlag: 'eDocs',
    nav: { kind: 'item', section: 'main', label: 'E-Docs', icon: 'FileText' },
  },
  {
    // No `nav`: the Leads page's header offers it (`LeadsHeaderActions`), to a
    // company admin of a company with the feature on, and the URL still works.
    id: 'importLeads',
    path: 'import-leads',
    screen: 'importLeadsPage',
    featureName: 'Import Leads',
    adminOnly: true,
    featureFlag: 'importLeads',
  },
  {
    // No `nav`: the Leads page's header offers it to every staff member. Not
    // `adminOnly`: a recruiter's lead is assigned to them (`QuickAddLeadPage`).
    id: 'quickAddLead',
    path: 'quick-add-lead',
    screen: 'quickAddLeadPage',
    featureName: 'Add Lead',
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
    adminOnly: true,
    nav: { kind: 'item', section: 'account', label: 'Settings', icon: 'Settings' },
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
  { type: 'section', section: 'account' },
]);
