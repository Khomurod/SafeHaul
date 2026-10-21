export const SUPER_ADMIN_VIEWS = Object.freeze({
  DASHBOARD: 'dashboard',
  COMPANIES: 'companies',
  // One company's screen, addressed under the list: its features and its SMS.
  COMPANY: 'company',
  // Every company's features in one view-only table.
  FEATURES: 'features',
  USERS: 'users',
  APPLICATIONS: 'applications',
  ENVIRONMENT: 'environment-integrations',
  AI_INTEGRATIONS: 'ai-integrations',
  BLOG_POSTS: 'blog-posts',
  WEBSITE_LEADS: 'website-leads',
  SYSTEM_HEALTH: 'system-health',
  MAINTENANCE: 'maintenance',
  RELEASES: 'releases',
  CREATE: 'create',
});

export const SUPER_ADMIN_NAV_ITEMS = Object.freeze([
  // The platform totals and, below them, the calls logged in a chosen period.
  // Its activity was the Analytics screen; that address still opens it.
  { id: SUPER_ADMIN_VIEWS.DASHBOARD, label: 'Dashboard', icon: 'LayoutDashboard', group: 'core' },

  // A company opens its own screen, with its features and its SMS setup. The
  // old SMS Integrations address still opens the list, and an SMS setup's
  // address the company's SMS tab.
  { id: SUPER_ADMIN_VIEWS.COMPANIES, label: 'Companies', icon: 'Building', group: 'data' },
  // Which company has which feature, at a glance. View only: a row opens that
  // company's Features tab, where they are switched.
  { id: SUPER_ADMIN_VIEWS.FEATURES, label: 'Features', icon: 'Zap', group: 'data' },
  { id: SUPER_ADMIN_VIEWS.USERS, label: 'Users', icon: 'Users', group: 'data' },
  { id: SUPER_ADMIN_VIEWS.APPLICATIONS, label: 'Unified Driver DB', icon: 'FileText', group: 'data' },

  // The platform-wide configuration inventory. Deliberately separate from a
  // company's SMS tab, which stays the per-company SMS setup workflow.
  { id: SUPER_ADMIN_VIEWS.ENVIRONMENT, label: 'Environment & Integrations', icon: 'KeyRound', group: 'ops' },
  // The shared AI platform's own console. Separate from "Environment &
  // Integrations", which inventories AI credentials read-only and points here
  // for reveal, replace and delete.
  { id: SUPER_ADMIN_VIEWS.AI_INTEGRATIONS, label: 'AI Integrations', icon: 'Sparkles', group: 'ops' },
  // Titles and Delete for the automatically published News & Insights blog.
  { id: SUPER_ADMIN_VIEWS.BLOG_POSTS, label: 'Blog Posts', icon: 'Newspaper', group: 'ops' },
  // Read-only archive of leads captured by the retired marketing site. It keeps a
  // navigation entry on purpose: it is the only path to that data, and a screen
  // nobody can find reads like data that was deleted.
  { id: SUPER_ADMIN_VIEWS.WEBSITE_LEADS, label: 'Website Leads', icon: 'Inbox', group: 'ops' },
  { id: SUPER_ADMIN_VIEWS.SYSTEM_HEALTH, label: 'System Health', icon: 'Activity', group: 'ops' },
  // The one deliberate step between "merged and running on Testing" and "what
  // every end user is served". A merge to main never reaches Production on its
  // own; it reaches it from here.
  { id: SUPER_ADMIN_VIEWS.RELEASES, label: 'Releases', icon: 'Rocket', group: 'ops' },
  // Every platform-wide repair and backfill in one place, each one that writes
  // behind a confirmation. Its old address, `stats-backfill`, still opens it.
  { id: SUPER_ADMIN_VIEWS.MAINTENANCE, label: 'Maintenance', icon: 'Wrench', group: 'ops' },

  { id: SUPER_ADMIN_VIEWS.CREATE, label: 'Create New', icon: 'Plus', group: 'create' },
]);

