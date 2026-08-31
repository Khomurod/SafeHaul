// src/features/super-admin/views/UnifiedDriverList.jsx
/**
 * Unified Driver Database — combined company leads and applications.
 *
 * Migrated to the design system 2026-07-28. Presentation only — the combined
 * lead/application list, the `sourceType` values, the search across
 * name/email/phone/company, the four filters, the sort keys, the 50-per-page
 * client pagination, the docs-status rule (4 required docs), the 14-day stale
 * rule, the relative-time buckets, the `companies/{id}/{applications|leads}/{id}`
 * delete path and every toast string are unchanged.
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
 *     so keyboard users could not see View/Message/Delete at all. They now also
 *     appear on focus.
 *  3. Icon-only actions carried only a `title`, so they had no accessible name.
 *  4. Blocking `window.confirm` on the destructive delete, replaced with an
 *     accessible dialog. The SUPER ADMIN WARNING wording is preserved verbatim.
 *  5. The search input and all four filter selects were unlabelled.
 *  6. `SourceBadge` and the docs-status text were legacy-palette pills.
 *  7. Dead `FilterChip` component removed (never rendered).
 *
 * PRODUCT BLOCKER — deliberately NOT changed: the bulk action bar's Message,
 * Assign, Move Status and Archive buttons are **placeholders that do nothing but
 * show a success toast**. Archiving 50 records reports success and archives
 * nothing. Implementing them would be inventing a workflow, and the toast
 * wording is a frozen contract, so the behaviour is preserved exactly and
 * recorded in the roadmap for an owner decision.
 */
import React, { useId, useState, useMemo, useCallback } from 'react';
import { db } from '@lib/firebase';
import { doc, deleteDoc } from 'firebase/firestore';
import {
    Search, Filter,
} from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { ModernDriverTable } from '@shared/components/table';
import { Button, Card, Input, Select } from '@/design-system/components';

