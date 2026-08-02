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
  QUESTIONS: 'questions',
  SYSTEM_HEALTH: 'system-health',
  STATS_BACKFILL: 'stats-backfill',
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
  { id: SUPER_ADMIN_VIEWS.QUESTIONS, label: 'Form Builder', icon: 'FileText', group: 'ops' },
  { id: SUPER_ADMIN_VIEWS.SYSTEM_HEALTH, label: 'System Health', icon: 'Activity', group: 'ops' },
  { id: SUPER_ADMIN_VIEWS.STATS_BACKFILL, label: 'Stats Backfill', icon: 'RefreshCw', group: 'ops' },

  { id: SUPER_ADMIN_VIEWS.CREATE, label: 'Create New', icon: 'Plus', group: 'create' },
]);
