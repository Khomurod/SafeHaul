export const SUPER_ADMIN_VIEWS = Object.freeze({
  DASHBOARD: 'dashboard',
  ANALYTICS: 'analytics',
  COMPANIES: 'companies',
  USERS: 'users',
  APPLICATIONS: 'applications',
  FEATURES: 'features',
  INTEGRATIONS: 'integrations',
  INTEGRATION_SETUP: 'integration-setup',
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
  { id: SUPER_ADMIN_VIEWS.DASHBOARD, label: 'Dashboard', icon: 'LayoutDashboard', group: 'core' },
  { id: SUPER_ADMIN_VIEWS.ANALYTICS, label: 'Analytics', icon: 'BarChart3', group: 'core' },

  { id: SUPER_ADMIN_VIEWS.COMPANIES, label: 'Companies', icon: 'Building', group: 'data' },
  { id: SUPER_ADMIN_VIEWS.USERS, label: 'Users', icon: 'Users', group: 'data' },
  { id: SUPER_ADMIN_VIEWS.APPLICATIONS, label: 'Unified Driver DB', icon: 'FileText', group: 'data' },

  { id: SUPER_ADMIN_VIEWS.FEATURES, label: 'Global Features', icon: 'Layers', group: 'ops' },
  { id: SUPER_ADMIN_VIEWS.INTEGRATIONS, label: 'SMS Integrations', icon: 'MessageSquare', group: 'ops' },
  // The platform-wide configuration inventory. Deliberately separate from
  // "SMS Integrations", which stays the per-company SMS setup workflow.
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

const PANEL_PATH = '/super-admin';
// Every screen but one company's SMS setup, which is addressed under its list.
const ADDRESSABLE_VIEWS = new Set(Object.values(SUPER_ADMIN_VIEWS)
  .filter((view) => view !== SUPER_ADMIN_VIEWS.INTEGRATION_SETUP));

/**
 * The old addresses of screens merged into another, and the screen each one
 * now opens. A bookmark or a shared link to one still lands where its content
 * went, and the panel rewrites the address to the new one.
 */
const MOVED_VIEWS = new Map([
  ['stats-backfill', SUPER_ADMIN_VIEWS.MAINTENANCE],
]);

/**
 * The panel's screen is in the address, so a reload, Back and a shared link
 * keep it: `/super-admin` is the dashboard, `/super-admin/<view>` any other
 * screen, and `/super-admin/integrations/<companyId>` one company's SMS setup.
 * A merged screen's old address opens the screen that holds it now. Any other
 * address is the dashboard.
 *
 * @param {string} [subPath] what follows `/super-admin/`
 * @returns {{ view: string, companyId: string|null }}
 */
export function superAdminViewFromPath(subPath = '') {
  const [first = '', second = '', ...rest] = String(subPath).split('/').filter(Boolean);
  if (first === SUPER_ADMIN_VIEWS.INTEGRATIONS && second && rest.length === 0) {
    return { view: SUPER_ADMIN_VIEWS.INTEGRATION_SETUP, companyId: second };
  }
  if (ADDRESSABLE_VIEWS.has(first) && !second) return { view: first, companyId: null };
  if (MOVED_VIEWS.has(first) && !second) return { view: MOVED_VIEWS.get(first), companyId: null };
  return { view: SUPER_ADMIN_VIEWS.DASHBOARD, companyId: null };
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
  const [first = '', ...rest] = String(subPath).split('/').filter(Boolean);
  return rest.length === 0 && MOVED_VIEWS.has(first) ? superAdminPathFor(MOVED_VIEWS.get(first)) : null;
}

/** The address of a screen; an SMS setup needs the id of its company. */
export function superAdminPathFor(view, companyId = null) {
  if (view === SUPER_ADMIN_VIEWS.INTEGRATION_SETUP) {
    return `${PANEL_PATH}/${SUPER_ADMIN_VIEWS.INTEGRATIONS}${companyId ? `/${companyId}` : ''}`;
  }
  if (view === SUPER_ADMIN_VIEWS.DASHBOARD || !ADDRESSABLE_VIEWS.has(view)) return PANEL_PATH;
  return `${PANEL_PATH}/${view}`;
}
