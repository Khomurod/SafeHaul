import React, { useState, useEffect, useMemo } from 'react';
import { useCompanyDashboard } from '@features/companies/hooks/useCompanyDashboard';
import { DashboardToolbar } from '@features/companies/components/DashboardToolbar';
import { ModernDriverTable } from '@shared/components/table';
import { useData } from '@/context/DataContext';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { SafeHaulLeadsDriverModal } from '@shared/components/modals/SafeHaulLeadsDriverModal';
import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { LeadAssignmentModal } from '../components/LeadAssignmentModal';
import { DriverProfileModal } from '../components/modals/driver-dossier/DriverProfileModal';
import {
    Phone, Lock, Zap, User, Briefcase, MapPin
} from 'lucide-react';
import { getFieldValue, formatPhoneNumber, toTitleCase } from '@shared/utils/helpers';

// ── Status pill styling ──
const getStatusPillStyle = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('hired') || s.includes('accepted') || s.includes('approved'))
        return 'bg-purple-50 text-purple-700 border-purple-200/60';
    if (s.includes('rejected') || s.includes('disqualified') || s.includes('declined'))
        return 'bg-red-50 text-red-700 border-red-200/60';
    if (s.includes('offer') || s.includes('background'))
        return 'bg-indigo-50 text-indigo-700 border-indigo-200/60';
    if (s.includes('contacted') || s.includes('attempted') || s.includes('review'))
        return 'bg-slate-100 text-slate-600 border-slate-200/60';
    if (s.includes('new') || s.includes('lead'))
        return 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
    return 'bg-slate-50 text-slate-600 border-slate-200/60';
};

// ── Call outcome pill ──
const getOutcomePillStyle = (outcome) => {
    const o = (outcome || '').toLowerCase();
    if (o.includes('connected') || o.includes('spoke') || o.includes('interested'))
        return 'bg-emerald-50 text-emerald-700 border-emerald-200/60';
    if (o.includes('callback'))
        return 'bg-blue-50 text-blue-700 border-blue-200/60';
    if (o.includes('voicemail'))
        return 'bg-amber-50 text-amber-700 border-amber-200/60';
    if (o.includes('no answer'))
        return 'bg-red-50 text-red-700 border-red-200/60';
    if (o.includes('not interested'))
        return 'bg-slate-100 text-slate-500 border-slate-200/60';
    return 'bg-slate-50 text-slate-500 border-slate-100';
};


