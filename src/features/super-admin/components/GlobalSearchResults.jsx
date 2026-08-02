import React, { useId } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Building, Users, FileText, Edit2 } from 'lucide-react';
import { Badge, Button, Card } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

/**
 * Global search results across companies, users and driver applications.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the three
 * result groups and their order, the per-group counts, the total count, the
 * `allCompaniesMap.get(app.companyId) || 'Unknown Company'` fallback, the
 * `app.status || 'New Application'` default, the callback shapes
 * (`{ id, name }` to `onViewApps`, bare id to `onEditCompany`, `{ id }` to
 * `onEditUser`, the whole app object to `onAppClick`) and every frozen string
 * are unchanged. The search query itself is owned by `useSuperAdminData`.
 *
 * Defects fixed here:
 *  - **Status was communicated by colour alone.** Each application rendered
 *    `getStatusColor(...)` as a bare pill of legacy palette classes. Status is
 *    now an approved `Badge` whose text carries the meaning, with the
 *    domain→tone mapping owned by this feature (the design system must not know
 *    what "Background Check" means).
 *  - The three groups were bare `<section>`s with no accessible name, so their
 *    headings were not programmatically associated.
 *  - Long company names, emails and slugs could not wrap or truncate, pushing
 *    the action buttons off narrow screens.
 *  - Legacy palette throughout.
 *
 * The page-level `<h1>` lives in the Super Admin masthead, so the results title
 * is an `<h2>` and each group heading an `<h3>`.
 */

/** Domain status → semantic `Badge` tone. Keys are the exact frozen statuses. */
const STATUS_TONES = {
  'Approved': 'success',
  'Rejected': 'danger',
  'Background Check': 'accent',
  'Awaiting Documents': 'warning',
  'Pending Review': 'info',
  'New Application': 'neutral',
};

export function GlobalSearchResults({
  results,
  totalResults,
  allCompaniesMap,
  onViewApps,
  onEditCompany,
  onEditUser,
  onAppClick
}) {
  const { companies, users, applications } = results;
  const companiesId = useId();
  const usersId = useId();
  const appsId = useId();

  return (
    <Stack gap="lg">
      <h2 className="text-ds-heading-lg font-bold text-ds-content">
        Search Results <span className="font-normal text-ds-content-muted">({totalResults} found)</span>
      </h2>

      <section aria-labelledby={companiesId}>
        <h3 id={companiesId} className="mb-ds-4 flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content-secondary">
          <Building size={20} aria-hidden="true" /> Companies ({companies.length})
        </h3>
        <Stack gap="md">
          {companies.length > 0 ? (
            companies.map(company => (
              <Card key={company.id} padding="md" className="flex flex-col gap-ds-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h4 className="truncate text-ds-body-lg font-semibold text-ds-content">{getFieldValue(company.companyName)}</h4>
                  <p className="truncate text-ds-sm text-ds-content-secondary">/{getFieldValue(company.appSlug)}</p>
                </div>
                <div className="flex shrink-0 justify-end gap-ds-2">
                  <Button variant="secondary" size="sm" onClick={() => onViewApps({ id: company.id, name: company.companyName })}>
                    <FileText size={14} aria-hidden="true" /> View Apps
                    <span className="sr-only"> for {getFieldValue(company.companyName)}</span>
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => onEditCompany(company.id)}>
                    <Edit2 size={14} aria-hidden="true" /> Edit
                    <span className="sr-only"> {getFieldValue(company.companyName)}</span>
                  </Button>
                </div>
              </Card>
            ))
          ) : <Card padding="md"><p className="text-ds-content-muted">No companies found.</p></Card>}
        </Stack>
      </section>

      <section aria-labelledby={usersId}>
        <h3 id={usersId} className="mb-ds-4 flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content-secondary">
          <Users size={20} aria-hidden="true" /> Users ({users.length})
        </h3>
        <Stack gap="md">
          {users.length > 0 ? (
            users.map(user => (
              <Card key={user.id} padding="md" className="flex flex-col gap-ds-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h4 className="truncate text-ds-body-lg font-semibold text-ds-content">{getFieldValue(user.name)}</h4>
                  <p className="truncate text-ds-sm text-ds-content-secondary">{getFieldValue(user.email)}</p>
                </div>
                <div className="flex shrink-0 justify-end gap-ds-2">
                  <Button variant="secondary" size="sm" onClick={() => onEditUser({ id: user.id })}>
                    <Edit2 size={14} aria-hidden="true" /> Edit
                    <span className="sr-only"> {getFieldValue(user.name)}</span>
                  </Button>
                </div>
              </Card>
            ))
          ) : <Card padding="md"><p className="text-ds-content-muted">No users found.</p></Card>}
        </Stack>
      </section>

      <section aria-labelledby={appsId}>
        <h3 id={appsId} className="mb-ds-4 flex items-center gap-ds-2 text-ds-heading-sm font-semibold text-ds-content-secondary">
          <FileText size={20} aria-hidden="true" /> Driver Applications ({applications.length})
        </h3>
        <Stack gap="md">
          {applications.length > 0 ? (
            applications.map(app => {
              const status = app.status || 'New Application';
              return (
                <Card
                  key={app.id}
                  as="button"
                  type="button"
                  padding="md"
                  className="flex w-full flex-col gap-ds-3 text-left transition-all hover:border-ds-action-primary hover:shadow-ds-md focus-visible:outline-none focus-visible:shadow-ds-focus sm:flex-row sm:items-center sm:justify-between"
                  onClick={() => onAppClick(app)}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-ds-body-lg font-semibold text-ds-content">
                      {`${getFieldValue(app['firstName'])} ${getFieldValue(app['lastName'])}`}
                    </span>
                    <span className="block truncate text-ds-sm text-ds-content-secondary">{getFieldValue(app.email)}</span>
                    <span className="mt-1 block truncate text-ds-sm text-ds-content-muted">
                      From: <span className="font-medium text-ds-content-secondary">{allCompaniesMap.get(app.companyId) || 'Unknown Company'}</span>
                    </span>
                  </span>
                  <span className="shrink-0">
                    <Badge tone={STATUS_TONES[status] || 'neutral'}>{status}</Badge>
                  </span>
                </Card>
              );
            })
          ) : <Card padding="md"><p className="text-ds-content-muted">No driver applications found.</p></Card>}
        </Stack>
      </section>
    </Stack>
  );
}
