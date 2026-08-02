import React, { useState, useEffect, useMemo } from 'react';
import { DashboardToolbar, useCompanyDashboard } from '@features/companies';
import { DataTable, defineTableColumns } from '@/design-system/components';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';

import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { LeadAssignmentModal } from '../components/LeadAssignmentModal';
import { DriverProfileModal } from '../components/modals/driver-dossier/DriverProfileModal';
import {
    Phone, User, Briefcase, MapPin, Calendar, ArrowUp, ArrowDown
} from 'lucide-react';
import { getFieldValue, formatPhoneNumber, toTitleCase } from '@shared/utils/helpers';
import { getStatusIcon } from '@shared/components/badges/statusIcon';

// ── Status pill styling ──
const getStatusPillStyle = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('hired') || s.includes('accepted') || s.includes('approved'))
        return 'bg-ds-status-accent-bg text-ds-status-accent-fg border-ds-status-accent-border';
    if (s.includes('rejected') || s.includes('disqualified') || s.includes('declined'))
        return 'bg-ds-status-danger-bg text-ds-status-danger-fg border-ds-status-danger-border';
    if (s.includes('offer') || s.includes('background'))
        return 'bg-ds-status-info-bg text-ds-status-info-fg border-ds-status-info-border';
    if (s.includes('contacted') || s.includes('attempted') || s.includes('review'))
        return 'bg-ds-status-neutral-bg text-ds-status-neutral-fg border-ds-status-neutral-border';
    if (s.includes('new') || s.includes('lead'))
        return 'bg-ds-status-success-bg text-ds-status-success-fg border-ds-status-success-border';
    return 'bg-ds-status-neutral-bg text-ds-status-neutral-fg border-ds-status-neutral-border';
};

// ── Call outcome pill ──
const getOutcomePillStyle = (outcome) => {
    const o = (outcome || '').toLowerCase();
    if (o.includes('connected') || o.includes('spoke') || o.includes('interested'))
        return 'bg-ds-status-success-bg text-ds-status-success-fg border-ds-status-success-border';
    if (o.includes('callback'))
        return 'bg-ds-status-info-bg text-ds-status-info-fg border-ds-status-info-border';
    if (o.includes('voicemail'))
        return 'bg-ds-status-warning-bg text-ds-status-warning-fg border-ds-status-warning-border';
    if (o.includes('no answer'))
        return 'bg-ds-status-danger-bg text-ds-status-danger-fg border-ds-status-danger-border';
    if (o.includes('not interested'))
        return 'bg-ds-status-neutral-bg text-ds-status-neutral-fg border-ds-status-neutral-border';
    return 'bg-ds-status-neutral-bg text-ds-status-neutral-fg border-ds-status-neutral-border';
};

const getCandidateName = (item) => item.fullName
    ? toTitleCase(item.fullName)
    : toTitleCase(`${item.firstName || 'Unknown'} ${item.lastName || 'Driver'}`.trim());

// ── Format Firestore timestamp to MM/DD/YYYY ──
const formatAddedDate = (item) => {
    const ts = item.submittedAt || item.createdAt;
    if (!ts) return null;
    try {
        const date = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        if (isNaN(date.getTime())) return null;
        return date.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    } catch {
        return null;
    }
};

/** >48h in Contact Attempt 1 (uses statusEnteredAt only). */
function staleContactMeta(item) {
    if (!item || item.status !== 'Contact Attempt 1') return null;
    const ts = item.statusEnteredAt;
    if (!ts || (typeof ts.seconds !== 'number' && !ts.toDate)) return null;
    try {
        const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
        const hours = (Date.now() - d.getTime()) / 3600000;
        if (hours <= 48) return null;
        return hours >= 72 ? 'severe' : 'warn';
    } catch {
        return null;
    }
}

// Segment ids map to APPLICATION_STATUS_GROUPS in @shared/utils/applicationStatus
// ('new' covers 'New' + 'New Application', 'hired' covers 'Hired' + 'Approved', ...).
const APPLICATION_PIPELINE_TABS = [
    { id: 'all', label: 'All Applications' },
    { id: 'new', label: 'New' },
    { id: 'hired', label: 'Hired' },
    { id: 'terminated', label: 'Terminated' },
    { id: 'declined', label: 'Declined' },
];

