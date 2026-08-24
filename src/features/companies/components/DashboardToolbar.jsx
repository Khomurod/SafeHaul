// src/features/companies/components/DashboardToolbar.jsx

import React, { useState, useMemo, memo } from 'react';
import { Search, Filter, X, Briefcase, Users, Calendar, UserCircle } from 'lucide-react';
import { Button, FormField, Input, Select } from '@design-system/components';

/**
 * The candidate/lead list toolbar.
 *
 * Migrated 2026-08-21. Presentation only — the filter keys, the driver-type
 * option list, the `setFilters` shape, `clearFilters`, the assignment action and
 * the my-assignments toggle are unchanged.
 *
 * This screen was the campaign's exemplar, and it is worth recording what it
 * looked like: four hand-built buttons with four *different* paddings
 * (`px-4 py-1.5`, `px-3 py-2`, `p-2`, `px-4 p-2`), a search input at `py-2` and
 * three filter selects at `p-2` — so no two controls in one toolbar were the
 * same height — plus `text-gray-900`, `bg-blue-600` and `border-gray-200`
 * throughout, and hand-built `text-xs font-bold uppercase` labels.
 *
 * Every control now comes from the shared scale, so the row lines up without
 * anything being set here. The filter labels are real `FormField` labels, which
 * also fixes the accessibility defect underneath the styling: the filter
 * controls were labelled by an adjacent `<label>` with no `htmlFor` and had no
 * `id`, so each announced as an anonymous combobox.
 */

// --- CONFIGURATION ---
const DRIVER_TYPE_OPTIONS = [
    "Dry Van", "Reefer", "Flatbed", "Tanker", "Box Truck",
    "Car Hauler", "Step Deck", "Lowboy", "Conestoga",
    "Intermodal", "Power Only", "Hotshot"
];



export const DashboardToolbar = memo(function DashboardToolbar({
    activeTab,
    dataCount,
    totalCount,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,
    clearFilters,
    onShowSafeHaulInfo,
    latestBatchTime,
    visibleColumns,
    setVisibleColumns,

    selectedCount = 0,
    onAssignLeads,
    canAssign,
    teamMembers = [],

    showMyAssignmentsToggle = false,
    myAssignmentsOnly = false,
    onToggleMyAssignments,
    myAssignmentsLabel = 'My assignments',
}) {
    const [showFilters, setShowFilters] = useState(false);

    // Helper: Dynamic Tab Title
    const getTabTitle = () => {
        switch (activeTab) {
            case 'applications': return 'Direct Applications';

            case 'company_leads': return 'Imported Company Leads';
            case 'my_leads': return 'My Assigned Drivers';
            default: return 'Drivers';
        }
    };

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const hasActiveFilters = useMemo(() => {
        return filters && (filters.state || filters.driverType || filters.dob || filters.assignee || filters.dateFilter || filters.myAssignmentsOnly);
    }, [filters]);



    return (
        <div className="relative z-30 flex shrink-0 flex-col gap-ds-3 border-b border-ds-border-subtle bg-ds-surface p-ds-4">

            <div className="flex flex-col items-center justify-between gap-ds-4 sm:flex-row">
                <div className="flex flex-wrap items-center gap-ds-4">
                    <div>
                        <h2 className="flex items-center gap-ds-2 text-ds-heading-md font-bold text-ds-content">
                            {activeTab === 'company_leads' && <Briefcase size={18} aria-hidden="true" className="text-ds-status-warning-fg" />}
                            {getTabTitle()}
                        </h2>
                        <p className="text-ds-xs font-medium text-ds-content-muted">
                            Showing {dataCount} of {totalCount} records
                        </p>
                    </div>

                    {canAssign && selectedCount > 0 && (
                        <div className="border-l border-ds-border-subtle pl-ds-4 animate-in fade-in slide-in-from-left-2">
                            <Button variant="primary" onClick={onAssignLeads}>
                                <Users aria-hidden="true" />
                                Assign ({selectedCount})
                            </Button>
                        </div>
                    )}
                </div>

                <div className="flex w-full flex-wrap items-center justify-end gap-ds-2 sm:w-auto">
                    {showMyAssignmentsToggle && (
                        /*
                         * `aria-pressed` rather than a colour swap: this is a
                         * filter that is on or off, and the previous version
                         * signalled its state only by turning blue.
                         */
                        <Button
                            variant={myAssignmentsOnly ? 'primary' : 'secondary'}
                            aria-pressed={myAssignmentsOnly}
                            onClick={() => onToggleMyAssignments?.(!myAssignmentsOnly)}
                        >
                            <UserCircle aria-hidden="true" />
                            <span className="hidden sm:inline">{myAssignmentsLabel}</span>
                            <span className="sm:hidden ds-visually-hidden">{myAssignmentsLabel}</span>
                        </Button>
                    )}

                    <div className="relative flex-1 sm:w-64">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-ds-3">
                            <Search size={16} aria-hidden="true" className="text-ds-content-muted" />
                        </span>
                        <Input
                            type="search"
                            aria-label="Search name, phone or email"
                            placeholder="Search name, phone, email..."
                            className="pl-10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>

                    <Button
                        variant={showFilters || hasActiveFilters ? 'primary' : 'secondary'}
                        aria-pressed={showFilters}
                        aria-expanded={showFilters}
                        onClick={() => setShowFilters(!showFilters)}
                    >
                        <Filter aria-hidden="true" />
                        <span className="hidden sm:inline">Filters</span>
                        <span className="sm:hidden ds-visually-hidden">Filters</span>
                        {/* The dot repeats what the label already says, for a
                            glance rather than instead of it. */}
                        {hasActiveFilters && (
                            <>
                                <span aria-hidden="true" className="h-2 w-2 rounded-ds-full bg-current" />
                                <span className="ds-visually-hidden">(filters applied)</span>
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {showFilters && (
                <div className="border-t border-dashed border-ds-border-subtle pb-ds-1 pt-ds-3 animate-in slide-in-from-top-2">
                    <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                        <FormField id="toolbar-driver-type" label="Freight type">
                            <Select
                                value={filters?.driverType || ''}
                                onChange={(e) => handleFilterChange('driverType', e.target.value)}
                            >
                                <option value="">All Types</option>
                                {DRIVER_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                            </Select>
                        </FormField>

                        <FormField id="toolbar-state" label="State">
                            <Input
                                placeholder="e.g. IL, TX"
                                value={filters?.state || ''}
                                onChange={(e) => handleFilterChange('state', e.target.value)}
                                maxLength={2}
                            />
                        </FormField>

                        <FormField id="toolbar-assignee" label="Assigned to">
                            <Select
                                value={filters?.assignee || ''}
                                onChange={(e) => handleFilterChange('assignee', e.target.value)}
                            >
                                <option value="">All</option>
                                <option value="__unassigned__">Unassigned</option>
                                {teamMembers.map(m => (
                                    <option key={m.id} value={m.id}>{m.name || m.displayName || m.email}</option>
                                ))}
                            </Select>
                        </FormField>

                        <FormField
                            id="toolbar-date"
                            label={(
                                <span className="flex items-center gap-ds-1">
                                    <Calendar size={12} aria-hidden="true" /> Filter by date
                                </span>
                            )}
                        >
                            <Input
                                type="date"
                                value={filters?.dateFilter || ''}
                                onChange={(e) => handleFilterChange('dateFilter', e.target.value)}
                            />
                        </FormField>
                    </div>

                    <div className="mt-ds-3">
                        <Button variant="danger" fullWidth className="sm:w-auto" onClick={clearFilters}>
                            <X aria-hidden="true" />
                            Clear all filters
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
});
