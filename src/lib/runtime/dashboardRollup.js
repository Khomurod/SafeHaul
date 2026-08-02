/**
 * When not exactly `'false'`, the client may read KPI tiles from
 * `companies/{companyId}/internal_stats/dashboard` when present (see useCompanyDashboard).
 * Set `VITE_USE_DASHBOARD_SUMMARY=false` to force legacy aggregate queries only.
 */
export function shouldPreferDashboardRollup() {
  return import.meta.env.VITE_USE_DASHBOARD_SUMMARY !== 'false';
}
