import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { DashboardToolbar, useCompanyDashboard } from '@features/companies';
import { validPeriod } from '@features/companies/hooks/dashboardPeriods';
import { isLeadsTab } from '@features/companies/hooks/dashboardSearch';
import { Card, DataTable } from '@/design-system/components';
import { PageContainer, PageHeader, Stack } from '@/design-system/layouts';
import { ListToolbar } from '@/design-system/patterns';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { whenIdle } from '@lib/runtime/whenIdle';

import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { LeadAssignmentModal } from '../components/LeadAssignmentModal';
import { DriverDossier } from '../components/modals/driver-dossier/DriverDossier';
import { loadDriverDossier } from '../components/modals/driver-dossier/loadDriverDossier';

import { buildCandidateColumns, getCandidateName, staleContactMeta, APPLICATION_PIPELINE_TABS, LEAD_PIPELINE_TABS } from './candidateListColumns';
import { UndatedRecordsNotice } from './UndatedRecordsNotice';
import { PeriodNotice } from './PeriodNotice';
import { LeadsHeaderActions } from './LeadsHeaderActions';
import { LeadListTabs } from './LeadListTabs';
import { CLEARED_NARROWING, candidateListEmpty, isListNarrowed } from './candidateListEmpty';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { canOfferCompanyRoute, companyRoute } from '@app/routes/companyRouteAccess';
import { COMPANY_NAV_GROUPS } from '@app/routes/companyRouteManifest';

// The table is memoized: what the page hands it is built here, or memoized
// below, so typing in the search (which changes nothing in the rows until the
// debounced search answers) does not redraw them.
function rowTone(item) {
    const level = staleContactMeta(item);
    if (!level) return 'neutral';
    return level === 'severe' ? 'danger' : 'warning';
}

const dossierRowLabel = (item) => `Open driver dossier for ${getCandidateName(item)}`;
const selectRowLabel = (item) => `Select ${getCandidateName(item)}`;

/** The menu group the lists sit in, named above their heading. */
const EYEBROW = COMPANY_NAV_GROUPS.applications.label;

