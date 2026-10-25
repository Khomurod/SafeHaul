// src/features/super-admin/views/UnifiedDriverList.jsx
/**
 * Unified Driver Database — combined company leads and applications.
 *
 * Presentation only. Frozen contracts: the combined lead/application list, the
 * `sourceType` values, the search across name/email/phone/company, the sort
 * keys, the 50-per-page client pagination, the docs-status rule (4 required
 * docs), the 14-day stale rule and the relative-time buckets. The status and
 * driver-type filters offer
 * the values the loaded records hold (`FILTERS`), and the source filter only the
 * two sources a record has.
 *
 * Delete goes through the `deleteApplication` callable (`useApplicationDelete`),
 * as a company admin's does, so the record's subcollections and uploaded files
 * go with it. A bare `deleteDoc` here removed the document alone.
 *
 * Defects fixed here:
 *  1. **Load More was wired but never used.** `ViewRouter` passes `loadMore` and
 *     `hasMore` from `useSuperAdminData`, and the hook fully supports
 *     `loadMore('applications')` — but this view destructured both and ignored
 *     them, so the Unified Driver DB could only ever page through the first
 *     batch already in memory. There was no way to reach older records at all.
 *     Now wired to the same "Load More from Database" control the sibling
 *     `CompaniesView` already uses, so the presentation is consistent and no new
 *     workflow is invented.
 *  2. **Row actions were invisible until hover** (`opacity-0 group-hover:*`),
 *     so keyboard and touch users could not see View/Delete at all. They are
 *     always in view now. The row's Message action had no handler and is gone.
 *  3. Icon-only actions carried only a `title`, so they had no accessible name.
 *  4. Blocking `window.confirm` on the destructive delete, replaced with an
 *     accessible dialog. The SUPER ADMIN WARNING wording is preserved verbatim.
 *  5. The search input and all four filter selects were unlabelled.
 *  6. `SourceBadge` and the docs-status text were legacy-palette pills.
 *  7. Dead `FilterChip` component removed (never rendered).
 *
 * The list is a `DataTable`: Previous / Next are the table's own pager, a row
 * opens its record by click or Enter, and "Clear All" in the toolbar is the one
 * way to clear the filters.
 *
 * Bulk actions — none, by owner decision, per the bulk-action UX guidance (never
 * show controls that do nothing): no bulk bar and no row-selection checkboxes. A
 * real bulk action returns together with its selection when a recruiter asks for
 * one — "Export" first, and "Archive" only once an archived state is defined.
 * `UnifiedDriverList.bulkSafety.test.jsx` pins the absence.
 */
import React, { useId, useState, useMemo } from 'react';
import { Icon, Search, Filter } from '@design-system/icons';
import { useApplicationDelete } from '@features/applications/hooks/useApplicationDelete';
import { Button, Card, DataTable, Input, Select } from '@/design-system/components';

import { FILTERS, DeleteRecordDialog } from '../components/driver-list/UnifiedDriverListParts';
import { buildDriverListColumns, driverName } from '../components/driver-list/driverListColumns';

/**
 * The options of a filter that offers what the records hold: each value once,
 * sorted, a list read whole, and the value already chosen kept even when the
 * records loaded since no longer hold it.
 */
function heldOptions(records, { read, allText }, chosen) {
    const values = new Set();
    for (const record of records) {
        const held = read(record);
        for (const value of Array.isArray(held) ? held : [held]) {
            if (typeof value === 'string' && value.trim() !== '') values.add(value);
        }
    }
    if (chosen !== 'All') values.add(chosen);
    return [['All', allText], ...[...values].sort((a, b) => a.localeCompare(b)).map((value) => [value, value])];
}

