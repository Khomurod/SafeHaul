import React, { useState, useMemo, useEffect, useId } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Building, FileText, Edit2, Trash2, Search, ChevronLeft, ChevronRight, Crown, Shield, MessageSquare, Phone, Database, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { db } from '@lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { SafeHaulLoader } from '@shared/components/SafeHaulLoader';
import { Badge, Button, Card, IconButton, Input, Select } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

/**
 * Super Admin companies table. Also serves the SMS Integrations hub via
 * `isIntegrationMode`, where the row action selects a company for integration
 * setup instead of opening the editor.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the
 * `companies/{id}/integrations/sms_provider` enrichment read, the
 * `updateDoc(companies/{id}, { isActive })` toggle, the name/slug/id search, the
 * client-side 20/50/100 pagination, the `loadMore('companies')` database
 * pagination, and every frozen string are unchanged.
 *
 * `DataTable` is deliberately not used, matching the exception already recorded
 * for `CampaignResultsTable`, `AssignmentTable` and `ViewCompanyAppsModal`: this
 * table carries per-row interactive controls (a status toggle and three actions)
 * plus a row-level click target, which is outside `DataTable`'s proven
 * display-table contract. The approved native-table pattern is used instead —
 * semantic markup, `--ds-*` tokens, `Badge`, `Button`/`IconButton`.
 *
 * Defects fixed here:
 *  1. **Stale derived data.** `filteredCompanyList`'s `useMemo` read `displayList`
 *     (companies merged with their SMS enrichment) but listed only
 *     `[companySearch, companyList]` as dependencies. When the async enrichment
 *     resolved, `displayList` changed but the filtered list did not recompute, so
 *     in Integrations mode the SMS numbers stayed blank until an unrelated
 *     re-render. Now depends on `displayList`.
 *  2. **Action clicks also triggered the row.** The row's `onClick` opened the
 *     editor, and the per-row action buttons did not stop propagation, so
 *     "View Applications" or "Delete" *also* opened the edit modal — two dialogs
 *     stacked at once. Only the status toggle had guarded against it.
 *  3. **The table was unusable by keyboard.** Opening a company was a click
 *     handler on `<tr>` with no role, no `tabIndex` and no key handling, so
 *     keyboard users could not open one at all. The company name is now a real
 *     button; the row click is preserved for pointer users.
 *  4. **Blocking `window.confirm` + `alert()`** on activate/deactivate, replaced
 *     with an accessible confirmation dialog and an announced error. The
 *     confirmation wording is preserved verbatim.
 *  5. Icon-only actions carried only a `title`, so they had no accessible name.
 *  6. `text-[10px]` provider label (below the 12px floor) removed.
 *  7. Legacy palette throughout.
 */