export const CompanyCandidatesListPage = ({ scope }) => {
    const { currentCompanyProfile, currentUserClaims } = useData();
    const companyId = currentCompanyProfile?.id;

    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    const dashboard = useCompanyDashboard(companyId, scope);
    const { showError, showSuccess } = useToast();

    // Local State
    const [selectedApp, setSelectedApp] = useState(null);
    const [callModalData, setCallModalData] = useState(null);
    const [assigningLeads, setAssigningLeads] = useState([]);
    const [selectedRowIds, setSelectedRowIds] = useState([]);

    // Sorting
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });

    // Force hook to respect the scope prop
    useEffect(() => {
        if (scope && dashboard.activeTab !== scope) {
            dashboard.setActiveTab(scope);
        }
    }, [scope]);

    // Reset selection on data changes
    useEffect(() => {
        setSelectedRowIds([]);
    }, [scope, dashboard.currentPage, dashboard.searchQuery]);

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
                    aVal = a.isPlatformLead ? a.distributedAt?.seconds : (a.submittedAt?.seconds || a.createdAt?.seconds);
                    bVal = b.isPlatformLead ? b.distributedAt?.seconds : (b.submittedAt?.seconds || b.createdAt?.seconds);
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
        if (selectedRowIds.length === sortedData.length) {
            setSelectedRowIds([]);
        } else {
            setSelectedRowIds(sortedData.map(d => d.id));
        }
    };

    // ── Modals ──
    const renderSelectedModal = () => {
        if (!selectedApp) return null;
        if (scope === 'find_driver' || selectedApp.isPlatformLead) {
            return (
                <SafeHaulLeadsDriverModal
                    lead={selectedApp}
                    onClose={() => setSelectedApp(null)}
                    onCallStart={() => handlePhoneClick(null, selectedApp)}
                />
            );
        }
        return (
            <DriverProfileModal
                key={selectedApp.id}
                companyId={companyId}
                driverId={selectedApp.id}
                isOpen={true}
                onClose={() => setSelectedApp(null)}
            />
        );
    };

    const getPageTitle = () => {
        switch (scope) {
            case 'applications': return 'Driver Applications';
            case 'find_driver': return 'SafeHaul Leads';
            case 'company_leads': return 'Company Leads';
            case 'my_leads': return 'My Leads';
            default: return 'Candidates';
        }
    };

    const canAssign = isCompanyAdmin && (scope === 'find_driver' || scope === 'company_leads');

    // ── Column Config ──
    const columns = useMemo(() => {
        const cols = [
            // Identity Cell: Name + Phone/Email
            {
                key: 'identity',
                header: 'Driver / Contact',
                render: (item) => {
                    const name = item.fullName
                        ? toTitleCase(item.fullName)
                        : toTitleCase(`${item.firstName || 'Unknown'} ${item.lastName || 'Driver'}`.trim());
                    const isSafeHaul = item.isPlatformLead === true;

                    return (
                        <div className="min-w-[200px]">
                            <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">{name}</p>
                                {isSafeHaul && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-50 text-purple-700 uppercase">
                                        <Zap size={9} className="mr-0.5 fill-purple-700" /> Lead
                                    </span>
                                )}
                            </div>
                            <div className="mt-1">
                                <button
                                    onClick={(e) => handlePhoneClick(e, item)}
                                    className={`text-xs rounded px-2 py-0.5 inline-flex items-center gap-1 transition-colors border ${isSafeHaul
                                        ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                                        : 'text-slate-500 border-slate-200 hover:bg-slate-100 hover:text-slate-700'
                                        }`}
                                >
                                    {isSafeHaul ? <Lock size={10} /> : <Phone size={11} />}
                                    {isSafeHaul ? 'Click to contact' : formatPhoneNumber(getFieldValue(item.phone))}
                                </button>
                            </div>
                        </div>
                    );
                },
                stopPropagation: false,
            },
        ];

        // Status — hidden for SafeHaul Leads
        if (scope !== 'find_driver') {
            cols.push({
                key: 'status',
                header: 'Status',
                headerClassName: 'text-center',
                cellClassName: 'text-center',
                render: (item) => (
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${getStatusPillStyle(item.status)}`}>
                        {item.status || 'New'}
                    </span>
                ),
            });
        }

        // Qualifications: Position + Type + Experience + State
        cols.push({
            key: 'qualifications',
            header: 'Position / Type',
            render: (item) => {
                const position = item.positionApplyingTo || 'Driver';
                const types = Array.isArray(item.driverType) && item.driverType.length > 0
                    ? item.driverType.join(', ')
                    : (typeof item.driverType === 'string' && item.driverType ? item.driverType : 'Unspecified');

                return (
                    <div className="min-w-[140px]">
                        <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                            <Briefcase size={12} className="text-slate-400" />
                            {position}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {(item.experience || item['experience-years']) && (
                                <span className="text-[10px] text-slate-500 font-medium bg-slate-50 px-1.5 py-0.5 rounded">
                                    {item.experience || item['experience-years']} Exp
                                </span>
                            )}
                            {item.state && (
                                <span className="flex items-center gap-0.5 text-[10px] text-slate-500 font-medium bg-slate-50 px-1.5 py-0.5 rounded">
                                    <MapPin size={9} className="text-slate-400" /> {item.state}
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-medium mt-0.5 truncate max-w-[150px]" title={types}>
                            {types}
                        </p>
                    </div>
                );
            },
        });

        // Last Call
        cols.push({
            key: 'lastCall',
            header: 'Last Call',
            headerClassName: 'text-center',
            cellClassName: 'text-center',
            render: (item) => {
                if (!item.lastCallOutcome) {
                    return <span className="text-[10px] text-slate-300 italic">—</span>;
                }
                return (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${getOutcomePillStyle(item.lastCallOutcome)}`}>
                        {item.lastCallOutcome}
                    </span>
                );
            },
        });

        // Assignee
        cols.push({
            key: 'assignee',
            header: 'Recruiter',
            render: (item) => {
                if (item.assignedToName) {
                    return (
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-50 px-2 py-1 rounded-full border border-slate-200">
                            <div className="w-4 h-4 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-[8px] font-bold">
                                {item.assignedToName.charAt(0)}
                            </div>
                            {item.assignedToName}
                        </span>
                    );
                }
                return (
                    <span className="text-xs text-slate-400 italic flex items-center gap-1">
                        <User size={12} /> Unassigned
                    </span>
                );
            },
        });

        // Actions — hover reveal
        cols.push({
            key: 'actions',
            header: '',
            headerClassName: 'w-[80px]',
            cellClassName: 'w-[80px]',
            stopPropagation: true,
            render: (item) => (
                <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    <button
                        onClick={(e) => handlePhoneClick(e, item)}
                        className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        title="Call Driver"
                    >
                        <Phone size={15} />
                    </button>
                </div>
            ),
        });

        return cols;
    }, [scope]);

    return (
        <div className="h-full flex flex-col bg-gray-50">
            {/* Page Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 shrink-0">
                <h1 className="text-xl font-bold text-gray-900">{getPageTitle()}</h1>
                <p className="text-sm text-gray-500">Manage and track your driver pipeline.</p>
            </div>

            {/* List Content */}
            <div className="flex-1 overflow-hidden p-6 flex flex-col gap-0">
                {/* Toolbar — search, filters, timer, assign */}
                <div className="bg-white rounded-t-xl border border-b-0 border-gray-200">
                    <DashboardToolbar
                        activeTab={scope}
                        dataCount={sortedData.length}
                        totalCount={dashboard.totalCount}
                        searchQuery={dashboard.searchQuery}
                        setSearchQuery={dashboard.setSearchQuery}
                        filters={dashboard.filters}
                        setFilters={(key, val) => dashboard.setFilters(prev => ({ ...prev, [key]: val }))}
                        clearFilters={() => {
                            dashboard.setFilters({ state: '', driverType: '', dob: '', assignee: '' });
                            dashboard.setSearchQuery('');
                        }}
                        latestBatchTime={dashboard.latestBatchTime}
                        visibleColumns={[]}
                        setVisibleColumns={() => { }}
                        selectedCount={selectedRowIds.length}
                        canAssign={canAssign}
                        onAssignLeads={() => handleOpenAssignment(selectedRowIds)}
                        teamMembers={dashboard.teamMembers}
                    />
                </div>

                {/* Modern Table */}
                <div className="flex-1 overflow-hidden">
                    <ModernDriverTable
                        data={sortedData}
                        columns={columns}
                        onRowClick={setSelectedApp}
                        isLoading={dashboard.loading}
                        emptyMessage="No records found."
                        showCheckboxes={canAssign}
                        selectedIds={selectedRowIds}
                        onToggleSelect={(id) => toggleRowSelection(id)}
                        onToggleSelectAll={toggleSelectAllPage}
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
