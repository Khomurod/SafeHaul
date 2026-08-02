import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { auth } from '@lib/firebase';
import { getPortalUser } from '@features/auth';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Button, Card, MetricCard } from '@/design-system/components';
import {
    PageContainer,
    PageHeader,
    ResponsiveGrid,
    Section,
    Stack,
} from '@/design-system/layouts';
import { useCompanyDashboard } from '@features/companies';

import { CompanyBulkUpload } from './CompanyBulkUpload';
import { InlineLeaderboard } from './InlineLeaderboard';
import { QuickLeadModal } from './modals/QuickLeadModal';

import { useOnboarding } from '@features/onboarding/hooks/useOnboarding';
import { OnboardingTour } from '@features/onboarding/components/OnboardingTour';

import {
    FileText, Briefcase, User, CheckCircle
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

    const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
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

    const handleLogout = async () => {
        try {
            await logout();
            navigate('/login');
        } catch (error) {
            console.error('Logout failed', error);
        }
    };

    return (
        <div id="company-admin-container" className="min-h-full bg-ds-canvas">
            <PageContainer>
                <Stack gap="lg">
                    <PageHeader
                        title={`Welcome back, ${userName}`}
                        description={`Here's what's happening at ${companyName} today.`}
                    />

                    <Section aria-label="Company activity summary">
                    {dashboard.statsFetchError && (
                        <Card
                            padding="sm"
                            className="mb-4 flex flex-wrap items-center justify-between gap-2 border-ds-status-warning-border bg-ds-status-warning-bg text-ds-status-warning-fg"
                            role="status"
                        >
                            <span>Some dashboard numbers could not load: {dashboard.statsFetchError}</span>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => dashboard.refreshData()}
                            >
                                Retry
                            </Button>
                        </Card>
                    )}
                        <ResponsiveGrid minItemWidth="210px">
                            <MetricCard
                                id="stat-card-applications"
                                label="Applications"
                                value={dashboard.counts?.applications || 0}
                                icon={<FileText size={20} />}
                                tone="info"
                                onActivate={() => navigate('/company/drivers/applications')}
                            />

                            <MetricCard
                                id="stat-card-company_leads"
                                label="Company Leads"
                                value={dashboard.counts?.companyLeads || 0}
                                icon={<Briefcase size={20} />}
                                tone="warning"
                                onActivate={() => navigate('/company/drivers/leads/company')}
                            />
                            <MetricCard
                                id="stat-card-my_leads"
                                label="My Leads"
                                value={dashboard.counts?.myLeads || 0}
                                icon={<User size={20} />}
                                tone="accent"
                                onActivate={() => navigate('/company/drivers/leads/my')}
                            />
                            <MetricCard
                                id="stat-card-hired"
                                label="Hired"
                                value={dashboard.counts?.hired || 0}
                                icon={<CheckCircle size={20} />}
                                tone="success"
                                onActivate={() => navigate('/company/drivers/applications')}
                            />
                        </ResponsiveGrid>
                    </Section>

                    <Section aria-label="Team performance">
                        <InlineLeaderboard companyId={companyId} />
                    </Section>
                </Stack>
            </PageContainer>

            {/* Modals and Overlays */}
            {isUploadModalOpen && isCompanyAdmin && (
                <CompanyBulkUpload
                    companyId={companyId}
                    onClose={() => setIsUploadModalOpen(false)}
                    onUploadComplete={dashboard.refreshData}
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