const LEAD_PIPELINE_TABS = [
    { id: 'all', label: 'All Leads' },
    { id: 'attempting', label: 'Attempting to Contact' },
    { id: 'in_process', label: 'In Process' },
    { id: 'interested', label: 'Interested' },
];

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
    const columns = useMemo(() => {
        const cols = [
            // Identity Cell: Name + Phone/Email
            {
                key: 'identity',
                header: 'Driver / Contact',
                rowHeader: true,
                width: 'xl',
                priority: 'primary',
                render: (item) => {
                    const name = getCandidateName(item);
                    const stale = staleContactMeta(item);

                    return (
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-semibold text-slate-900">{name}</p>
                                {stale && (
                                    <span
                                        className={`text-ds-xs font-bold uppercase px-2 py-0.5 rounded-full border ${stale === 'severe'
                                            ? 'bg-ds-status-danger-bg text-ds-status-danger-fg border-ds-status-danger-border'
                                            : 'bg-ds-status-warning-bg text-ds-status-warning-fg border-ds-status-warning-border'
                                            }`}
                                    >
                                        Stale CA1
                                    </span>
                                )}
                            </div>
                            <div className="mt-1">
                                <button
                                    type="button"
                                    onClick={(e) => handlePhoneClick(e, item)}
                                    aria-label={`Call ${name} at ${formatPhoneNumber(getFieldValue(item.phone))}`}
                                    className="min-h-8 text-ds-xs rounded-ds-sm px-2 inline-flex items-center gap-1 transition-colors border text-ds-content-secondary border-ds-border-subtle hover:bg-ds-surface-subtle hover:text-ds-content focus-visible:outline-none focus-visible:shadow-ds-focus"
                                >
                                    <Phone size={12} aria-hidden="true" />
                                    {formatPhoneNumber(getFieldValue(item.phone))}
                                </button>
                            </div>
                        </div>
                    );
                },
            },
        ];

        // Status pill
        cols.push({
            key: 'status',
            header: 'Status',
            align: 'center',
            width: 'sm',
            priority: 'primary',
            render: (item) => {
                // C3 (WCAG 1.4.1): icon shape + text, so status is never colour-only.
                const StatusIcon = getStatusIcon(item.status || 'New');
                return (
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-ds-xs font-semibold border ${getStatusPillStyle(item.status)}`}>
                        <StatusIcon size={12} aria-hidden="true" />
                        {item.status || 'New'}
                    </span>
                );
            },
        });


        // Qualifications: Position + Type + Experience + State
        cols.push({
            key: 'qualifications',
            header: 'Position / Type',
            width: 'lg',
            priority: 'secondary',
            render: (item) => {
                const position = item.positionApplyingTo || 'Driver';
                const types = Array.isArray(item.driverType) && item.driverType.length > 0
                    ? item.driverType.join(', ')
                    : (typeof item.driverType === 'string' && item.driverType ? item.driverType : 'Unspecified');

                return (
                    <div>
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                            <Briefcase size={12} className="text-ds-content-muted" aria-hidden="true" />
                            {position}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {(item.experience || item['experience-years']) && (
                                <span className="text-ds-xs text-ds-content-secondary font-medium bg-ds-surface-subtle px-1.5 py-0.5 rounded-ds-sm">
                                    {item.experience || item['experience-years']} Exp
                                </span>
                            )}
                            {item.state && (
                                <span className="flex items-center gap-0.5 text-ds-xs text-ds-content-secondary font-medium bg-ds-surface-subtle px-1.5 py-0.5 rounded-ds-sm">
                                    <MapPin size={12} className="text-ds-content-muted" aria-hidden="true" /> {item.state}
                                </span>
                            )}
                        </div>
                        <p className="text-ds-xs text-ds-content-muted font-medium mt-0.5 truncate" title={types}>
                            {types}
                        </p>
                    </div>
                );
            },
        });

        // Added Date — with inline sort arrows
        const isDateSorted = sortConfig.key === 'date';
        cols.push({
            key: 'addedDate',
            header: (
                <span className="inline-flex items-center justify-center gap-1">
                    <Calendar size={12} className="text-ds-content-muted" aria-hidden="true" />
                    Added Date
                    <span className="inline-flex items-center gap-0.5" onClick={e => e.stopPropagation()}>
                        {/* Up arrow = Earliest first (asc) */}
                        <button
                            type="button"
                            onClick={() => handleDateSort('asc')}
                            title="Earliest first"
                            aria-label="Sort by earliest added date"
                            aria-pressed={isDateSorted && sortConfig.direction === 'asc'}
                            className={`h-6 w-6 inline-flex items-center justify-center rounded-ds-sm leading-none transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${isDateSorted && sortConfig.direction === 'asc'
                                ? 'text-ds-action-primary'
                                : 'text-ds-content-muted hover:bg-ds-surface hover:text-ds-content'
                                }`}
                        >
                            <ArrowUp size={13} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                        {/* Down arrow = Latest first (desc) */}
                        <button
                            type="button"
                            onClick={() => handleDateSort('desc')}
                            title="Latest first"
                            aria-label="Sort by latest added date"
                            aria-pressed={isDateSorted && sortConfig.direction === 'desc'}
                            className={`h-6 w-6 inline-flex items-center justify-center rounded-ds-sm leading-none transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${isDateSorted && sortConfig.direction === 'desc'
                                ? 'text-ds-action-primary'
                                : 'text-ds-content-muted hover:bg-ds-surface hover:text-ds-content'
                                }`}
                        >
                            <ArrowDown size={13} strokeWidth={2.5} aria-hidden="true" />
                        </button>
                    </span>
                </span>
            ),
            align: 'center',
            width: 'md',
            priority: 'secondary',
            render: (item) => {
                const dateStr = formatAddedDate(item);
                if (!dateStr) {
                    return <span className="text-ds-xs text-ds-content-muted italic">—</span>;
                }
                return (
                    <span className="inline-flex items-center gap-1 text-ds-xs text-ds-content-secondary font-medium">
                        <Calendar size={12} className="text-ds-content-muted" aria-hidden="true" />
                        {dateStr}
                    </span>
                );
            },
        });

        // Last Call
        cols.push({
            key: 'lastCall',
            header: 'Last Call',
            align: 'center',
            width: 'xs',
            priority: 'tertiary',
            render: (item) => {
                if (!item.lastCallOutcome) {
                    return <span className="text-ds-xs text-ds-content-muted italic">—</span>;
                }
                return (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-ds-xs font-semibold border ${getOutcomePillStyle(item.lastCallOutcome)}`}>
                        {item.lastCallOutcome}
                    </span>
                );
            },
        });

        // Assignee
        cols.push({
            key: 'assignee',
            header: 'Recruiter',
            width: 'md',
            priority: 'secondary',
            render: (item) => {
                if (item.assignedToName) {
                    return (
                        <span className="inline-flex items-center gap-1.5 text-ds-xs font-medium text-ds-content bg-ds-surface-subtle px-2 py-1 rounded-full border border-ds-border-subtle">
                            <span className="w-5 h-5 bg-ds-status-accent-bg text-ds-status-accent-fg rounded-full flex items-center justify-center text-ds-xs font-bold" aria-hidden="true">
                                {item.assignedToName.charAt(0)}
                            </span>
                            {item.assignedToName}
                        </span>
                    );
                }
                return (
                    <span className="text-ds-xs text-ds-content-muted italic flex items-center gap-1">
                        <User size={12} aria-hidden="true" /> Unassigned
                    </span>
                );
            },
        });

        // Actions — hover reveal
        cols.push({
            key: 'actions',
            header: '',
            headerLabel: 'Actions',
            align: 'center',
            width: 'actions',
            priority: 'actions',
            stopPropagation: true,
            render: (item) => {
                const name = getCandidateName(item);
                return (
                    <div className="opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 transition-opacity duration-200">
                        <button
                            type="button"
                            onClick={(e) => handlePhoneClick(e, item)}
                            aria-label={`Call ${name}`}
                            className="h-9 w-9 inline-flex items-center justify-center text-ds-content-muted hover:text-ds-status-success-fg hover:bg-ds-status-success-bg rounded-ds-md transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus"
                            title="Call Driver"
                        >
                            <Phone size={16} aria-hidden="true" />
                        </button>
                    </div>
                );
            },
        });

        return defineTableColumns(cols);
    }, [scope, sortConfig]);

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Page Header */}
            <div className="bg-ds-surface border-b border-ds-border-subtle px-ds-4 sm:px-ds-6 py-ds-4 shrink-0">
                <h1 className="text-xl font-bold text-gray-900">{getPageTitle()}</h1>
                <p className="text-sm text-gray-500">Manage and track your driver pipeline.</p>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-hidden p-3 sm:p-6 flex flex-col gap-0">
                {/* Toolbar — search, filters, timer, assign */}
                <div className="bg-white rounded-t-xl border border-b-0 border-gray-200">
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
                        <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-gray-100 bg-slate-50/60">
                            {pipelineTabs.map((tab) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    onClick={() => dashboard.setPipelineSegment(tab.id)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${dashboard.pipelineSegment === tab.id
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
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
