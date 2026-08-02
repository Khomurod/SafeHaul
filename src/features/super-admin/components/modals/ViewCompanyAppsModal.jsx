import React, { useId, useState, useEffect, useMemo } from 'react';
import { loadApplications } from '@features/applications/services/applicationService';
import { X, Search, FileText, Calendar, User, AlertCircle } from 'lucide-react';
import { Badge, Button, IconButton, Input, StatusMedallion } from '@/design-system/components';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Read-only list of a company's driver applications, opened from the Super Admin
 * companies table.
 *
 * Migrated to the shared accessible `Modal` 2026-07-28. Presentation only — the
 * `loadApplications(companyId)` call, the multi-shape name/email/phone resolvers,
 * the client-side filter across name/email/status, the `submittedAt` →
 * `createdAt` → `'--'` date precedence, and every frozen string are unchanged.
 * The `view-apps-modal` id is preserved for existing selectors.
 *
 * Fixed here:
 *  - Hand-built overlay replaced by the shared `Modal`. The old one closed on any
 *    click on the backdrop *and* relied on `stopPropagation` inside the panel —
 *    which meant a click that started inside the panel and ended on the backdrop
 *    (a drag while selecting text in the table) closed the dialog and lost the
 *    view. It also had no dialog role, focus trap, Escape or focus restoration.
 *  - The filter `<input>` had no label, only a placeholder.
 *  - The unnamed icon-only close control.
 *  - Loading and error states were not announced (`role="status"` / `role="alert"`
 *    now).
 *  - **Status was communicated by colour alone.** The old markup passed the
 *    status through `getStatusColor(...).replace('bg-', ...).replace('text-', ...)`,
 *    a brittle string rewrite that produced a colour-only pill built from legacy
 *    palette classes. Status is now an approved `Badge` whose text carries the
 *    meaning, with the domain→tone mapping owned by this feature.
 *
 * `DataTable` is deliberately not used: this is a display-only table nested
 * inside a dialog with its own scroll container and sticky header, and the
 * approved `DataTable` contract has not yet been proven inside a dialog. Recorded
 * in the roadmap's raw-table inventory rather than forcing the reuse.
 */
/**
 * Domain status → semantic `Badge` tone.
 *
 * This mapping is feature-owned on purpose: the design system must not know what
 * "Background Check" means, and the feature must not invent colours. It replaces
 * `getStatusColor`, which returned legacy palette classes (`bg-green-100`,
 * `text-red-800`, ...) — arbitrary colours that have no business inside a
 * surface declared migrated. The keys are the exact frozen status strings.
 */
const STATUS_TONES = {
  'Approved': 'success',
  'Rejected': 'danger',
  'Background Check': 'accent',
  'Awaiting Documents': 'warning',
  'Pending Review': 'info',
  'New Application': 'neutral',
};

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

  const getDriverEmail = (app) => {
      return app.email || app.personalInfo?.email || 'No Email';
  };

  const getDriverPhone = (app) => {
      return app.phone || app.personalInfo?.phone || 'No Phone';
  };

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
      overlayClassName="fixed inset-0 z-[60] flex items-center justify-center bg-ds-overlay p-ds-4 backdrop-blur-sm"
      className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div id="view-apps-modal" className="flex min-h-0 flex-col">
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
          <div className="min-w-0">
            <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                <FileText className="text-ds-content-link" aria-hidden="true" /> Driver Applications
            </h2>
            <p className="text-ds-sm text-ds-content-muted">
              Viewing records for <span className="font-semibold text-ds-content">{companyName}</span>
            </p>
          </div>
          <IconButton data-testid="modal-close" label="Close" variant="ghost" size="sm" onClick={onClose}>
            <X size={24} aria-hidden="true" />
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
            <Search
              size={18}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted"
            />
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
              <div role="alert" className="flex h-64 flex-col items-center justify-center px-ds-6 text-center text-ds-status-danger-fg">
                  <StatusMedallion tone="danger" className="mb-ds-2"><AlertCircle /></StatusMedallion>
                  <p>{error}</p>
              </div>
          )}

          {!loading && !error && filteredApplications.length === 0 && (
            <div className="flex h-64 flex-col items-center justify-center text-ds-content-muted">
                <User size={48} aria-hidden="true" className="mb-ds-2 opacity-20" />
                <p>{search ? "No matches found." : "No applications submitted yet."}</p>
            </div>
          )}

          {!loading && !error && filteredApplications.length > 0 && (
              <table className="w-full border-collapse text-left">
                  <caption className="sr-only">
                    Driver applications for {companyName}
                  </caption>
                  <thead className="sticky top-0 z-10 bg-ds-surface-subtle text-ds-xs font-bold uppercase text-ds-content-secondary shadow-ds-xs">
                      <tr>
                          <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3">Driver Name</th>
                          <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3">Contact</th>
                          <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-center">Status</th>
                          <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-right">Date</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-ds-border-subtle bg-ds-surface">
                      {filteredApplications.map(app => (
                        <tr key={app.id} className="transition-colors hover:bg-ds-surface-subtle">
                            <td className="px-ds-6 py-ds-4">
                                <span className="block font-bold text-ds-content">
                                    {getDriverName(app)}
                                </span>
                                <span className="font-mono text-ds-xs text-ds-content-muted">{app.id}</span>
                            </td>
                            <td className="px-ds-6 py-ds-4 text-ds-sm text-ds-content-secondary">
                                <div>{getDriverEmail(app)}</div>
                                <div className="text-ds-xs text-ds-content-muted">{getDriverPhone(app)}</div>
                            </td>
                            <td className="px-ds-6 py-ds-4 text-center">
                                <Badge tone={STATUS_TONES[app.status] || 'neutral'}>
                                    {app.status || 'New Application'}
                                </Badge>
                            </td>
                            <td className="px-ds-6 py-ds-4 text-right text-ds-sm text-ds-content-muted">
                                <div className="flex items-center justify-end gap-1">
                                    <Calendar size={12} aria-hidden="true" />
                                    {app.submittedAt?.seconds
                                        ? new Date(app.submittedAt.seconds * 1000).toLocaleDateString()
                                        : (app.createdAt?.seconds
                                            ? new Date(app.createdAt.seconds * 1000).toLocaleDateString()
                                            : '--')}
                                </div>
                            </td>
                        </tr>
                    ))}
                  </tbody>
              </table>
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
