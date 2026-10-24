import React, { useId, useState, useEffect, useMemo } from 'react';
import { loadApplications } from '@features/applications/services/applicationService';
import { Icon, X, Search, FileText, Calendar, User } from '@design-system/icons';
import { Badge, Button, DataTable, IconButton, Input } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { EmptyState, ErrorState, Modal } from '@design-system/patterns';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { applicationStatusTone } from '../applicationStatusTone';
import { mockCompanyApplications } from '../companiesMock';

// --- SMART NAME RESOLVER ---
// Checks all possible locations where data might be saved
const getDriverName = (app) => {
  const fname =
      app.firstName ||
      app['first-name'] ||
      app.personalInfo?.firstName ||
      app.personalInfo?.['first-name'] ||
      '';

  const lname =
      app.lastName ||
      app['last-name'] ||
      app.personalInfo?.lastName ||
      app.personalInfo?.['last-name'] ||
      '';

  if (!fname && !lname) return 'Unknown Driver';
  return `${fname} ${lname}`.trim();
};

const getDriverEmail = (app) => app.email || app.personalInfo?.email || 'No Email';

const getDriverPhone = (app) => app.phone || app.personalInfo?.phone || 'No Phone';

const getAppliedDate = (app) => {
  const seconds = app.submittedAt?.seconds || app.createdAt?.seconds;
  return seconds ? new Date(seconds * 1000).toLocaleDateString() : '--';
};

/** One fact per cell; the record id is the row header's quiet second line. */
const APPLICATION_COLUMNS = [
  {
    key: 'driver',
    header: 'Driver Name',
    rowHeader: true,
    width: 'lg',
    render: (app) => (
      <>
        <span className="block font-bold text-ds-content [overflow-wrap:anywhere]">{getDriverName(app)}</span>
        <span className="block font-mono text-ds-xs text-ds-content-muted [overflow-wrap:anywhere]">{app.id}</span>
      </>
    ),
  },
  {
    key: 'email',
    header: 'Email',
    width: 'xl',
    render: (app) => <span className="text-ds-sm [overflow-wrap:anywhere]">{getDriverEmail(app)}</span>,
  },
  {
    key: 'phone',
    header: 'Phone',
    width: 'md',
    render: (app) => <span className="text-ds-sm">{getDriverPhone(app)}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 'md',
    render: (app) => (
      <Badge tone={applicationStatusTone(app.status)}>{app.status || 'New Application'}</Badge>
    ),
  },
  {
    key: 'date',
    header: 'Date',
    align: 'end',
    width: 'md',
    render: (app) => (
      <span className="inline-flex items-center gap-1 text-ds-sm text-ds-content-muted">
        <Icon icon={Calendar} size="xs" />
        {getAppliedDate(app)}
      </span>
    ),
  },
];

/**
 * Read-only list of a company's driver applications, opened from the Super Admin
 * companies table.
 *
 * Presentation only, in the approved accessible `Modal`. Frozen contracts: the
 * `loadApplications(companyId)` call, the multi-shape name/email/phone resolvers,
 * the client-side filter across name/email/status, the `submittedAt` →
 * `createdAt` → `'--'` date precedence, and every frozen string.
 * The `view-apps-modal` id is preserved for existing selectors.
 *
 * Rules this dialog keeps:
 *  - It is the approved `Modal`: dialog role, focus trap, Escape and focus
 *    restoration, and only a click that starts on the backdrop closes it, so a
 *    drag while selecting text in the table cannot lose the view.
 *  - The filter `<input>` has a label, not only a placeholder.
 *  - The icon-only close control has an accessible name.
 *  - Loading, error and empty states are announced (`role="status"` /
 *    `role="alert"`). The error and empty panels are the approved `ErrorState`
 *    and `EmptyState`, which own that announcement, so filtering the list to
 *    nothing is announced too; the brand loader stays, because `LoadingState`'s
 *    spinner is not it.
 *  - **Status is never colour alone.** It is an approved `Badge` whose text
 *    carries the meaning, with the domain→tone mapping owned by this feature.
 *
 *  - The list is an embedded `DataTable` with its own height limit, so its
 *    header stays in view while the rows scroll inside the dialog. Email and
 *    phone are separate columns; the record id stays under the name.
 *
 * Under `?e2eCompanies=mock` (E2E test mode only) it shows made-up records.
 */
