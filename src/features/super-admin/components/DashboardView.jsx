import React from 'react';
import { Building, Users, FileText } from 'lucide-react';
import { MetricCard } from '@/design-system/components';
import { ResponsiveGrid, Stack } from '@/design-system/layouts';

/**
 * Super Admin landing view: the three platform-wide counts.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the three
 * metrics, their order, the `stats.companyCount` / `userCount` / `appCount`
 * fields, and the per-metric `statsError` flags are unchanged, as is the
 * "..." placeholder while loading and the "Error" value on failure.
 *
 * Fixed here:
 *  - Legacy palette (`bg-white`, `text-gray-*`, `bg-blue-100`, `bg-red-100`)
 *    replaced with the approved `MetricCard` and `--ds-*` tokens.
 *  - A failed count was communicated by red colour plus the word "Error", but
 *    nothing announced it, so a screen-reader user scanning the dashboard was
 *    never told a metric had failed. Failed metrics are now summarised in a
 *    live region, so the tone is never the only signal.
 *  - The `animate-pulse` loading treatment was purely visual; loading is now
 *    announced as well.
 *
 * `MetricCard` gained a `danger` tone for this view — see the roadmap note. The
 * `<h1>` lives in the Super Admin masthead (one per page), so this view's title
 * is an `<h2>`.
 */
const METRICS = [
  { key: 'companies', title: 'Total Companies', icon: Building, field: 'companyCount' },
  { key: 'users', title: 'Total Users', icon: Users, field: 'userCount' },
  { key: 'apps', title: 'Total Applications', icon: FileText, field: 'appCount' },
];

export function DashboardView({ stats, statsLoading, statsError }) {
  const failed = METRICS.filter((m) => statsError[m.key]);

  return (
    <Stack gap="lg">
      <h2 className="text-ds-heading-lg font-bold text-ds-content">Dashboard</h2>

      <p role="status" className="sr-only">
        {statsLoading
          ? 'Loading platform totals.'
          : failed.length > 0
            ? `${failed.length} of ${METRICS.length} platform totals failed to load: ${failed.map((m) => m.title).join(', ')}.`
            : 'Platform totals loaded.'}
      </p>

      <ResponsiveGrid minItemWidth="240px">
        {METRICS.map(({ key, title, icon: Icon, field }) => {
          const hasError = Boolean(statsError[key]);
          let value = stats[field];
          if (statsLoading) value = '...';
          if (hasError) value = 'Error';

          return (
            <MetricCard
              key={key}
              label={title}
              value={value}
              tone={hasError ? 'danger' : 'info'}
              icon={<Icon size={24} aria-hidden="true" />}
            />
          );
        })}
      </ResponsiveGrid>
    </Stack>
  );
}
