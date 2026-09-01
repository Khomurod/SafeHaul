import React, { useState, useEffect, useMemo } from 'react';
import { DashboardToolbar, useCompanyDashboard } from '@features/companies';
import { DataTable } from '@/design-system/components';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';

import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { LeadAssignmentModal } from '../components/LeadAssignmentModal';
import { DriverProfileModal } from '../components/modals/driver-dossier/DriverProfileModal';

import { buildCandidateColumns, getCandidateName, staleContactMeta, APPLICATION_PIPELINE_TABS, LEAD_PIPELINE_TABS } from './candidateListColumns';

export const CompanyCandidatesListPage = ({ scope }) => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const companyId = currentCompanyProfile?.id;

    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    const dashboard = useCompanyDashboard(companyId);
    const { showError, showSuccess } = useToast();

    // Local State
    const [selectedApp, setSelectedApp] = useState(null);
    const [callModalData, setCallModalData] = useState(null);
    const [assigningLeads, setAssigningLeads] = useState([]);
    const [selectedRowIds, setSelectedRowIds] = useState([]);

    // Sorting — date sort lives here; other sortConfig keys reserved for future use
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

    // Toggle date sort direction on arrow click
    const handleDateSort = (direction) => {
        setSortConfig(prev =>
            prev.key === 'date' && prev.direction === direction
                ? { key: null, direction: 'asc' }   // clicking same arrow again clears sort
                : { key: 'date', direction }
        );
    };

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
    ]);

    // Sorted data
    const sortedData = useMemo(() => {
        let items = [...dashboard.paginatedData];
        if (sortConfig.key) {
            items.sort((a, b) => {
                let aVal, bVal;
                if (sortConfig.key === 'name') {
                    aVal = `${a.firstName || ''} ${a.lastName || ''}`.toLowerCase();
                    bVal = `${b.firstName || ''} ${b.lastName || ''}`.toLowerCase();
                } else if (sortConfig.key === 'date') {
                    aVal = a.submittedAt?.seconds || a.createdAt?.seconds || 0;
                    bVal = b.submittedAt?.seconds || b.createdAt?.seconds || 0;
                } else {
                    aVal = a[sortConfig.key];
                    bVal = b[sortConfig.key];
                }
                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return items;
    }, [dashboard.paginatedData, sortConfig]);

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
            <DriverProfileModal
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

    const pipelineTabs =
        scope === 'applications' ? APPLICATION_PIPELINE_TABS : LEAD_PIPELINE_TABS;

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
        () => buildCandidateColumns({ sortConfig, handleDateSort, handlePhoneClick }),
        // eslint-disable-next-line react-hooks/exhaustive-deps -- original deps preserved (see above)
        [scope, sortConfig],
    );
    return (
        <div className="h-full flex flex-col bg-ds-surface-subtle">
            {/* Page Header */}
            <div className="bg-ds-surface border-b border-ds-border-subtle px-ds-4 sm:px-ds-6 py-ds-4 shrink-0">
                <h1 className="text-ds-heading-lg font-bold text-ds-content">{getPageTitle()}</h1>
                <p className="text-ds-body text-ds-content-muted">Manage and track your driver pipeline.</p>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-hidden p-3 sm:p-6 flex flex-col gap-0">
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
                        latestBatchTime={dashboard.latestBatchTime}
                        visibleColumns={[]}
                        setVisibleColumns={() => { }}
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
                        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-ds-border-subtle bg-ds-surface-subtle/60">
                            {pipelineTabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => dashboard.setPipelineSegment(tab.id)}
                                    className={`px-3 py-1.5 rounded-ds-full text-ds-xs font-semibold border transition-colors ${dashboard.pipelineSegment === tab.id
                                        ? 'bg-ds-action-primary text-ds-content-inverse border-ds-action-primary shadow-ds-sm'
                                        : 'bg-ds-surface text-ds-content-secondary border-ds-border-subtle hover:border-ds-border'
                                        }`}
                                >
                                    {tab.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Candidate-list DataTable pilot */}
                <div className="flex-1 overflow-hidden">
                    <DataTable
                        ariaLabel={`${getPageTitle()} table`}
                        data={sortedData}
                        columns={columns}
                        getRowTone={getRowTone}
                        getRowLabel={(item) => `Open driver dossier for ${getCandidateName(item)}`}
                        onRowActivate={setSelectedApp}
                        isLoading={dashboard.loading}
                        loadingLabel={`Loading ${getPageTitle().toLowerCase()}`}
                        empty={{
                            title: 'No records found.',
                            description: 'Try adjusting your search or filters.',
                        }}
                        error={(dashboard.error || dashboard.statsFetchError || dashboard.listCountError)
                            ? {
                                message: dashboard.error || dashboard.statsFetchError || dashboard.listCountError,
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