export const CompanyCandidatesListPage = ({ scope }) => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const companyId = currentCompanyProfile?.id;

    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);

    const pipelineTabs =
        scope === 'applications' ? APPLICATION_PIPELINE_TABS : LEAD_PIPELINE_TABS;
    // A link can open the list on one of its segments, as the dashboard's Hired
    // card does with `{ state: { segment: 'hired' } }`, and the applications on
    // a month, as the dashboard's brief does with `{ state: { period } }`.
    const location = useLocation();
    const openedState = location.state;
    const openedSegment = openedState?.segment;
    const openedPeriod = scope === 'applications' ? validPeriod(openedState?.period) : null;
    const dashboard = useCompanyDashboard(companyId, {
        initialTab: scope,
        initialSegment: pipelineTabs.some((tab) => tab.id === openedSegment) ? openedSegment : 'all',
        initialPeriod: openedPeriod,
        // The page stays mounted across the menu's lists: each navigation brings its own period.
        navigationKey: location.key,
    });
    const { showError, showSuccess } = useToast();

    // The dossier's code loads behind the list once the page is idle, so a row
    // usually opens without waiting for it.
    useEffect(() => {
        whenIdle(() => { loadDriverDossier().catch(() => {}); });
    }, []);

    // Local State
    // The open record, `{ id, collectionHint }`: the collection the list read it
    // from, as `useCompanyDashboard` chooses it, so the dossier reads it there first.
    const [selectedApp, setSelectedApp] = useState(null);
    const [callModalData, setCallModalData] = useState(null);
    const [assigningLeads, setAssigningLeads] = useState([]);
    const [selectedRowIds, setSelectedRowIds] = useState([]);

    // Pressing the Added header sets the order Firestore sorts the whole list
    // by: newest first by default, oldest first, then newest first again.
    const { dateOrder, setDateOrder } = dashboard;
    const sort = useMemo(() => ({ key: 'addedDate', direction: dateOrder }), [dateOrder]);
    const handleSortChange = useCallback(({ direction }) => setDateOrder(direction), [setDateOrder]);
    const { setFilters, refreshData, nextPage, prevPage, setSearchQuery, setPipelineSegment } = dashboard;
    const listCollection = dashboard.activeTab === 'applications' ? 'applications' : 'leads';
    const openRow = useCallback(
        (item) => setSelectedApp({ id: item.id, collectionHint: listCollection }),
        [listCollection],
    );

    // Force hook to respect the scope prop
    useEffect(() => {
        if (scope && dashboard.activeTab !== scope) {
            dashboard.setActiveTab(scope);
        }
    }, [scope, dashboard.activeTab, dashboard.setActiveTab]);

    // Reset selection on data changes. An empty selection keeps its identity,
    // so the table's props do not change while the search is typed.
    useEffect(() => {
        setSelectedRowIds((prev) => (prev.length === 0 ? prev : []));
    }, [
        scope,
        dashboard.currentPage,
        dashboard.searchQuery,
        dashboard.pipelineSegment,
        dashboard.filters,
        dateOrder,
    ]);

    // Already in the Added Date order: the hook asks Firestore for it.
    const sortedData = dashboard.paginatedData;

    // ── Handlers ──
    const handlePhoneClick = (e, item) => {
        if (e) e.stopPropagation();
        if (item?.phone) {
            setCallModalData({ lead: item });
        } else {
            showError("No phone number available.");
        }
    };

    const handleAssignLeads = useCallback(() => setAssigningLeads(selectedRowIds), [selectedRowIds]);

    const handleShowAll = useCallback(() => setFilters((prev) => ({ ...prev, period: null })), [setFilters]);

    // The empty list's way back: no search, no filter, the whole list.
    const handleClearNarrowing = useCallback(() => {
        setSearchQuery('');
        setFilters((prev) => ({ ...prev, ...CLEARED_NARROWING }));
        setPipelineSegment('all');
    }, [setSearchQuery, setFilters, setPipelineSegment]);

    const handleToggleMyAssignments = useCallback(
        (next) => setFilters((prev) => ({ ...prev, myAssignmentsOnly: next })),
        [setFilters],
    );

    const handleAssignmentComplete = () => {
        showSuccess("Leads assigned successfully.");
        dashboard.refreshData();
    };

    const toggleRowSelection = useCallback((id) => {
        setSelectedRowIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    }, []);

    const toggleSelectAllPage = useCallback(() => {
        const pageIds = sortedData.map((item) => item.id);
        setSelectedRowIds((current) => {
            const selected = new Set(current);
            const allVisibleSelected = pageIds.length > 0
                && pageIds.every((id) => selected.has(id));

            if (allVisibleSelected) {
                pageIds.forEach((id) => selected.delete(id));
            } else {
                pageIds.forEach((id) => selected.add(id));
            }

            return [...selected];
        });
    }, [sortedData]);

    // ── Modals ──
    const renderSelectedModal = () => {
        if (!selectedApp) return null;

        return (
            <DriverDossier
                key={selectedApp.id}
                companyId={companyId}
                driverId={selectedApp.id}
                collectionHint={selectedApp.collectionHint}
                isOpen={true}
                onClose={() => setSelectedApp(null)}
                onDeleted={() => dashboard.refreshData()}
            />
        );
    };

    // One title for the three leads lists: the tabs under it say which one.
    const getPageTitle = () => {
        if (scope === 'applications') return 'Applications';
        return isLeadsTab(scope) ? 'Leads' : 'Candidates';
    };

    // The number of records the filters, search and segment leave, beside the
    // heading. Unknown while the list loads or its count failed, so none shows.
    const listCount = dashboard.loading || dashboard.error || dashboard.listCountError
        ? undefined
        : dashboard.totalCount;
    const countNoun = scope === 'applications' ? 'application' : 'lead';
    const countLabel = listCount === 1 ? countNoun : `${countNoun}s`;

    // Assigning stays a company admin's, on the lists where a lead may still
    // need an owner: All and Unassigned.
    const canAssign = isCompanyAdmin && (scope === 'company_leads' || scope === 'unassigned_leads');

    // An admin's Assigned to me keeps the checkbox column's place, empty, so
    // its columns stand where All and Unassigned draw them beside their boxes.
    const reserveSelection = isCompanyAdmin && scope === 'my_leads';

    const selection = useMemo(() => (canAssign ? {
        selectedIds: selectedRowIds,
        onToggleRow: toggleRowSelection,
        onToggleAll: toggleSelectAllPage,
        selectAllLabel: 'Select all candidates on this page',
        getRowLabel: selectRowLabel,
    } : undefined), [canAssign, selectedRowIds, toggleRowSelection, toggleSelectAllPage]);

    const tableError = useMemo(() => ((dashboard.error || dashboard.listCountError)
        ? {
            message: dashboard.error || dashboard.listCountError,
            onRetry: refreshData,
        }
        : undefined), [dashboard.error, dashboard.listCountError, refreshData]);

    // Nothing in the list yet, or nothing matching what narrows it
    // (`candidateListEmpty`). Worked out only while the list shows no row: a
    // list with rows hands the table one value, so typing redraws nothing.
    const showsNoRow = !dashboard.loading && sortedData.length === 0;
    const narrowed = showsNoRow && isListNarrowed({
        scope,
        searchQuery: dashboard.searchQuery,
        filters: dashboard.filters,
        segment: dashboard.pipelineSegment,
    });
    const canImportLeads = canOfferCompanyRoute(companyRoute('importLeads'), {
        isCompanyAdmin,
        features: currentCompanyProfile?.features,
    });
    const emptyState = useMemo(
        () => candidateListEmpty({ scope, narrowed, canImportLeads, isCompanyAdmin, onClear: handleClearNarrowing }),
        [scope, narrowed, canImportLeads, isCompanyAdmin, handleClearNarrowing],
    );

    const pagination = useMemo(() => ({
        currentPage: dashboard.currentPage,
        totalPages: dashboard.totalPages,
        onNext: nextPage,
        onPrev: prevPage,
        hasPrev: dashboard.currentPage > 1,
        hasNext: dashboard.currentPage < dashboard.totalPages,
        // The pager beside it says which page.
        label: `${dashboard.totalCount} total`,
    }), [dashboard.currentPage, dashboard.totalPages, dashboard.totalCount, nextPage, prevPage]);

    const isLeads = isLeadsTab(scope);
    const segments = useMemo(() => ({
        items: pipelineTabs,
        value: dashboard.pipelineSegment,
        onChange: dashboard.setPipelineSegment,
    }), [pipelineTabs, dashboard.pipelineSegment, dashboard.setPipelineSegment]);
    // A lead list's scope is its own page, a link at the start of the toolbar
    // row; its status segments narrow that scope, as pills at the top of the
    // table card. Applications has no scope: its segments lead the row.
    const leadTabs = useMemo(() => (isLeads ? <LeadListTabs scope={scope} /> : undefined), [isLeads, scope]);
    const statusPills = useMemo(
        () => ({ ...segments, ariaLabel: 'Pipeline segment', variant: 'pill' }),
        [segments],
    );

    // ── Column Config ──
    // The columns rebuild when the list or the team changes. The phone
    // handler is left out on purpose: it only reads state setters and the
    // toast, so the one it captured stays correct.
    const { teamMembers } = dashboard;
    const columns = useMemo(
        () => buildCandidateColumns({ handlePhoneClick, scope, teamMembers }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- handlePhoneClick left out (see above)
        [scope, teamMembers],
    );
    const table = (
        <DataTable
            embedded={isLeads}
            ariaLabel={`${getPageTitle()} table`}
            data={sortedData}
            columns={columns}
            getRowTone={rowTone}
            sort={sort}
            onSortChange={handleSortChange}
            getRowLabel={dossierRowLabel}
            onRowActivate={openRow}
            isLoading={dashboard.loading}
            loadingLabel={`Loading ${getPageTitle().toLowerCase()}`}
            empty={emptyState}
            error={tableError}
            selection={selection}
            reserveSelection={reserveSelection}
            // A driver is worked one at a time, so a phone shows one card
            // each, laid out by the columns' roles; a list with checkboxes
            // leads each card with its own, under "Select all". A lead's
            // status takes a line under its number on a narrow phone, so every
            // lead card has one shape; Applications keeps the corner.
            mobilePresentation="cards"
            mobileStatus={isLeads ? 'below' : 'corner'}
            pagination={pagination}
        />
    );

    return (
        <div className="min-h-full bg-ds-canvas">
            <PageContainer width="standard">
                <Stack gap="lg">
                    <PageHeader
                        eyebrow={EYEBROW}
                        title={getPageTitle()}
                        count={listCount}
                        countLabel={countLabel}
                        actions={isLeads ? <LeadsHeaderActions /> : undefined}
                    />
                    <PeriodNotice period={dashboard.filters.period} truncated={dashboard.listTruncated} onShowAll={handleShowAll} />
                    <UndatedRecordsNotice count={dashboard.undatedCount} />

                    {/* The list-page standard: one row of controls above the
                        table card, which ends after its last row. */}
                    <Stack gap="md">
                        <DashboardToolbar
                            lead={leadTabs}
                            segments={isLeads ? undefined : segments}
                            searchQuery={dashboard.searchQuery}
                            setSearchQuery={dashboard.setSearchQuery}
                            filters={dashboard.filters}
                            setFilters={setFilters}
                            selectedCount={selectedRowIds.length}
                            canAssign={canAssign}
                            onAssignLeads={handleAssignLeads}
                            teamMembers={dashboard.teamMembers}
                            // Assigned to me is a switch on Applications: the leads lists
                            // have Assigned to me as a tab. Assigned to me and
                            // Unassigned name their assignee, so they offer no
                            // Assigned to filter (`listAssignees` ignores one).
                            showMyAssignmentsToggle={scope === 'applications'}
                            myAssignmentsOnly={!!dashboard.filters.myAssignmentsOnly}
                            onToggleMyAssignments={handleToggleMyAssignments}
                            showAssigneeFilter={scope === 'applications' || scope === 'company_leads'}
                        />
                        {isLeads ? (
                            // The status pills are the card's top strip, over the
                            // column headers, so they read as narrowing this table.
                            <Card as="div" padding="none" elevation="soft" className="overflow-hidden">
                                <ListToolbar segments={statusPills} />
                                {table}
                            </Card>
                        ) : table}
                    </Stack>
                </Stack>
            </PageContainer>

            {/* Modals */}
            {renderSelectedModal()}

            {callModalData && (
                <CallOutcomeModal
                    lead={callModalData.lead}
                    companyId={companyId}
                    // The list's own collection: a lead list reads leads, Applications applications.
                    collectionName={isLeadsTab(scope) ? 'leads' : 'applications'}
                    onClose={() => setCallModalData(null)}
                    onUpdate={() => dashboard.refreshData()}
                />
            )}

            {assigningLeads.length > 0 && (
                <LeadAssignmentModal
                    companyId={companyId}
                    selectedLeadIds={assigningLeads}
                    onClose={() => setAssigningLeads([])}
                    onSuccess={handleAssignmentComplete}
                />
            )}
        </div>
    );
};