// ========== MAIN COMPONENT ==========
export function UnifiedDriverList({
    allApplications,
    allCompaniesMap,
    onAppClick,
    onDataUpdate,
    loadMore,
    isLoadingMore = false,
    hasMore,
    isLoading = false
}) {
    const { deleteApplication } = useApplicationDelete();
    const searchId = useId();
    const filterIdBase = useId();

    // --- Search & Filters ---
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState({
        source: 'All',
        status: 'All',
        driverType: 'All',
        docsStatus: 'All'
    });

    // --- Delete ---
    const [deletingId, setDeletingId] = useState(null);
    const [pendingDelete, setPendingDelete] = useState(null);

    // --- Pagination ---
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(50);

    // --- Helper: Relative Time ---
    const getRelativeTime = (timestamp) => {
        if (!timestamp?.seconds) return '--';
        const now = Date.now();
        const then = timestamp.seconds * 1000;
        const diffMs = now - then;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return '1d ago';
        if (diffDays < 7) return `${diffDays}d ago`;
        if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
        return `${Math.floor(diffDays / 30)}mo ago`;
    };

    // --- Helper: Check if Stale (>14 days) ---
    const isStale = (timestamp) => {
        if (!timestamp?.seconds) return false;
        const diffMs = Date.now() - (timestamp.seconds * 1000);
        return diffMs > (14 * 24 * 60 * 60 * 1000);
    };

    // --- Helper: Calculate Docs Status ---
    const getDocsStatus = (item) => {
        const docs = item.uploadedDocuments || item.documents || {};
        const docsCount = Object.keys(docs).length;
        const requiredDocs = 4; // CDL front, back, medical, MVR
        if (docsCount >= requiredDocs) return 'Complete';
        if (docsCount === 0) return 'Missing';
        return `${docsCount}/${requiredDocs}`;
    };

    // --- Data Processing ---
    const filteredData = useMemo(() => {
        let data = [...allApplications];

        // 1. Search
        if (search) {
            const term = search.toLowerCase();
            data = data.filter(item => {
                const name = `${item.firstName || ''} ${item.lastName || ''}`.toLowerCase();
                const email = (item.email || '').toLowerCase();
                const phone = (item.phone || '').toLowerCase();
                const company = (allCompaniesMap.get(item.companyId) || '').toLowerCase();
                return name.includes(term) || email.includes(term) || phone.includes(term) || company.includes(term);
            });
        }

        // 2. Filters
        if (filters.source !== 'All') {
            data = data.filter(item => item.sourceType === filters.source);
        }
        if (filters.status !== 'All') {
            data = data.filter(item => (item.status || 'New') === filters.status);
        }
        if (filters.driverType !== 'All') {
            data = data.filter(item => {
                const types = Array.isArray(item.driverType) ? item.driverType : [item.driverType];
                return types?.includes(filters.driverType);
            });
        }
        if (filters.docsStatus !== 'All') {
            data = data.filter(item => {
                const status = getDocsStatus(item);
                if (filters.docsStatus === 'Complete') return status === 'Complete';
                if (filters.docsStatus === 'Missing') return status === 'Missing';
                return status !== 'Complete' && status !== 'Missing';
            });
        }

        // 3. Newest first
        data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        return data;
    }, [allApplications, search, filters, allCompaniesMap]);

    // --- Pagination ---
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredData.slice(start, start + itemsPerPage);
    }, [filteredData, currentPage, itemsPerPage]);

    // --- Delete Handler ---
    // The blocking `window.confirm` guard moved to `<DeleteRecordDialog>`. The
    // hook says how it went, in the server's words when it refused.
    const handleDelete = async (item) => {
        setPendingDelete(null);
        setDeletingId(item.id);
        try {
            const deleted = await deleteApplication({
                companyId: item.companyId,
                applicationId: item.id,
                collectionName: item.sourceType === 'Company App' ? 'applications' : 'leads',
            });
            if (deleted) onDataUpdate();
        } finally {
            setDeletingId(null);
        }
    };

    // --- Clear Filters ---
    const clearAllFilters = () => {
        setSearch('');
        setFilters({ source: 'All', status: 'All', driverType: 'All', docsStatus: 'All' });
    };

    const hasActiveFilters = search || Object.values(filters).some(v => v !== 'All');

    const filterOptions = useMemo(() => Object.fromEntries(FILTERS.map((filter) => [
        filter.key,
        filter.options || heldOptions(allApplications, filter, filters[filter.key]),
    ])), [allApplications, filters]);

    // --- Modern Table Column Config ---
    const tableColumns = useMemo(() => buildDriverListColumns({
        deletingId,
        onAppClick,
        setPendingDelete,
        getRelativeTime,
        isStale,
        getDocsStatus,
    }), [deletingId, onAppClick]);

    return (
        <div className="flex h-full flex-col gap-ds-4">

            {/* Header / Search / Filters */}
            <Card padding="md" className="shrink-0 space-y-ds-4">
                <div className="flex flex-col justify-between gap-ds-4 md:flex-row md:items-center">
                    <div>
                        <h2 className="text-ds-heading-sm font-bold text-ds-content">Unified Driver Database</h2>
                        <p className="text-ds-sm text-ds-content-muted" role="status">{filteredData.length} records found across all systems</p>
                    </div>

                    {/* Search */}
                    <div className="relative w-full md:w-80">
                        <label htmlFor={searchId} className="sr-only">Search drivers by name, email, phone or company</label>
                        <Input
                            id={searchId}
                            type="search"
                            placeholder="Search by name, email, or phone..."
                            className="pl-9"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-ds-2">
                    <span className="flex items-center gap-1 text-ds-xs font-semibold uppercase tracking-wide text-ds-content-muted">
                        <Icon icon={Filter} size="xs" /> Filters:
                    </span>

                    {FILTERS.map(({ key, label }) => (
                        <span key={key} className="flex items-center gap-1">
                            <label htmlFor={`${filterIdBase}-${key}`} className="sr-only">{label}</label>
                            <Select
                                id={`${filterIdBase}-${key}`}
                                className="w-auto py-1.5"
                                value={filters[key]}
                                onChange={(e) => setFilters(f => ({ ...f, [key]: e.target.value }))}
                            >
                                {filterOptions[key].map(([value, text]) => (
                                    <option key={value} value={value}>{text}</option>
                                ))}
                            </Select>
                        </span>
                    ))}

                    {hasActiveFilters && (
                        <Button variant="ghost" size="sm" onClick={clearAllFilters}>
                            Clear All<span className="sr-only"> filters</span>
                        </Button>
                    )}
                </div>
            </Card>

            {/* The table fills the space below the toolbar and scrolls inside
                it, under its sticky header; a phone shows one card per driver. */}
            <Card padding="none" className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <DataTable
                    embedded
                    ariaLabel="Unified driver database"
                    density="compact"
                    mobilePresentation="cards"
                    data={paginatedData}
                    columns={tableColumns}
                    getRowId={(item) => item.id}
                    getRowLabel={(item) => `Open record for ${driverName(item) || 'this driver'}`}
                    onRowActivate={onAppClick}
                    isLoading={isLoading}
                    loadingLabel="Loading drivers..."
                    empty={{ title: 'No drivers match your filters.' }}
                    pagination={{
                        currentPage,
                        totalPages: totalPages || 1,
                        onNext: () => setCurrentPage(p => p + 1),
                        onPrev: () => setCurrentPage(p => p - 1),
                        hasPrev: currentPage > 1,
                        hasNext: currentPage < totalPages,
                        label: `Showing ${paginatedData.length} of ${filteredData.length} records`,
                    }}
                />

                {/* Database pagination. `loadMore`/`hasMore` were passed by
                    ViewRouter and ignored, so older records were unreachable.
                    Same control the sibling CompaniesView already uses. The
                    button reflects `isLoadingMore` so it is disabled and shows a
                    loading state while a fetch is in flight; the real guard
                    against a double-fetch (and the duplicate records/keys it
                    caused) lives in `useSuperAdminData.loadMore`, not just
                    here in the visual state. */}
                {hasMore && (
                    <div className="shrink-0 border-t border-ds-border-subtle bg-ds-surface p-ds-4 text-center">
                        <Button
                            variant="secondary"
                            loading={isLoadingMore}
                            onClick={() => loadMore('applications')}
                        >
                            {isLoadingMore ? 'Loading…' : 'Load More from Database'}
                        </Button>
                    </div>
                )}
            </Card>

            {pendingDelete && (
                <DeleteRecordDialog
                    item={pendingDelete}
                    onCancel={() => setPendingDelete(null)}
                    onConfirm={() => handleDelete(pendingDelete)}
                />
            )}
        </div>
    );
}

export default UnifiedDriverList;