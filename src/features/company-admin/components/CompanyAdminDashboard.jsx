// src/features/company-admin/components/CompanyAdminDashboard.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { auth } from '@lib/firebase';
import { getPortalUser } from '@features/auth';
import { useToast } from '@shared/components/feedback/ToastProvider';

import { useCompanyDashboard } from '@features/companies/hooks/useCompanyDashboard';
import { DashboardTable } from '@features/companies/components/DashboardTable';
import { StatCard } from '@features/companies/components/StatCard';

import { DriverSearchModal } from '@features/drivers/components/DriverSearchModal';
import { NotificationBell } from '@shared/components/feedback/NotificationBell';
import { CallOutcomeModal } from '@shared/components/modals/CallOutcomeModal';
import { CompanyBulkUpload } from './CompanyBulkUpload';
import { PerformanceWidget } from './PerformanceWidget';
const ApplicationDetailView = React.lazy(() => import('./ApplicationDetailView').then(m => ({ default: m.ApplicationDetailView })));
import { SafeHaulInfoModal } from '@shared/components/modals/SafeHaulInfoModal';
import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { SafeHaulLeadsDriverModal } from '@shared/components/modals/SafeHaulLeadsDriverModal';
import { LeadAssignmentModal } from './LeadAssignmentModal';
import { QuickLeadModal } from './modals/QuickLeadModal';

import { useOnboarding } from '@features/onboarding/hooks/useOnboarding';
import { OnboardingTour } from '@features/onboarding/components/OnboardingTour';

import {
    LogOut, Search, FileText, Settings, Zap, Briefcase,
    Upload, Replace, Users, ChevronDown, Layout, User,
    PenTool, MessageSquare, UserPlus // Icon for Documents
} from 'lucide-react';
import { Logo } from '@shared/components/Logo';


