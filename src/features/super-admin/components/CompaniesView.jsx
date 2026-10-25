import React, { useState, useMemo, useEffect, useId } from 'react';
import { getFieldValue } from '@shared/utils/helpers.js';
import { Icon, Building, FileText, Edit2, Trash2, Search, Crown, Shield, CheckCircle, XCircle } from '@design-system/icons';
import { db } from '@lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Badge, Button, Card, DataTable, IconButton, Input, Notice } from '@/design-system/components';
import { ConfirmDialog } from '@design-system/patterns';

/**
 * Super Admin companies table. A company opens its own screen (`onOpen`),
 * where its features and its SMS setup are; the pencil opens its details
 * editor.
 *
 * Frozen contracts: the `updateDoc(companies/{id}, { isActive })` toggle, the
 * name/slug/id search, the client-side 20/50/100 pagination, the
 * `loadMore('companies')` database pagination, and every frozen string.
 *
 * The list is a `DataTable`: a row opens its company (pointer or keyboard),
 * the name is also a button of its own, and the status toggle and the three
 * actions never also open the row. Rows per page and Previous / Next are the
 * table's own pager; "Load More from Database" stays below it.
 *
 * Defects fixed here:
 *  1. **Stale derived data.** `filteredCompanyList` depends on `displayList`
 *     (companies merged with a status just toggled), not on `companyList`.
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
const PAGE_SIZES = [20, 50, 100];

export function CompaniesView({
    listLoading,
    statsError,
    companyList,
    onViewApps,
    onEdit,
    onDelete,
    onOpen,
    loadMore,
    isLoadingMore = false,
    hasMore,
}) {
    const [companySearch, setCompanySearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [enrichedCompanies, setEnrichedCompanies] = useState({}); // ID -> { isActive } just written
    const [togglingCompany, setTogglingCompany] = useState(null);
    const [pendingToggle, setPendingToggle] = useState(null);
    const [toggleError, setToggleError] = useState('');
    const searchId = useId();

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
        // `displayList`, not `companyList`: a status just toggled must flow
        // through to the rendered rows.
    }, [companySearch, displayList]);

    const totalPages = Math.ceil(filteredCompanyList.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredCompanyList.slice(start, start + itemsPerPage);
    }, [filteredCompanyList, currentPage, itemsPerPage]);

    useEffect(() => {
        setCurrentPage(1);
    }, [companySearch, itemsPerPage]);

    const openCompany = (company) => onOpen(company);

    /** Runs a row action without also firing the row's own click handler. */
    const rowAction = (fn) => (event) => {
        event.stopPropagation();
        fn();
    };

    const title = "Manage Companies";

    // Rebuilt with the handlers it closes over; the toggle shows its spinner
    // only on the company being written.
    const columns = [
        {
            key: 'company',
            header: 'Company Name',
            rowHeader: true,
            width: 'xl',
            render: (company) => {
                const companyName = getFieldValue(company.companyName);
                return (
                    <div className="flex min-w-0 items-center gap-ds-3">
                        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-heading-md font-bold text-ds-content-muted">
                            {company.companyLogoUrl ? (
                                <img src={company.companyLogoUrl} alt="" loading="lazy" className="h-full w-full rounded-ds-md object-contain" />
                            ) : (
                                companyName.charAt(0)
                            )}
                        </span>
                        {/* A real button, so the name is a named keyboard stop of its own. */}
                        <Button
                            variant="link"
                            justify="start"
                            className="min-w-0 text-left [overflow-wrap:anywhere]"
                            onClick={rowAction(() => openCompany(company))}
                        >
                            {companyName}
                        </Button>
                    </div>
                );
            },
        },
        {
            key: 'slug',
            header: 'Slug / ID',
            width: 'xl',
            render: (company) => (
                <span className="flex min-w-0 flex-col">
                    <span className="w-fit max-w-full rounded-ds-sm bg-ds-status-info-bg px-2 py-0.5 font-mono text-ds-sm text-ds-status-info-fg [overflow-wrap:anywhere]">/{getFieldValue(company.appSlug)}</span>
                    <span className="mt-1 font-mono text-ds-xs text-ds-content-muted [overflow-wrap:anywhere]">{company.id}</span>
                </span>
            ),
        },
        {
            key: 'plan',
            header: 'Plan',
            width: 'md',
            render: (company) => (company.planType === 'paid'
                ? <Badge tone="warning" icon={Crown}>Pro Plan</Badge>
                : <Badge tone="neutral" icon={Shield}>Free Plan</Badge>),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: (company) => {
                const isActive = company.isActive !== false;
                const companyName = getFieldValue(company.companyName);
                return (
                    // `relative` keeps the sr-only text inside the scrolling table:
                    // without a positioned parent it sat past the right edge and
                    // widened the whole page on a phone.
                    <Button
                        variant="ghost"
                        size="sm"
                        className="relative"
                        loading={togglingCompany === company.id}
                        onClick={rowAction(() => setPendingToggle({
                            companyId: company.id,
                            companyName: company.companyName,
                            currentStatus: isActive,
                        }))}
                    >
                        {isActive
                            ? <><Icon icon={CheckCircle} size="xs" /> Active</>
                            : <><Icon icon={XCircle} size="xs" /> Inactive</>}
                        <span className="sr-only">
                            {` — ${companyName}, click to ${isActive ? 'deactivate' : 'activate'}`}
                        </span>
                    </Button>
                );
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            align: 'end',
            width: 'md',
            render: (company) => {
                const companyName = getFieldValue(company.companyName);
                return (
                    <div className="flex justify-end gap-ds-2">
                        <IconButton
                            label={`View applications for ${companyName}`}
                            variant="ghost"
                            size="sm"
                            onClick={rowAction(() => onViewApps({ id: company.id, name: company.companyName }))}
                        >
                            <Icon icon={FileText} size="lg" />
                        </IconButton>
                        <IconButton
                            label={`Edit ${companyName}`}
                            variant="ghost"
                            size="sm"
                            onClick={rowAction(() => onEdit(company.id))}
                        >
                            <Icon icon={Edit2} size="lg" />
                        </IconButton>
                        <IconButton
                            label={`Delete ${companyName}`}
                            variant="ghost"
                            size="sm"
                            onClick={rowAction(() => onDelete({ id: company.id, name: company.companyName }))}
                        >
                            <Icon icon={Trash2} size="lg" className="text-ds-status-danger-fg" />
                        </IconButton>
                    </div>
                );
            },
        },
    ];

    return (
        <Card padding="none" className="flex h-full flex-col overflow-hidden">
            <div className="shrink-0 border-b border-ds-border-subtle p-ds-5">
                <h2 className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                    <Icon icon={Building} size="xl" className="text-ds-content-link" />
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
                    <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                </div>
            </div>

            {toggleError && (
                /* Gains the danger glyph, and its single bottom rule becomes a
                   border on four sides — a full-width strip under the toolbar
                   becomes a bounded block, which is the contract's shape. */
                <Notice announce="assertive" tone="danger" size="sm">
                    {toggleError}
                </Notice>
            )}

            {/* Fills the card below the toolbar; the table scrolls inside it,
                under its sticky header, and sideways on a phone. */}
            <div className="flex min-h-0 flex-1 flex-col">
                <DataTable
                    embedded
                    ariaLabel={title}
                    density="compact"
                    minWidth="standard"
                    data={paginatedData}
                    columns={columns}
                    getRowId={(company) => company.id}
                    getRowLabel={(company) => getFieldValue(company.companyName)}
                    onRowActivate={openCompany}
                    isLoading={listLoading}
                    loadingLabel="Loading companies..."
                    error={statsError.companies ? 'Error loading companies.' : undefined}
                    empty={{ title: 'No companies found.' }}
                    pagination={{
                        currentPage,
                        totalPages: totalPages || 1,
                        onNext: () => setCurrentPage((p) => Math.min(totalPages, p + 1)),
                        onPrev: () => setCurrentPage((p) => Math.max(1, p - 1)),
                        hasPrev: currentPage > 1,
                        hasNext: currentPage < totalPages,
                        label: `Showing ${paginatedData.length} of ${filteredCompanyList.length} companies`,
                        pageSize: itemsPerPage,
                        pageSizes: PAGE_SIZES,
                        onPageSizeChange: setItemsPerPage,
                    }}
                />
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
 *
 * The approved `ConfirmDialog`. The two tones map to the two confirm variants —
 * the tone map pairs `danger` with a danger-styled confirm and `info` with a
 * primary one — so deactivating is red and re-activating is blue, and the icon
 * differs between them (a warning versus a question).
 */
function ToggleActiveDialog({ pending, onCancel, onConfirm }) {
    const { companyName, currentStatus } = pending;
    const action = currentStatus ? 'deactivate' : 'activate';

    return (
        <ConfirmDialog
            tone={currentStatus ? 'danger' : 'info'}
            title={`${action.toUpperCase()} "${companyName}"?`}
            description={currentStatus
                ? 'This company will be blocked from logging in and using the portal.'
                : 'This company will regain access to the portal.'}
            confirmLabel={currentStatus ? 'Deactivate' : 'Activate'}
            onCancel={onCancel}
            onConfirm={() => onConfirm({ companyId: pending.companyId, action, currentStatus })}
        />
    );
}