export function CompaniesView({
    listLoading,
    statsError,
    companyList,
    onViewApps,
    onEdit,
    onDelete,
    loadMore,
    isLoadingMore = false,
    hasMore,
    isIntegrationMode = false
}) {
    const [companySearch, setCompanySearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [enrichedCompanies, setEnrichedCompanies] = useState({}); // ID -> { defaultPhoneNumber, smsProvider }
    const [togglingCompany, setTogglingCompany] = useState(null);
    const [pendingToggle, setPendingToggle] = useState(null);
    const [toggleError, setToggleError] = useState('');
    const searchId = useId();
    const perPageId = useId();

    // Toggle company active status
    const runToggleCompanyActive = async ({ companyId, action, currentStatus }) => {
        setPendingToggle(null);
        setTogglingCompany(companyId);
        setToggleError('');
        try {
            await updateDoc(doc(db, 'companies', companyId), {
                isActive: !currentStatus
            });
            // Update local state to reflect change
            setEnrichedCompanies(prev => ({
                ...prev,
                [companyId]: { ...prev[companyId], isActive: !currentStatus }
            }));
        } catch (err) {
            setToggleError(`Failed to ${action} company: ${err.message}`);
        } finally {
            setTogglingCompany(null);
        }
    };

    useEffect(() => {
        if (!isIntegrationMode || companyList.length === 0) return;

        const fetchEnrichment = async () => {
            const newEnrichment = { ...enrichedCompanies };
            let changed = false;

            for (const company of companyList) {
                if (!newEnrichment[company.id]) {
                    try {
                        const snap = await getDoc(doc(db, `companies/${company.id}/integrations`, 'sms_provider'));
                        if (snap.exists()) {
                            const data = snap.data();
                            newEnrichment[company.id] = {
                                defaultPhoneNumber: data.defaultPhoneNumber || null,
                                smsProvider: data.provider || null
                            };
                            changed = true;
                        } else {
                            newEnrichment[company.id] = { defaultPhoneNumber: null, smsProvider: null };
                        }
                    } catch (e) {
                        console.error("Error fetching enrichment for", company.id, e);
                    }
                }
            }
            if (changed) setEnrichedCompanies(newEnrichment);
        };

        fetchEnrichment();
    }, [isIntegrationMode, companyList]);

    // Merge enriched data into the list for easy access in render
    const displayList = useMemo(() => {
        return companyList.map(c => ({
            ...c,
            ...(enrichedCompanies[c.id] || {})
        }));
    }, [companyList, enrichedCompanies]);

    const filteredCompanyList = useMemo(() => {
        const searchTerm = companySearch.toLowerCase();
        if (!searchTerm) return displayList;

        return displayList.filter(company => {
            const name = company.companyName?.toLowerCase() || '';
            const slug = company.appSlug?.toLowerCase() || '';
            const id = company.id.toLowerCase();

            return name.includes(searchTerm) || slug.includes(searchTerm) || id.includes(searchTerm);
        });
        // `displayList`, not `companyList`: the SMS enrichment arrives later and
        // must flow through to the rendered rows.
    }, [companySearch, displayList]);

    const totalPages = Math.ceil(filteredCompanyList.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredCompanyList.slice(start, start + itemsPerPage);
    }, [filteredCompanyList, currentPage, itemsPerPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [companySearch, itemsPerPage]);

    const openCompany = (company) => (isIntegrationMode ? onEdit(company) : onEdit(company.id));

    /** Runs a row action without also firing the row's own click handler. */
    const rowAction = (fn) => (event) => {
        event.stopPropagation();
        fn();
    };

    const title = isIntegrationMode ? "SMS Integrations Hub" : "Manage Companies";
    const TitleIcon = isIntegrationMode ? MessageSquare : Building;

    return (
        <Card padding="none" className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 border-b border-ds-border-subtle p-ds-5">
                <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <TitleIcon size={20} className="text-ds-content-link" aria-hidden="true" />
                    {title}
                </h2>
            </div>

            <div className="flex shrink-0 flex-col items-center justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface p-ds-4 sm:flex-row">
                <p className="text-ds-sm text-ds-content-muted">
                    Registered Companies: <strong className="text-ds-content">{companyList.length}</strong>
                </p>
                <div className="relative w-full sm:w-72">
                    <label htmlFor={searchId} className="sr-only">Search companies by name, slug or ID</label>
                    <Input
                        id={searchId}
                        type="search"
                        placeholder="Search companies..."
                        className="pl-10"
                        value={companySearch}
                        onChange={(e) => setCompanySearch(e.target.value)}
                    />
                    <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                </div>
            </div>

            {toggleError && (
                <p role="alert" className="border-b border-ds-status-danger-border bg-ds-status-danger-bg px-ds-4 py-ds-3 text-ds-sm text-ds-status-danger-fg">
                    {toggleError}
                </p>
            )}

            {/* Keyboard-focusable, named scroll region: below `sm` the table
                    scrolls horizontally, and in the empty state it holds no
                    focusable children, so keyboard users could not scroll it at
                    all (axe `scrollable-region-focusable`). Same pattern already
                    used by `EnvelopeHistory` and `CampaignResultsTable`. */}
                <div
                    role="region"
                    aria-label="Companies table"
                    tabIndex={0}
                    className="min-h-0 flex-1 overflow-auto bg-ds-canvas focus-visible:outline-none focus-visible:shadow-ds-focus"
                >
                <table className="w-full border-collapse text-left">
                    <caption className="sr-only">{title}</caption>
                    <thead className="sticky top-0 z-10 bg-ds-surface-subtle shadow-ds-xs">
                        <tr>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Company Name</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Slug / ID</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">{isIntegrationMode ? "SMS Number" : "Plan"}</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-center text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Status</th>
                            <th scope="col" className="border-b border-ds-border-subtle px-ds-6 py-ds-3 text-right text-ds-xs font-bold uppercase tracking-wider text-ds-content-secondary">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-ds-border-subtle bg-ds-surface">
                        {listLoading ? (
                            <tr><td colSpan="5" role="status" className="p-ds-10 text-center text-ds-content-muted"><SafeHaulLoader size="h-10 w-10" className="mx-auto mb-ds-2" />Loading companies...</td></tr>
                        ) : statsError.companies ? (
                            <tr><td colSpan="5" role="alert" className="p-ds-10 text-center text-ds-status-danger-fg">Error loading companies.</td></tr>
                        ) : filteredCompanyList.length === 0 ? (
                            <tr><td colSpan="5" className="p-ds-10 text-center text-ds-content-muted">No companies found.</td></tr>
                        ) : (
                            paginatedData.map(company => {
                                const isActive = company.isActive !== false;
                                const companyName = getFieldValue(company.companyName);
                                return (
                                    <tr
                                        key={company.id}
                                        onClick={() => openCompany(company)}
                                        className="cursor-pointer transition-colors hover:bg-ds-surface-subtle"
                                    >
                                        <th scope="row" className="px-ds-6 py-ds-4 text-left align-middle font-normal">
                                            <div className="flex items-center gap-ds-3">
                                                <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-lg font-bold text-ds-content-muted">
                                                    {company.companyLogoUrl ? (
                                                        <img src={company.companyLogoUrl} alt="" loading="lazy" className="h-full w-full rounded-ds-md object-contain" />
                                                    ) : (
                                                        companyName.charAt(0)
                                                    )}
                                                </span>
                                                {/* A real button so keyboard users can open a company at all. */}
                                                <button
                                                    type="button"
                                                    onClick={rowAction(() => openCompany(company))}
                                                    className="truncate rounded-ds-sm text-left font-semibold text-ds-content hover:underline focus-visible:outline-none focus-visible:shadow-ds-focus"
                                                >
                                                    {companyName}
                                                </button>
                                            </div>
                                        </th>
                                        <td className="px-ds-6 py-ds-4 align-middle">
                                            <span className="flex flex-col">
                                                <span className="w-fit rounded-ds-sm bg-ds-status-info-bg px-2 py-0.5 font-mono text-ds-sm text-ds-status-info-fg">/{getFieldValue(company.appSlug)}</span>
                                                <span className="mt-1 font-mono text-ds-xs text-ds-content-muted">{company.id}</span>
                                            </span>
                                        </td>
                                        <td className="px-ds-6 py-ds-4 align-middle">
                                            {isIntegrationMode ? (
                                                <span className="flex flex-col items-start gap-1">
                                                    {company.defaultPhoneNumber ? (
                                                        <Badge tone="success" icon={Phone}>{company.defaultPhoneNumber}</Badge>
                                                    ) : (
                                                        <span className="text-ds-xs italic text-ds-content-muted">Not Provisioned</span>
                                                    )}
                                                    {company.smsProvider && (
                                                        <span className="text-ds-xs uppercase tracking-widest text-ds-content-muted">{company.smsProvider}</span>
                                                    )}
                                                </span>
                                            ) : company.planType === 'paid' ? (
                                                <Badge tone="warning" icon={Crown}>Pro Plan</Badge>
                                            ) : (
                                                <Badge tone="neutral" icon={Shield}>Free Plan</Badge>
                                            )}
                                        </td>
                                        <td className="px-ds-6 py-ds-4 text-center align-middle">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                loading={togglingCompany === company.id}
                                                onClick={rowAction(() => setPendingToggle({
                                                    companyId: company.id,
                                                    companyName: company.companyName,
                                                    currentStatus: isActive,
                                                }))}
                                            >
                                                {isActive
                                                    ? <><CheckCircle size={12} aria-hidden="true" /> Active</>
                                                    : <><XCircle size={12} aria-hidden="true" /> Inactive</>}
                                                <span className="sr-only">
                                                    {` — ${companyName}, click to ${isActive ? 'deactivate' : 'activate'}`}
                                                </span>
                                            </Button>
                                        </td>
                                        <td className="px-ds-6 py-ds-4 text-right align-middle">
                                            <div className="flex justify-end gap-ds-2">
                                                {isIntegrationMode ? (
                                                    <Button variant="primary" size="sm" onClick={rowAction(() => onEdit(company))}>
                                                        <Database size={14} aria-hidden="true" /> Manage API
                                                        <span className="sr-only"> for {companyName}</span>
                                                    </Button>
                                                ) : (
                                                    <>
                                                        <IconButton
                                                            label={`View applications for ${companyName}`}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={rowAction(() => onViewApps({ id: company.id, name: company.companyName }))}
                                                        >
                                                            <FileText size={18} aria-hidden="true" />
                                                        </IconButton>
                                                        <IconButton
                                                            label={`Edit ${companyName}`}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={rowAction(() => onEdit(company.id))}
                                                        >
                                                            <Edit2 size={18} aria-hidden="true" />
                                                        </IconButton>
                                                        <IconButton
                                                            label={`Delete ${companyName}`}
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={rowAction(() => onDelete({ id: company.id, name: company.companyName }))}
                                                        >
                                                            <Trash2 size={18} aria-hidden="true" className="text-ds-status-danger-fg" />
                                                        </IconButton>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex shrink-0 flex-col items-center justify-between gap-ds-4 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4 sm:flex-row">
                <div className="flex items-center gap-ds-2 text-ds-sm text-ds-content-secondary">
                    <label htmlFor={perPageId}>Show</label>
                    <Select
                        id={perPageId}
                        value={itemsPerPage}
                        onChange={(e) => setItemsPerPage(Number(e.target.value))}
                        className="w-auto py-1.5"
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                    </Select>
                    <span>per page</span>
                </div>

                <div className="flex items-center gap-ds-4">
                    <span className="text-ds-sm text-ds-content-secondary" role="status">
                        Page <strong>{currentPage}</strong> of <strong>{totalPages || 1}</strong>
                    </span>
                    <div className="flex gap-1">
                        <IconButton
                            label="Previous page"
                            variant="secondary"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft size={16} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                            label="Next page"
                            variant="secondary"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages}
                        >
                            <ChevronRight size={16} aria-hidden="true" />
                        </IconButton>
                    </div>
                </div>
            </div>

            {/* Database Pagination (Load More) */}
            {hasMore && (
                <div className="shrink-0 border-t border-ds-border-subtle bg-ds-surface p-ds-4 text-center">
                    <Button
                        variant="secondary"
                        loading={isLoadingMore}
                        onClick={() => loadMore('companies')}
                    >
                        {isLoadingMore ? 'Loading…' : 'Load More from Database'}
                    </Button>
                </div>
            )}

            {pendingToggle && (
                <ToggleActiveDialog
                    pending={pendingToggle}
                    onCancel={() => setPendingToggle(null)}
                    onConfirm={runToggleCompanyActive}
                />
            )}
        </Card>
    );
}

/**
 * Replaces the blocking `window.confirm` that guarded activate/deactivate. The
 * wording is preserved verbatim, including the ALL-CAPS action verb, because it
 * is what Super Admins have been reading before a portal-access change.
 */
function ToggleActiveDialog({ pending, onCancel, onConfirm }) {
    const titleId = useId();
    const descriptionId = useId();
    const { companyName, currentStatus } = pending;
    const action = currentStatus ? 'deactivate' : 'activate';

    return (
        <Modal
            onClose={onCancel}
            labelledBy={titleId}
            describedBy={descriptionId}
            closeOnBackdrop={false}
            className="w-full max-w-lg overflow-hidden rounded-ds-xl border border-ds-border-subtle bg-ds-surface shadow-ds-lg"
        >
            <div className="p-ds-5">
                <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <AlertTriangle className="text-ds-status-warning-fg" aria-hidden="true" />
                    {action.toUpperCase()} "{companyName}"?
                </h2>
                <p id={descriptionId} className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                    {currentStatus
                        ? 'This company will be blocked from logging in and using the portal.'
                        : 'This company will regain access to the portal.'}
                </p>
            </div>
            <div className="flex justify-end gap-ds-3 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="secondary" onClick={onCancel}>Cancel</Button>
                <Button
                    variant={currentStatus ? 'danger' : 'primary'}
                    onClick={() => onConfirm({ companyId: pending.companyId, action, currentStatus })}
                >
                    {currentStatus ? 'Deactivate' : 'Activate'}
                </Button>
            </div>
        </Modal>
    );
}
