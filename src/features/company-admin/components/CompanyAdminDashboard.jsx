import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { auth } from '@lib/firebase';
import { getPortalUser } from '@features/auth';
import { useToast } from '@shared/components/feedback/ToastProvider';

import { useCompanyDashboard } from '@features/companies/hooks/useCompanyDashboard';
import { StatCard } from '@features/companies/components/StatCard';

import { DriverSearchModal } from '@features/drivers/components/DriverSearchModal';
import { CompanyBulkUpload } from './CompanyBulkUpload';
import { InlineLeaderboard } from './InlineLeaderboard';
import { FeatureLockedModal } from '@shared/components/modals/FeatureLockedModal';
import { QuickLeadModal } from './modals/QuickLeadModal';

import { useOnboarding } from '@features/onboarding/hooks/useOnboarding';
import { OnboardingTour } from '@features/onboarding/components/OnboardingTour';

import {
    Search, FileText, Zap, Briefcase, User
} from 'lucide-react';

export function CompanyAdminDashboard() {
    const { currentCompanyProfile, returnToCompanyChooser, currentUserClaims, currentUser, logout } = useData();
    const { showError } = useToast();
    const navigate = useNavigate();

    const { showTour, completeTour } = useOnboarding(currentUser);

    const companyId = currentCompanyProfile?.id;
    const companyName = currentCompanyProfile?.companyName;

    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';

    // We only need the counts and loading state from the hook, not the full table data
    const dashboard = useCompanyDashboard(companyId);

    const [userName, setUserName] = useState('Admin User');
    const [userEmail, setUserEmail] = useState('');

    const [isDriverSearchOpen, setIsDriverSearchOpen] = useState(false);
    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
    const [showFeatureLocked, setShowFeatureLocked] = useState(false);
    const [showQuickLeadModal, setShowQuickLeadModal] = useState(false);

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

    const getInitials = (name) => {
        if (!name) return 'CO';
        const parts = name.split(' ');
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    const handleSearchClick = () => {
        if (currentCompanyProfile?.features?.searchDB === true) {
            setIsDriverSearchOpen(true);
        } else {
            setShowFeatureLocked(true);
        }
    };

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch (error) {
            console.error('Logout failed', error);
        }
    };

    return (
        <div id="company-admin-container" className="h-full bg-gray-50 flex flex-col font-sans overflow-y-auto">

            {/* Main Content */}
            <div className="flex-1 max-w-[1600px] w-full mx-auto p-4 sm:p-6 lg:p-8">

                {/* Welcome Section */}
                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-gray-900">Welcome back, {userName}</h1>
                    <p className="text-gray-500 mt-1">Here's what's happening at {companyName} today.</p>
                </div>

                {/* KPI Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                    <StatCard
                        id="stat-card-applications"
                        title="Applications"
                        value={dashboard.counts?.applications || 0}
                        icon={<FileText size={20} />}
                        colorClass="ring-blue-500 bg-blue-500"
                        onClick={() => navigate('/company/drivers/applications')}
                        active={false}
                    />
                    <StatCard
                        id="stat-card-find_driver"
                        title="SafeHaul Leads"
                        value={dashboard.counts?.platformLeads || 0}
                        icon={<Zap size={20} />}
                        colorClass="ring-purple-500 bg-purple-500"
                        onClick={() => navigate('/company/drivers/leads/safehaul')}
                        active={false}
                    />
                    <StatCard
                        id="stat-card-company_leads"
                        title="Company Leads"
                        value={dashboard.counts?.companyLeads || 0}
                        icon={<Briefcase size={20} />}
                        colorClass="ring-orange-500 bg-orange-500"
                        onClick={() => navigate('/company/drivers/leads/company')}
                        active={false}
                    />
                    <StatCard
                        id="stat-card-my_leads"
                        title="My Leads"
                        value={dashboard.counts?.myLeads || 0}
                        icon={<User size={20} />}
                        colorClass="ring-green-500 bg-green-500"
                        onClick={() => navigate('/company/drivers/leads/my')}
                        active={false}
                    />
                </div>

                {/* Leaderboard & CTA */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-2">
                        <InlineLeaderboard companyId={companyId} />
                    </div>

                    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col items-center justify-center text-center">
                        <div className="bg-blue-50 p-4 rounded-full mb-4">
                            <Search size={32} className="text-blue-600" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Need more drivers?</h3>
                        <p className="text-gray-500 mb-6 text-sm">Search the SafeHaul database to find qualified candidates matching your criteria.</p>
                        <button
                            onClick={handleSearchClick}
                            className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
                        >
                            Search Database
                        </button>
                    </div>
                </div>
            </div>

            {/* Modals and Overlays */}
            {isDriverSearchOpen && <DriverSearchModal onClose={() => setIsDriverSearchOpen(false)} />}

            {isUploadModalOpen && isCompanyAdmin && (
                <CompanyBulkUpload
                    companyId={companyId}
                    onClose={() => setIsUploadModalOpen(false)}
                    onUploadComplete={dashboard.refreshData}
                />
            )}

            {showFeatureLocked && (
                <FeatureLockedModal
                    onClose={() => setShowFeatureLocked(false)}
                    onGoToLeads={() => {
                        setShowFeatureLocked(false);
                        navigate('/company/drivers/leads/safehaul');
                    }}
                    featureName="Search For Drivers"
                />
            )}

            {showQuickLeadModal && (
                <QuickLeadModal
                    companyId={companyId}
                    onClose={() => setShowQuickLeadModal(false)}
                    onSuccess={() => {
                        dashboard.refreshData();
                        navigate('/company/drivers/leads/company');
                    }}
                />
            )}

            {showTour && <OnboardingTour onComplete={completeTour} />}
        </div>
    );
}