export function CompanyAdminDashboard() {
    // Force HMR Update

    // Fallback initials generator
    const getInitials = (name) => {
        if (!name) return 'CO';
        const parts = name.split(' ');
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    const { currentCompanyProfile, handleLogout, returnToCompanyChooser, currentUserClaims, currentUser } = useData();
    const { showError, showSuccess } = useToast();
    const navigate = useNavigate();

    const { showTour, completeTour } = useOnboarding(currentUser);

    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName;

    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    const dashboard = useCompanyDashboard(companyId);

    const [userName, setUserName] = useState('Admin User');
    const [userEmail, setUserEmail] = useState('');
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

    const [selectedApp, setSelectedApp] = useState(null);
    const [isDriverSearchOpen, setIsDriverSearchOpen] = useState(false);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [callModalData, setCallModalData] = useState(null);
    const [showSafeHaulInfo, setShowSafeHaulInfo] = useState(false);
    const [showFeatureLocked, setShowFeatureLocked] = useState(false);
    const [showQuickLeadModal, setShowQuickLeadModal] = useState(false);
    const [imgError, setImgError] = useState(false);

    // Assignment Logic
    const [assigningLeads, setAssigningLeads] = useState([]); // Array of IDs

    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged(async (user) => {
            if (user) {
                setUserEmail(user.email);
                const portalUserDoc = await getPortalUser(user.uid);
                if (portalUserDoc && portalUserDoc.name) setUserName(portalUserDoc.name);
            }
        });
        return () => unsubscribe();
    }, []);

    const handlePhoneClick = (e, item) => {
        if (e) e.stopPropagation();
        if (item && item.phone) {
            setCallModalData({ lead: item });
        } else {
            showError("No phone number available for this driver.");
        }
    };

    const handleSearchClick = () => {
        if (currentCompanyProfile?.features?.searchDB === true) {
            setIsDriverSearchOpen(true);
        } else {
            setShowFeatureLocked(true);
        }
    };

    const handleGoToLeads = () => {
        setShowFeatureLocked(false);
        dashboard.setActiveTab('find_driver');
    };

    const handleOpenAssignment = (selectedIds) => {
        setAssigningLeads(selectedIds);
    };

    const handleAssignmentComplete = () => {
        showSuccess("Leads assigned successfully.");
        dashboard.refreshData();
    };

    const getActiveIcon = () => {
        switch (dashboard.activeTab) {
            case 'applications': return <FileText size={18} className="text-blue-600" />;
            case 'find_driver': return <Zap size={18} className="text-purple-600" />;
            case 'company_leads': return <Briefcase size={18} className="text-orange-600" />;
            case 'my_leads': return <User size={18} className="text-green-600" />;
            default: return <Layout size={18} className="text-gray-600" />;
        }
    };

    const renderSelectedModal = () => {
        if (!selectedApp) return null;

        if (dashboard.activeTab === 'find_driver' || selectedApp.isPlatformLead) {
            return (
                <SafeHaulLeadsDriverModal
                    lead={selectedApp}
                    onClose={() => setSelectedApp(null)}
                    onCallStart={() => handlePhoneClick(null, selectedApp)}
                />
            );
        }

        return (
            <React.Suspense fallback={<div className="fixed inset-0 bg-white/50 z-[60] flex items-center justify-center backdrop-blur-sm"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div></div>}>
                <ApplicationDetailView
                    key={selectedApp.id}
                    companyId={companyId}
                    applicationId={selectedApp.id}
                    onClosePanel={() => setSelectedApp(null)}
                    onStatusUpdate={dashboard.refreshData}
                    isCompanyAdmin={isCompanyAdmin}
                    onPhoneClick={(e) => handlePhoneClick(e, selectedApp)}
                />
            </React.Suspense>
        );
    };

    // Determine if assignment is allowed in current tab
    const canAssign = isCompanyAdmin && (dashboard.activeTab === 'find_driver' || dashboard.activeTab === 'company_leads');

    return (
        <>
            <div id="company-admin-container" className="h-screen bg-gray-50 flex flex-col font-sans">

                <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shrink-0 px-6 py-3 shadow-sm">
                    <div className="flex justify-between items-center max-w-[1600px] mx-auto w-full">
                        <div className="flex items-center gap-3">
                            <div className="h-10 w-10 flex-shrink-0">
                                {currentCompanyProfile?.logoUrl && !imgError ? (
                                    <img
                                        src={currentCompanyProfile.logoUrl}
                                        alt={companyName}
                                        onError={() => setImgError(true)}
                                        className="h-full w-full object-contain rounded-lg shadow-sm"
                                    />
                                ) : (
                                    <div className="h-full w-full rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-bold text-sm shadow-md border border-white/20">
                                        {getInitials(companyName)}
                                    </div>
                                )}
                            </div>
                            <div>

                                <h1 className="text-lg font-bold text-gray-900 leading-tight">{companyName || "Company Dashboard"}</h1>
                                <p className="text-xs text-gray-500 font-medium">Recruiter Workspace</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">

                            {/* --- NEW: SEND DOCUMENT BUTTON --- */}
                            {isCompanyAdmin && (
                                <button
                                    onClick={() => navigate('/company/documents')}
                                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                                >
                                    <PenTool size={16} /> Documents
                                </button>
                            )}

                            {isCompanyAdmin && (
                                <button
                                    onClick={() => setIsUploadModalOpen(true)}
                                    className="hidden sm:flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-lg hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
                                >
                                    <Upload size={16} /> Import Leads
                                </button>
                            )}

                            <button
                                onClick={() => setShowQuickLeadModal(true)}
                                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 transition-all shadow-md"
                            >
                                <UserPlus size={16} /> Quick Add Lead
                            </button>

                            <button
                                onClick={handleSearchClick}
                                className="hidden sm:flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg"
                            >
                                <Search size={16} /> Search For Drivers
                            </button>

                            <div className="h-8 w-px bg-gray-200 mx-1"></div>

                            <NotificationBell userId={auth.currentUser?.uid} />

                            <div className="relative ml-2">
                                <button
                                    id="user-menu-btn"
                                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                                    className="flex items-center gap-2 focus:outline-none"
                                >
                                    <div className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 text-gray-600 flex items-center justify-center font-bold text-sm hover:bg-gray-200 transition">
                                        {userName.charAt(0).toUpperCase()}
                                    </div>
                                </button>
                                {isUserMenuOpen && (
                                    <div className="absolute top-full right-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden z-50 animate-in fade-in zoom-in-95 duration-100" onClick={() => setIsUserMenuOpen(false)}>
                                        <div className="p-3 border-b border-gray-100 bg-gray-50">
                                            <p className="text-sm font-bold text-gray-900 truncate">{userName}</p>
                                            <p className="text-xs text-gray-500 truncate">{userEmail}</p>
                                        </div>
                                        <nav className="p-1">
                                            <button onClick={() => navigate('/company/settings')} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"><Settings size={16} /> Settings</button>
                                            <button onClick={returnToCompanyChooser} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-700 hover:bg-gray-100 transition-colors"><Replace size={16} /> Switch Company</button>
                                            <div className="h-px bg-gray-100 my-1"></div>
                                            <button onClick={handleLogout} className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 transition-colors"><LogOut size={16} /> Logout</button>
                                        </nav>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </header>

                <div className="flex-1 overflow-hidden flex flex-col max-w-[1600px] mx-auto w-full p-4 sm:p-6">

                    {/* Mobile View Toggle - Hidden on MD+ */}
                    <div className="md:hidden mb-4 shrink-0">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5 px-1">Current View</label>
                        <div className="flex overflow-x-auto gap-2 p-1 no-scrollbar">
                            {[
                                { id: 'applications', label: 'Applications', count: dashboard.counts?.applications },
                                { id: 'find_driver', label: 'SafeHaul Leads', count: dashboard.counts?.platformLeads },
                                { id: 'company_leads', label: 'Company Leads', count: dashboard.counts?.companyLeads },
                                { id: 'my_leads', label: 'My Leads', count: dashboard.counts?.myLeads }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => dashboard.setActiveTab(tab.id)}
                                    className={`whitespace-nowrap px-4 py-2 rounded-lg font-bold text-sm transition-colors border ${dashboard.activeTab === tab.id
                                        ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                                        : 'bg-white text-gray-600 border-gray-200'
                                        }`}
                                >
                                    {tab.label} ({tab.count || 0})
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Desktop Grid - Visible on MD+ (Tablets & Desktops) */}
                    <div className="hidden md:grid md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6 shrink-0">
                        <StatCard
                            id="stat-card-applications"
                            title="Applications"
                            value={dashboard.counts?.applications || 0}
                            icon={<FileText size={20} />}
                            active={dashboard.activeTab === 'applications'}
                            colorClass="ring-blue-500 bg-blue-500"
                            onClick={() => dashboard.setActiveTab('applications')}
                        />
                        <StatCard
                            id="stat-card-find_driver"
                            title="SafeHaul Leads"
                            value={dashboard.counts?.platformLeads || 0}
                            icon={<Zap size={20} />}
                            active={dashboard.activeTab === 'find_driver'}
                            colorClass="ring-purple-500 bg-purple-500"
                            onClick={() => dashboard.setActiveTab('find_driver')}
                        />
                        <StatCard
                            id="stat-card-company_leads"
                            title="Company Leads"
                            value={dashboard.counts?.companyLeads || 0}
                            icon={<Briefcase size={20} />}
                            active={dashboard.activeTab === 'company_leads'}
                            colorClass="ring-orange-500 bg-orange-500"
                            onClick={() => dashboard.setActiveTab('company_leads')}
                        />
                        <StatCard
                            id="stat-card-my_leads"
                            title="My Leads"
                            value={dashboard.counts?.myLeads || 0}
                            icon={<User size={20} />}
                            active={dashboard.activeTab === 'my_leads'}
                            colorClass="ring-green-500 bg-green-500"
                            onClick={() => dashboard.setActiveTab('my_leads')}
                        />

                        <div className="md:col-span-3 lg:col-span-1">
                            <PerformanceWidget companyId={companyId} />
                        </div>
                    </div>

                    <div className="flex-1 flex flex-col overflow-hidden min-h-0 bg-white rounded-xl shadow-sm border border-gray-200">
                        <DashboardTable
                            activeTab={dashboard.activeTab}
                            loading={dashboard.loading}
                            data={dashboard.paginatedData}
                            totalCount={dashboard.totalCount}

                            selectedId={selectedApp?.id}
                            onSelect={setSelectedApp}
                            onPhoneClick={handlePhoneClick}

                            searchQuery={dashboard.searchQuery}
                            setSearchQuery={dashboard.setSearchQuery}

                            filters={dashboard.filters}
                            setFilters={dashboard.setFilters}

                            currentPage={dashboard.currentPage}
                            itemsPerPage={dashboard.itemsPerPage}
                            totalPages={dashboard.totalPages}
                            setItemsPerPage={dashboard.setItemsPerPage}
                            nextPage={dashboard.nextPage}
                            prevPage={dashboard.prevPage}

                            latestBatchTime={dashboard.latestBatchTime}
                            onShowSafeHaulInfo={() => setShowSafeHaulInfo(true)}

                            // Assignment Props
                            canAssign={canAssign}
                            onAssignLeads={handleOpenAssignment}
                        />

                    </div>
                </div>
            </div>

            {renderSelectedModal()}

            {isDriverSearchOpen && <DriverSearchModal onClose={() => setIsDriverSearchOpen(false)} />}

            {callModalData && (
                <CallOutcomeModal
                    lead={callModalData.lead}
                    companyId={companyId}
                    onClose={() => setCallModalData(null)}
                    onUpdate={(result) => {
                        dashboard.refreshData();
                        if (result?.converted && result.applicationId) {
                            dashboard.setActiveTab('applications');
                            // Small delay to allow tab switch then open modal
                            setTimeout(() => {
                                setSelectedApp({ id: result.applicationId });
                            }, 500);
                        }
                    }}
                />
            )}

            {isUploadModalOpen && isCompanyAdmin && (
                <CompanyBulkUpload
                    companyId={companyId}
                    onClose={() => setIsUploadModalOpen(false)}
                    onUploadComplete={dashboard.refreshData}
                />
            )}

            {showSafeHaulInfo && (
                <SafeHaulInfoModal onClose={() => setShowSafeHaulInfo(false)} />
            )}

            {showFeatureLocked && (
                <FeatureLockedModal
                    onClose={() => setShowFeatureLocked(false)}
                    onGoToLeads={handleGoToLeads}
                    featureName="Search For Drivers"
                />
            )}

            {/* Assignment Modal */}
            {assigningLeads.length > 0 && (
                <LeadAssignmentModal
                    companyId={companyId}
                    selectedLeadIds={assigningLeads}
                    onClose={() => setAssigningLeads([])}
                    onSuccess={handleAssignmentComplete}
                />
            )}

            {showTour && <OnboardingTour onComplete={completeTour} />}

            {showQuickLeadModal && (
                <QuickLeadModal
                    companyId={companyId}
                    onClose={() => setShowQuickLeadModal(false)}
                    onSuccess={() => {
                        dashboard.refreshData();
                        dashboard.setActiveTab('company_leads');
                    }}
                />
            )}
        </>
    );
}