// ========== SOURCE BADGE COMPONENT ==========
import {
    BulkActionBar,
    FILTERS,
    DeleteRecordDialog,
} from '../components/driver-list/UnifiedDriverListParts';
import { buildDriverListColumns } from '../components/driver-list/driverListColumns';

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
    const { showSuccess, showError } = useToast();
    const searchId = useId();
    const filterIdBase = useId();
    const bulkUnavailableNoteId = useId();

    // --- Search & Filters ---
    const [search, setSearch] = useState('');
    const [filters, setFilters] = useState({
        source: 'All',
        status: 'All',
        driverType: 'All',
        docsStatus: 'All'
    });

    // --- Sorting ---
    const [sortConfig, setSortConfig] = useState({ key: 'date', direction: 'desc' });

    // --- Selection & Bulk ---
    const [selectedIds, setSelectedIds] = useState(new Set());
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

        // 3. Sort
        data.sort((a, b) => {
            const dir = sortConfig.direction === 'asc' ? 1 : -1;

            if (sortConfig.key === 'date') {
                return ((a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0)) * dir;
            }
            if (sortConfig.key === 'name') {
                const aName = `${a.firstName} ${a.lastName}`;
                const bName = `${b.firstName} ${b.lastName}`;
                return aName.localeCompare(bName) * dir;
            }
            if (sortConfig.key === 'status') {
                return (a.status || 'New').localeCompare(b.status || 'New') * dir;
            }
            if (sortConfig.key === 'experience') {
                return ((a.yearsExperience || 0) - (b.yearsExperience || 0)) * dir;
            }
            return 0;
        });

        return data;
    }, [allApplications, search, filters, sortConfig, allCompaniesMap]);

    // --- Pagination ---
    const totalPages = Math.ceil(filteredData.length / itemsPerPage);
    const paginatedData = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return filteredData.slice(start, start + itemsPerPage);
    }, [filteredData, currentPage, itemsPerPage]);

    // --- Selection Handlers ---
    const toggleSelectAll = useCallback(() => {
        if (selectedIds.size === paginatedData.length) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(paginatedData.map(item => item.id)));
        }
    }, [selectedIds, paginatedData]);

    const toggleSelect = useCallback((id, e) => {
        e.stopPropagation();
        setSelectedIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    }, []);

    // --- Sort Handler ---
    const handleSort = useCallback((key) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
        }));
    }, []);

    // --- Delete Handler ---
    // The blocking `window.confirm` guard moved to `<DeleteRecordDialog>`; the
    // wording and the delete itself are unchanged.
    const handleDelete = async (item) => {
        setPendingDelete(null);
        setDeletingId(item.id);
        try {
            let docRef;
            if (item.companyId) {
                const collectionName = item.sourceType === 'Company App' ? 'applications' : 'leads';
                docRef = doc(db, "companies", item.companyId, collectionName, item.id);
            } else {
                throw new Error("Missing company ID for this record.");
            }

            await deleteDoc(docRef);
            showSuccess("Record deleted successfully.");
            onDataUpdate();
        } catch (err) {
            console.error("Delete failed:", err);
            showError("Failed to delete. Check console.");
        } finally {
            setDeletingId(null);
        }
    };

    // --- Bulk Action Handlers ---
    // Removed 2026-07-28: four placeholder handlers that only fired a *success*
    // toast without doing any work (see the `BulkActionBar` note). The controls are
    // now disabled and labelled unavailable rather than reporting a false success.

    // --- Clear Filters ---
    const clearAllFilters = () => {
        setSearch('');
        setFilters({ source: 'All', status: 'All', driverType: 'All', docsStatus: 'All' });
    };

    const hasActiveFilters = search || Object.values(filters).some(v => v !== 'All');

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
        <div className="space-y-4 h-full flex flex-col">

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
                        <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ds-content-muted" />
                    </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-ds-2">
                    <span className="flex items-center gap-1 text-ds-xs font-semibold uppercase tracking-wide text-ds-content-muted">
                        <Filter size={12} aria-hidden="true" /> Filters:
                    </span>

                    {FILTERS.map(({ key, label, options }) => (
                        <span key={key} className="flex items-center gap-1">
                            <label htmlFor={`${filterIdBase}-${key}`} className="sr-only">{label}</label>
                            <Select
                                id={`${filterIdBase}-${key}`}
                                className="w-auto py-1.5"
                                value={filters[key]}
                                onChange={(e) => setFilters(f => ({ ...f, [key]: e.target.value }))}
                            >
                                {options.map(([value, text]) => (
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

            {/* Table Container */}
            <div className="flex-1 overflow-hidden flex flex-col">

                {/* Bulk Action Bar */}
                {selectedIds.size > 0 && (
                    <BulkActionBar
                        selectedCount={selectedIds.size}
                        onClearSelection={() => setSelectedIds(new Set())}
                        unavailableNoteId={bulkUnavailableNoteId}
                    />
                )}

                {/* Modern Driver Table */}
                <ModernDriverTable
                    data={paginatedData}
                    columns={tableColumns}
                    onRowClick={onAppClick}
                    isLoading={isLoading}
                    emptyMessage="No drivers match your filters."
                    emptyIcon={hasActiveFilters ? (
                        <div className="text-center">
                            <Search size={32} className="mx-auto mb-ds-3 text-ds-content-secondary" aria-hidden="true" />
                            <Button variant="ghost" size="sm" onClick={clearAllFilters}>Clear Filters</Button>
                        </div>
                    ) : undefined}
                    // Names the table, its caption, its scroll region and its pager.
                    ariaLabel="Unified driver database"
                    // Gives each row's selection checkbox a record-specific name
                    // instead of eight identical "Select row" controls.
                    getRowLabel={(item) => item.applicantName || item.name || `record ${item.id}`}
                    showCheckboxes={true}
                    selectedIds={selectedIds}
                    onToggleSelect={(id, e) => toggleSelect(id, e || { stopPropagation: () => { } })}
                    onToggleSelectAll={toggleSelectAll}
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
            </div>

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