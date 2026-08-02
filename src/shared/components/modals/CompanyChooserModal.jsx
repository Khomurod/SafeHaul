import React, { useId, useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { getCompanyProfile } from '@features/companies';
import { Briefcase, LogOut } from 'lucide-react';
import { Button } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from './Modal';

/**
 * Forced company choice for a user with more than one membership. Rendered by
 * `DataContext` and blocks the whole application until a company is picked.
 *
 * Migrated to the design system 2026-07-28; it was a hand-built overlay found by
 * the repository-wide dialog scan.
 *
 * Presentation only. Frozen and unchanged: the `currentUserClaims.roles` read
 * with `globalRole` deleted before deriving company ids, the three guard messages
 * (`"Could not find user roles."`, `"User has no company memberships."`,
 * `"Could not load your companies."`), the sequential `getCompanyProfile` fetch
 * that silently skips companies it cannot load, the
 * `loginToCompany(company.id, company.role)` call and its argument order, the
 * `handleLogout` call, the `role.replace('_', ' ')` display rule, and every
 * user-facing string. The `choose-company-modal` and `company-choice-list` ids are
 * retained.
 *
 * Defects fixed:
 *  1. **The overlay was a hand-built `fixed inset-0` div** with no
 *     `role="dialog"`, no `aria-modal`, no focus move on open and no focus trap.
 *     This is a blocking auth gate over the whole application, so a keyboard user
 *     landed on the page body with the dialog visually covering everything. It now
 *     uses the shared accessible `Modal`, deliberately **non-dismissable** (no
 *     `onClose`): there is no valid way past this gate except choosing a company
 *     or logging out, which is the behaviour it always had.
 *  2. **The company list was an unnamed scroll region** (`max-h-60
 *     overflow-y-auto`); it is now named by the dialog heading.
 *  3. **Loading and error states were not announced** — a user with a slow
 *     connection or a permissions problem got silent grey or red text.
 *  4. Legacy palette throughout — `bg-gray-900 bg-opacity-75` backdrop,
 *     `bg-gray-50`/`hover:border-blue-500`/`focus:ring-blue-500` rows,
 *     `bg-blue-100 text-blue-600` avatar, `text-red-600` error and `text-2xl` /
 *     `text-lg` arbitrary type — replaced with `--ds-*` tokens and approved
 *     primitives. The per-company row stays a `<button>` because it is a real
 *     activation, and it now uses the shared focus ring.
 */
export function CompanyChooserModal() {
  const [loading, setLoading] = useState(true);
  const [companyDataList, setCompanyDataList] = useState([]);
  const [error, setError] = useState('');
  const titleId = useId();
  const descriptionId = useId();

  const { currentUserClaims, loginToCompany, handleLogout } = useData();

  useEffect(() => {
    async function fetchCompanyData() {
      if (!currentUserClaims || !currentUserClaims.roles) {
        setError("Could not find user roles.");
        setLoading(false);
        return;
      }

      const companyRoles = { ...currentUserClaims.roles };
      delete companyRoles.globalRole;
      const companyIds = Object.keys(companyRoles);

      if (companyIds.length === 0) {
        setError("User has no company memberships.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');
      try {
        const fetchedData = [];
        for (const companyId of companyIds) {
          const companyData = await getCompanyProfile(companyId);
          if (companyData) {
            fetchedData.push({
              id: companyId,
              data: companyData,
              role: companyRoles[companyId]
            });
          }
        }
        setCompanyDataList(fetchedData);
      } catch (err) {
        console.error("Error populating company chooser:", err);
        setError("Could not load your companies.");
      } finally {
        setLoading(false);
      }
    }

    fetchCompanyData();
  }, [currentUserClaims]);

  return (
    <Modal
      // Deliberately non-dismissable: this is a blocking auth gate. The only ways
      // out are choosing a company or logging out, exactly as before.
      labelledBy={titleId}
      describedBy={descriptionId}
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-ds-overlay p-4 backdrop-blur-sm"
      className="w-full max-w-md overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
    >
      <div id="choose-company-modal" className="p-ds-8">
        <h2 id={titleId} className="mb-ds-2 text-center text-ds-heading-xl font-bold text-ds-content">
          Choose Company
        </h2>
        <p id={descriptionId} className="mb-ds-6 text-center text-ds-content-secondary">
          You have access to multiple companies. Please pick one to continue.
        </p>

        <div
          id="company-choice-list"
          role="region"
          aria-labelledby={titleId}
          tabIndex={0}
          className="max-h-60 overflow-y-auto pr-ds-2 focus-visible:outline-none focus-visible:shadow-ds-focus"
        >
          <Stack gap="sm">
            {loading && (
              <p role="status" className="text-center text-ds-content-secondary">Loading companies...</p>
            )}
            <div role="alert">
              {error && <p className="text-center text-ds-status-danger-fg">{error}</p>}
            </div>

            {!loading && !error && companyDataList.map(company => (
              <button
                key={company.id}
                type="button"
                className="flex w-full items-center justify-between rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 text-left transition-all hover:border-ds-focus hover:bg-ds-surface focus-visible:outline-none focus-visible:shadow-ds-focus"
                onClick={() => loginToCompany(company.id, company.role)}
              >
                <span className="flex min-w-0 items-center gap-ds-3">
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center justify-center rounded-full bg-ds-status-info-bg p-ds-2 text-ds-status-info-fg"
                  >
                    <Briefcase size={20} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-ds-heading-sm font-semibold text-ds-content">
                      {company.data.companyName}
                    </span>
                    <span className="block text-ds-sm capitalize text-ds-content-secondary">
                      Your role: {company.role.replace('_', ' ')}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-ds-sm font-semibold text-ds-content-link">
                  Select &rarr;
                </span>
              </button>
            ))}
          </Stack>
        </div>

        <div className="mt-ds-6">
          <Button id="logout-button-modal" variant="secondary" fullWidth onClick={handleLogout}>
            <LogOut size={16} aria-hidden="true" />
            Logout
          </Button>
        </div>
      </div>
    </Modal>
  );
}