export function ViewCompanyAppsModal({ companyId, companyName, onClose }) {
  const [loading, setLoading] = useState(true);
  const [applications, setApplications] = useState([]);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const titleId = useId();
  const searchId = useId();

  useEffect(() => {
    async function fetchApplications() {
      if (!companyId) return;
      setLoading(true);
      setError('');
      if (isE2ETestMode && getE2EQueryParam('e2eCompanies', '') === 'mock') {
        setApplications(mockCompanyApplications(companyId));
        setLoading(false);
        return;
      }
      try {
        const querySnapshot = await loadApplications(companyId);

        if (!querySnapshot || querySnapshot.length === 0) {
          setApplications([]);
        } else {
          setApplications(querySnapshot);
        }
      } catch (err) {
        console.error("Error loading applications:", err);
        setError("Could not load applications. Please check your internet connection or permissions.");
      } finally {
        setLoading(false);
      }
    }
    fetchApplications();
  }, [companyId]);

  // Filter logic
  const filteredApplications = useMemo(() => {
    const searchTerm = search.toLowerCase();
    if (!searchTerm) return applications;

    return applications.filter(app => {
      const name = getDriverName(app).toLowerCase();
      const email = getDriverEmail(app).toLowerCase();
      const status = (app.status || '').toLowerCase();
      return name.includes(searchTerm) || email.includes(searchTerm) || status.includes(searchTerm);
    });
  }, [search, applications]);

  return (
    <Modal
      onClose={onClose}
      labelledBy={titleId}
      size="4xl"
      scroll="body"
    >
      <div id="view-apps-modal" className="flex min-h-0 flex-col">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                <Icon icon={FileText} size="2xl" className="text-ds-content-link" /> Driver Applications
            </h2>
            <p className="text-ds-sm text-ds-content-muted">
              Viewing records for <span className="font-semibold text-ds-content">{companyName}</span>
            </p>
          </div>
          <IconButton data-testid="modal-close" label="Close" variant="ghost" size="sm" onClick={onClose}>
            <Icon icon={X} size="2xl" />
          </IconButton>
        </header>

        {/* Toolbar */}
        <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface p-ds-4">
          <label htmlFor={searchId} className="sr-only">
            Filter applications by driver name, email, or status
          </label>
          <div className="relative">
            <Input
              id={searchId}
              type="search"
              placeholder="Filter by driver name, email, or status..."
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Icon icon={Search} size="lg"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-auto bg-ds-canvas">
          {loading && (
              <div role="status" className="flex h-64 flex-col items-center justify-center text-ds-content-muted">
                  <SafeHaulLoader size="h-8 w-8" className="mb-ds-2" />
                  <p>Loading records...</p>
              </div>
          )}

          {error && (
              <ErrorState
                surface="bare"
                headingLevel={3}
                title="Unable to load applications"
                description={error}
              />
          )}

          {!loading && !error && filteredApplications.length === 0 && (
            <EmptyState
              surface="bare"
              icon={User}
              headingLevel={3}
              title={search ? "No matches found." : "No applications submitted yet."}
            />
          )}

          {!loading && !error && filteredApplications.length > 0 && (
              <DataTable
                embedded
                ariaLabel={`Driver applications for ${companyName}`}
                density="compact"
                minWidth="none"
                maxHeight="md"
                data={filteredApplications}
                columns={APPLICATION_COLUMNS}
                getRowId={(app) => app.id}
              />
          )}
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 justify-end border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
          <Button variant="secondary" onClick={onClose}>
            Close View
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
