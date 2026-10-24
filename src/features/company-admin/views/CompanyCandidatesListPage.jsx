import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { DashboardToolbar, useCompanyDashboard } from '@features/companies';
import { Chip, ChipGroup, DataTable } from '@/design-system/components';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { whenIdle } from '@lib/monitoring/sentry';

import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { LeadAssignmentModal } from '../components/LeadAssignmentModal';
import { DriverDossier } from '../components/modals/driver-dossier/DriverDossier';
import { loadDriverDossier } from '../components/modals/driver-dossier/loadDriverDossier';

import { buildCandidateColumns, getCandidateName, staleContactMeta, APPLICATION_PIPELINE_TABS, LEAD_PIPELINE_TABS } from './candidateListColumns';
import { UndatedRecordsNotice } from './UndatedRecordsNotice';
import { isCompanyAdminForRoute } from '@app/auth/roles';

export const CompanyCandidatesListPage = ({ scope }) => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const companyId = currentCompanyProfile?.id;

    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);

    const pipelineTabs =
        scope === 'applications' ? APPLICATION_PIPELINE_TABS : LEAD_PIPELINE_TABS;
    // A link can open the list on one of its segments, as the dashboard's Hired
    // card does with `{ state: { segment: 'hired' } }`.
    const openedSegment = useLocation().state?.segment;
    const dashboard = useCompanyDashboard(companyId, {
        initialTab: scope,
        initialSegment: pipelineTabs.some((tab) => tab.id === openedSegment) ? openedSegment : 'all',
    });
    const { showError, showSuccess } = useToast();

    // The dossier's code loads behind the list once the page is idle, so a row
    // usually opens without waiting for it.
    useEffect(() => {
        whenIdle(() => { loadDriverDossier().catch(() => {}); });
    }, []);

    // Local State
    const [selectedApp, setSelectedApp] = useState(null);
    const [callModalData, setCallModalData] = useState(null);
    const [assigningLeads, setAssigningLeads] = useState([]);
    const [selectedRowIds, setSelectedRowIds] = useState([]);

    // Pressing the Added header sets the order Firestore sorts the whole list
    // by: newest first by default, oldest first, then newest first again.
    const { dateOrder, setDateOrder } = dashboard;
    const sort = useMemo(() => ({ key: 'addedDate', direction: dateOrder }), [dateOrder]);

    // Force hook to respect the scope prop
    useEffect(() => {
        if (scope && dashboard.activeTab !== scope) {
            dashboard.setActiveTab(scope);
        }
    }, [scope, dashboard.activeTab, dashboard.setActiveTab]);

    // Reset selection on data changes
    useEffect(() => {
        setSelectedRowIds([]);
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

    const handleOpenAssignment = (selectedIds) => {
        setAssigningLeads(selectedIds);
    };

    const handleAssignmentComplete = () => {
        showSuccess("Leads assigned successfully.");
        dashboard.refreshData();
    };

    const toggleRowSelection = (id) => {
        setSelectedRowIds(prev =>
            prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
        );
    };

    const toggleSelectAllPage = () => {
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
    };

    // ── Modals ──
    const renderSelectedModal = () => {
        if (!selectedApp) return null;

        return (
            <DriverDossier
                key={selectedApp.id}
                companyId={companyId}
                driverId={selectedApp.id}
                isOpen={true}
                onClose={() => setSelectedApp(null)}
                onDeleted={() => dashboard.refreshData()}
            />
        );
    };

    const getPageTitle = () => {
        switch (scope) {
            case 'applications': return 'Driver Applications';

            case 'company_leads': return 'Company Leads';
            case 'my_leads': return 'My Leads';
            default: return 'Candidates';
        }
    };

    const canAssign = isCompanyAdmin && (scope === 'company_leads');

    const showPipelineTabs =
        scope === 'applications' || scope === 'company_leads' || scope === 'my_leads';

    const getRowTone = (item) => {
        const level = staleContactMeta(item);
        if (!level) return 'neutral';
        return level === 'severe' ? 'danger' : 'warning';
    };

    // ── Column Config ──
    // ── Column Config ──
    // The original dependency array is preserved deliberately: the handlers
    // were captured without being listed before the split too (the
    // pre-existing exhaustive-deps warning), and listing them now would
    // change when the columns rebuild.
    const columns = useMemo(
        () => buildCandidateColumns({ handlePhoneClick }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- original deps preserved (see above)
        [scope],
    );
    return (
        <div className="h-full flex flex-col bg-ds-surface-subtle">
            {/* Page Header */}
            <div className="bg-ds-surface border-b border-ds-border-subtle px-ds-4 sm:px-ds-6 py-ds-4 shrink-0">
                <h1 className="text-ds-heading-lg font-bold text-ds-content">{getPageTitle()}</h1>
                <p className="text-ds-body text-ds-content-muted">Manage and track your driver pipeline.</p>
            </div>

            {/* List Content. It scrolls once the toolbar, its filter panel open,
                leaves the table less than its minimum height (on a phone, a
                tablet or a short window), so the rows and every filter stay in
                reach. The minimum is lower from lg up, where a toolbar is one
                row and a desktop window keeps its layout. */}
            <div className="flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-6 flex flex-col gap-0">
                <UndatedRecordsNotice count={dashboard.undatedCount} />
                {/* Toolbar — search, filters, timer, assign */}
                <div className="rounded-t-ds-lg border border-b-0 border-ds-border-subtle bg-ds-surface">
                    <DashboardToolbar
                        activeTab={scope}
                        dataCount={sortedData.length}
                        totalCount={dashboard.totalCount}
                        searchQuery={dashboard.searchQuery}
                        setSearchQuery={dashboard.setSearchQuery}
                        filters={dashboard.filters}
                        setFilters={dashboard.setFilters}
                        clearFilters={() => {
                            dashboard.setFilters({
                                state: '',
                                driverType: '',
                                dob: '',
                                assignee: '',
                                dateFilter: '',
                                myAssignmentsOnly: false,
                            });
                            dashboard.setSearchQuery('');
                        }}
                        selectedCount={selectedRowIds.length}
                        canAssign={canAssign}
                        onAssignLeads={() => handleOpenAssignment(selectedRowIds)}
                        teamMembers={dashboard.teamMembers}
                        showMyAssignmentsToggle={scope === 'applications' || scope === 'company_leads'}
                        myAssignmentsOnly={!!dashboard.filters.myAssignmentsOnly}
                        onToggleMyAssignments={(next) =>
                            dashboard.setFilters((prev) => ({ ...prev, myAssignmentsOnly: next }))
                        }
                        myAssignmentsLabel={scope === 'applications' ? 'My assignments' : 'My leads'}
                    />
                    {showPipelineTabs && (
                        /*
                         * `ChipGroup` supplies two things the hand-written strip
                         * did not have: a name for the set, and `aria-pressed` on
                         * each segment. Without them a screen-reader user heard
                         * six unrelated buttons and no indication of which one the
                         * table was filtered by.
                         */
                        <ChipGroup
                            ariaLabel="Pipeline segment"
                            className="px-4 py-3 border-t border-ds-border-subtle bg-ds-surface-subtle/60"
                        >
                            {pipelineTabs.map((tab) => (
                                <Chip
                                    key={tab.id}
                                    pressed={dashboard.pipelineSegment === tab.id}
                                    onClick={() => dashboard.setPipelineSegment(tab.id)}
                                >
                                    {tab.label}
                                </Chip>
                            ))}
                        </ChipGroup>
                    )}
                </div>

                {/* Candidate-list DataTable pilot */}
                <div className="flex-1 min-h-[448px] overflow-hidden lg:min-h-[240px]">
                    <DataTable
                        ariaLabel={`${getPageTitle()} table`}
                        data={sortedData}
                        columns={columns}
                        getRowTone={getRowTone}
                        sort={sort}
                        onSortChange={({ direction }) => setDateOrder(direction)}
                        getRowLabel={(item) => `Open driver dossier for ${getCandidateName(item)}`}
                        onRowActivate={setSelectedApp}
                        isLoading={dashboard.loading}
                        loadingLabel={`Loading ${getPageTitle().toLowerCase()}`}
                        empty={{
                            title: 'No records found.',
                            description: 'Try adjusting your search or filters.',
                        }}
                        error={(dashboard.error || dashboard.listCountError)
                            ? {
                                message: dashboard.error || dashboard.listCountError,
                                onRetry: dashboard.refreshData,
                            }
                            : undefined}
                        selection={canAssign ? {
                            selectedIds: selectedRowIds,
                            onToggleRow: toggleRowSelection,
                            onToggleAll: toggleSelectAllPage,
                            selectAllLabel: 'Select all candidates on this page',
                            getRowLabel: (item) => `Select ${getCandidateName(item)}`,
                        } : undefined}
                        density="comfortable"
                        minWidth="wide"
                        mobilePresentation="scroll"
                        pagination={{
                            currentPage: dashboard.currentPage,
                            totalPages: dashboard.totalPages,
                            onNext: dashboard.nextPage,
                            onPrev: dashboard.prevPage,
                            hasPrev: dashboard.currentPage > 1,
                            hasNext: dashboard.currentPage < dashboard.totalPages,
                            label: `Page ${dashboard.currentPage} of ${dashboard.totalPages || 1} · ${dashboard.totalCount} total`,
                        }}
                    />
                </div>
            </div>

            {/* Modals */}
            {renderSelectedModal()}

            {callModalData && (
                <CallOutcomeModal
                    lead={callModalData.lead}
                    companyId={companyId}
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
