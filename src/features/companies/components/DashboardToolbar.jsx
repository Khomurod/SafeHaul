// src/features/companies/components/DashboardToolbar.jsx

import React, { useState, memo } from 'react';
import { Icon, Users } from '@design-system/icons';
import { Button, FormField, Input, Select } from '@design-system/components';
import { ListToolbar } from '@design-system/patterns';
import { NORTH_AMERICAN_REGION_GROUPS } from '@shared/utils/northAmericanRegions';

/**
 * The candidate/lead list toolbar: the list-page `ListToolbar` with this list's
 * segments, its "only mine" switch, its search, its four filters and the
 * assignment action.
 *
 * Presentation only — the filter keys, the driver-type option list, the
 * `setFilters` shape, the assignment action and the my-assignments toggle
 * belong to the caller and stay as they are. The filter labels are real
 * `FormField` labels: a control labelled by an adjacent `<label>` with no
 * `htmlFor`, and with no `id`, announces as an anonymous combobox.
 */

// --- CONFIGURATION ---
const DRIVER_TYPE_OPTIONS = [
    "Dry Van", "Reefer", "Flatbed", "Tanker", "Box Truck",
    "Car Hauler", "Step Deck", "Lowboy", "Conestoga",
    "Intermodal", "Power Only", "Hotshot"
];

/**
 * The filters the Filters row sets, which "Clear filters" empties. The switch and
 * the search sit in plain sight with their own controls, so clearing leaves them.
 */
const FILTER_FIELD_KEYS = ['driverType', 'state', 'assignee', 'dateFilter', 'dob'];
const CLEARED_FIELDS = Object.fromEntries(FILTER_FIELD_KEYS.map((key) => [key, '']));

export const DashboardToolbar = memo(function DashboardToolbar({
    segments,
    searchQuery,
    setSearchQuery,
    filters,
    setFilters,

    selectedCount = 0,
    onAssignLeads,
    canAssign,
    teamMembers = [],

    showMyAssignmentsToggle = false,
    myAssignmentsOnly = false,
    onToggleMyAssignments,
    myAssignmentsLabel = 'Only mine',
}) {
    const [showFilters, setShowFilters] = useState(false);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const activeCount = FILTER_FIELD_KEYS.filter((key) => Boolean(filters?.[key])).length;

    return (
        /*
         * No stacking layer. This toolbar overlays nothing — the filter row
         * below expands in flow rather than floating over the table — and a
         * layer on a page container would outrank the workspace topbar, which
         * sits on `sticky`.
         */
        <ListToolbar
            segments={segments && { ariaLabel: 'Pipeline segment', ...segments }}
            toggle={showMyAssignmentsToggle
                ? { label: myAssignmentsLabel, checked: myAssignmentsOnly, onChange: (next) => onToggleMyAssignments?.(next) }
                : undefined}
            search={{
                label: 'Search name, phone or email',
                placeholder: 'Search name, phone, email...',
                value: searchQuery,
                onChange: setSearchQuery,
            }}
            filters={{
                open: showFilters,
                onOpenChange: setShowFilters,
                activeCount,
                onClear: () => setFilters((prev) => ({ ...prev, ...CLEARED_FIELDS })),
                children: (
                    <>
                        <FormField id="toolbar-driver-type" label="Freight type">
                            <Select
                                value={filters?.driverType || ''}
                                onChange={(e) => handleFilterChange('driverType', e.target.value)}
                            >
                                <option value="">All Types</option>
                                {DRIVER_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                            </Select>
                        </FormField>

                        {/* The regions the application's address pickers offer, by
                            the full name they store; the query also matches a
                            stored postal code (`stateFilterValues`). */}
                        <FormField id="toolbar-state" label="State">
                            <Select
                                value={filters?.state || ''}
                                onChange={(e) => handleFilterChange('state', e.target.value)}
                            >
                                <option value="">All States</option>
                                {NORTH_AMERICAN_REGION_GROUPS.map((group) => (
                                    <optgroup key={group.label} label={group.label}>
                                        {group.options.map((name) => <option key={name} value={name}>{name}</option>)}
                                    </optgroup>
                                ))}
                            </Select>
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

                        <FormField id="toolbar-date" label="Filter by date">
                            <Input
                                type="date"
                                value={filters?.dateFilter || ''}
                                onChange={(e) => handleFilterChange('dateFilter', e.target.value)}
                            />
                        </FormField>
                    </>
                ),
            }}
            actions={canAssign && selectedCount > 0 ? (
                <Button variant="primary" onClick={onAssignLeads}>
                    <Icon icon={Users} />
                    Assign ({selectedCount})
                </Button>
            ) : null}
        />
    );
});
