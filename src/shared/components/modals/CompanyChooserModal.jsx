import React, { useId, useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { getCompanyProfile } from '@features/companies/services/companyService';
import { Icon, Briefcase, LogOut } from '@design-system/icons';
import { Button, SelectableCard } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@design-system/patterns';
/**
 * Forced company choice for a user with more than one membership. Rendered by
 * `DataContext` and blocks the whole application until a company is picked.
 *
 * Presentation only. Frozen and unchanged: the `currentUserClaims.roles` read
 * with `globalRole` deleted before deriving company ids, the three guard messages
 * (`"Could not find user roles."`, `"User has no company memberships."`,
 * `"Could not load your companies."`), the `getCompanyProfile` reads (side by
 * side, listed in the memberships' order) that silently skip companies they
 * cannot load, the
 * `loginToCompany(company.id, company.role)` call and its argument order, the
 * `handleLogout` call, the `role.replace('_', ' ')` display rule, and every
 * user-facing string. The `choose-company-modal` and `company-choice-list` ids are
 * retained.
 *
 * Rules it keeps:
 *  1. **It is the approved accessible `Modal`**, deliberately **non-dismissable**
 *     (no `onClose`): this is a blocking auth gate over the whole application,
 *     and there is no valid way past it except choosing a company or logging out.
 *  2. **The company list is a scroll region named by the dialog heading.**
 *  3. **Loading and error states are announced**, never silent grey or red text
 *     for a slow connection or a permissions problem.
 *  4. `--ds-*` tokens and approved primitives only, never legacy palette or
 *     arbitrary type. The per-company row stays a `<button>` because it is a real
 *     activation, with the shared focus ring.
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
        const profiles = await Promise.all(companyIds.map((companyId) => getCompanyProfile(companyId)));
        const fetchedData = [];
        companyIds.forEach((companyId, index) => {
          if (profiles[index]) {
            fetchedData.push({
              id: companyId,
              data: profiles[index],
              role: companyRoles[companyId]
            });
          }
        });
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
      size="md"
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
              /* A plain activation: picking a company signs you into it rather
                 than selecting it, so this takes neither `selected` nor
                 `current` and announces as an ordinary button. */
              <SelectableCard
                key={company.id}
                padding="md"
                className="justify-between"
                onSelect={() => loginToCompany(company.id, company.role)}
              >
                <span className="flex min-w-0 items-center gap-ds-3">
                  <span
                    aria-hidden="true"
                    className="flex shrink-0 items-center justify-center rounded-ds-full bg-ds-status-info-bg p-ds-2 text-ds-status-info-fg"
                  >
                    <Icon icon={Briefcase} size="xl" />
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
              </SelectableCard>
            ))}
          </Stack>
        </div>

        <div className="mt-ds-6">
          <Button id="logout-button-modal" variant="secondary" fullWidth onClick={handleLogout}>
            <Icon icon={LogOut} />
            Logout
          </Button>
        </div>
      </div>
    </Modal>
  );
}