/** A company's screen, a tab per thing set for it; it opens on the first. */
export const COMPANY_TABS = Object.freeze(['features', 'sms']);

const PANEL_PATH = '/super-admin';
// Every screen but one company's, which is addressed under the list.
const ADDRESSABLE_VIEWS = new Set(Object.values(SUPER_ADMIN_VIEWS)
  .filter((view) => view !== SUPER_ADMIN_VIEWS.COMPANY));

/**
 * The old addresses of screens merged into another, and the screen each one
 * now opens. A bookmark or a shared link to one still lands where its content
 * went, and the panel rewrites the address to the new one.
 */
const MOVED_VIEWS = new Map([
  ['analytics', SUPER_ADMIN_VIEWS.DASHBOARD],
  ['stats-backfill', SUPER_ADMIN_VIEWS.MAINTENANCE],
  ['integrations', SUPER_ADMIN_VIEWS.COMPANIES],
]);
// One company's SMS setup was `integrations/<id>`; it is that company's SMS tab.
const MOVED_SMS_SETUP = 'integrations';

/**
 * The panel's screen is in the address, so a reload, Back and a shared link
 * keep it: `/super-admin` is the dashboard, `/super-admin/<view>` any other
 * screen, and `/super-admin/companies/<companyId>[/<tab>]` one company's, on
 * its first tab unless the address names another. A merged screen's old
 * address opens the screen that holds it now. Any other address is the
 * dashboard.
 *
 * @param {string} [subPath] what follows `/super-admin/`
 * @returns {{ view: string, companyId: string|null, tab: string|null }}
 */
export function superAdminViewFromPath(subPath = '') {
  const [first = '', second = '', third = '', ...rest] = String(subPath).split('/').filter(Boolean);
  const screen = (view, companyId = null, tab = null) => ({ view, companyId, tab });
  if (first === SUPER_ADMIN_VIEWS.COMPANIES && second && rest.length === 0 && (!third || COMPANY_TABS.includes(third))) {
    return screen(SUPER_ADMIN_VIEWS.COMPANY, second, third || COMPANY_TABS[0]);
  }
  if (first === MOVED_SMS_SETUP && second && !third) return screen(SUPER_ADMIN_VIEWS.COMPANY, second, 'sms');
  if (ADDRESSABLE_VIEWS.has(first) && !second) return screen(first);
  if (MOVED_VIEWS.has(first) && !second) return screen(MOVED_VIEWS.get(first));
  return screen(SUPER_ADMIN_VIEWS.DASHBOARD);
}

/**
 * Where a merged screen's old address points now, or `null` for any other
 * address. The panel replaces the old address with this one, so Back does not
 * return to it.
 *
 * @param {string} [subPath] what follows `/super-admin/`
 * @returns {string|null}
 */
export function superAdminMovedPath(subPath = '') {
  const [first = '', second = '', ...rest] = String(subPath).split('/').filter(Boolean);
  if (rest.length > 0) return null;
  if (first === MOVED_SMS_SETUP && second) return superAdminPathFor(SUPER_ADMIN_VIEWS.COMPANY, second, 'sms');
  return !second && MOVED_VIEWS.has(first) ? superAdminPathFor(MOVED_VIEWS.get(first)) : null;
}

/** The address of a screen; a company's needs its id, and names any tab but the first. */
export function superAdminPathFor(view, companyId = null, tab = null) {
  if (view === SUPER_ADMIN_VIEWS.COMPANY) {
    if (!companyId) return `${PANEL_PATH}/${SUPER_ADMIN_VIEWS.COMPANIES}`;
    const tabPath = COMPANY_TABS.includes(tab) && tab !== COMPANY_TABS[0] ? `/${tab}` : '';
    return `${PANEL_PATH}/${SUPER_ADMIN_VIEWS.COMPANIES}/${companyId}${tabPath}`;
  }
  if (view === SUPER_ADMIN_VIEWS.DASHBOARD || !ADDRESSABLE_VIEWS.has(view)) return PANEL_PATH;
  return `${PANEL_PATH}/${view}`;
}
