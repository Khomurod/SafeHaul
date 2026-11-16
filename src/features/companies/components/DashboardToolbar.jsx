// src/features/companies/components/DashboardToolbar.jsx

import React, { useState, memo } from 'react';
import { Icon, Users } from '@design-system/icons';
import { Button, FormField, Input, Select } from '@design-system/components';
import { ListToolbar } from '@design-system/patterns';
import { NORTH_AMERICAN_REGION_GROUPS } from '@shared/utils/northAmericanRegions';

/**
 * The candidate/lead list toolbar: the list page's row above the table card
 * (`ListToolbar placement="page"`) with this list's scope links (`lead`, the
 * Leads tabs) or its segments, its "Assigned to me" switch, its search, its
 * four filters and the assignment action. A lead list's status segments are
 * not here: they are the pills at the top of its table card, which the page
 * draws. A list whose tab names its assignee (Assigned to me, Unassigned)
 * leaves the Assigned to filter out (`showAssigneeFilter`), and a value it
 * holds from another list is neither shown nor counted. On a list that can
 * assign, Assign appears once a lead is ticked, in a place the row keeps for it.
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
    lead,
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
    myAssignmentsLabel = 'Assigned to me',
    showAssigneeFilter = true,
}) {
    const [showFilters, setShowFilters] = useState(false);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const activeCount = FILTER_FIELD_KEYS
        .filter((key) => showAssigneeFilter || key !== 'assignee')
        .filter((key) => Boolean(filters?.[key])).length;

    return (
        /*
         * No stacking layer. This toolbar overlays nothing — the filter row
         * below expands in flow rather than floating over the table — and a
         * layer on a page container would outrank the workspace topbar, which
         * sits on `sticky`.
         */
        <ListToolbar
            placement="page"
            lead={lead}
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

                        {showAssigneeFilter && (
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
                        )}

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
            // Shown once a lead is ticked, as C2 draws the list: nothing to
            // assign, no button. Its place is kept (`reserveActions`), so its
            // arrival pushes no row under the finger that ticked the lead.
            reserveActions={Boolean(canAssign)}
            actions={canAssign && selectedCount > 0 ? (
                <Button variant="primary" onClick={onAssignLeads}>
                    <Icon icon={Users} />
                    {`Assign (${selectedCount})`}
                </Button>
            ) : null}
        />
    );
});
