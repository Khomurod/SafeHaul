import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import {
    Building, User, CreditCard,
    Blocks, ArrowLeft, Users, Mail, MessageSquare, Send
} from 'lucide-react';

import { SmsSettingsTab } from './SmsSettingsTab';

import { AutomatedSmsTab } from './AutomatedSmsTab';
import { CompanyProfileTab } from './CompanyProfileTab';
import { TeamManagementTab } from './TeamManagementTab';
import { EmailSettingsTab } from './EmailSettingsTab';
import { PersonalProfileTab } from './PersonalProfileTab';
import { IntegrationsTab } from './IntegrationsTab';
import { BillingTab } from './BillingTab';
import { ManageTeamModal } from '@shared/components/modals';
import { Button, SectionNavigation } from '@/design-system/components';
import { PageHeader } from '@/design-system/layouts';

export function CompanySettings() {
    const { currentCompanyProfile, currentUser, currentUserClaims } = useData();
    const [activeTab, setActiveTab] = useState('company');
    const [showManageTeam, setShowManageTeam] = useState(false);
    const navigate = useNavigate();

    const isCompanyAdmin = currentUserClaims?.roles?.[currentCompanyProfile?.id] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';
    const navigationGroups = [
        {
            id: 'organization',
            label: 'Organization',
            items: [
                { id: 'company', label: 'Company Profile', icon: Building },
                { id: 'team', label: 'Team & Users', icon: Users },
            ],
        },
        {
            id: 'communication',
            label: 'Communication',
            items: [
                { id: 'email', label: 'Email Settings', icon: Mail },
                { id: 'sms', label: 'SMS Settings', icon: MessageSquare },
                { id: 'automated_sms', label: 'Automated SMS', icon: Send },
            ],
        },
        ...(currentCompanyProfile?.features?.callTracking !== false
            ? [{
                id: 'revenue',
                label: 'Revenue & Reach',
                items: [
                    { id: 'integrations', label: 'Integrations', icon: Blocks },
                ],
            }]
            : []),
        {
            id: 'account',
            label: 'Account Control',
            items: [
                { id: 'billing', label: 'Billing & Plan', icon: CreditCard },
                { id: 'personal', label: 'Security Profile', icon: User },
            ],
        },
    ];

    // Redirect non-admins back to dashboard
    if (!isCompanyAdmin && currentCompanyProfile) {
        return <Navigate to="/company/dashboard" replace />;
    }

    const renderContent = () => {
        switch (activeTab) {
            case 'company':
                return (
                    <CompanyProfileTab
                        currentCompanyProfile={currentCompanyProfile}
                    />
                );
            case 'team':
                return (
                    <TeamManagementTab
                        currentCompanyProfile={currentCompanyProfile}
                        isCompanyAdmin={isCompanyAdmin}
                        onShowManageTeam={() => setShowManageTeam(true)}
                    />
                );
            case 'personal':
                return (
                    <PersonalProfileTab
                        currentUser={currentUser}
                        currentCompanyProfile={currentCompanyProfile}
                    />
                );
            case 'email':
                return (
                    <EmailSettingsTab
                        currentCompanyProfile={currentCompanyProfile}
                    />
                );
            case 'sms':
                return (
                    <SmsSettingsTab currentCompanyProfile={currentCompanyProfile} />
                );
            case 'automated_sms':
                return (
                    <AutomatedSmsTab companyId={currentCompanyProfile?.id} />
                );
            case 'integrations':
                return <IntegrationsTab />;
            case 'billing':
                return <BillingTab currentCompanyProfile={currentCompanyProfile} />;
            default:
                return <div className="p-ds-10 text-center text-ds-content-muted">Select a tab to view settings.</div>;
        }
    };

    if (!currentCompanyProfile) return null;

    return (
        <div
            className="min-h-screen min-w-0 bg-ds-canvas text-ds-content"
            data-testid="company-settings-shell"
        >
            <div className="min-h-16 bg-ds-surface border-b border-ds-border-subtle mb-ds-8 flex items-center px-ds-4 sm:px-ds-6 lg:px-ds-8 sticky top-0 z-10">
                <Button
                    variant="ghost"
                    justify="start"
                    onClick={() => navigate('/company/dashboard')}
                >
                    <ArrowLeft size={20} aria-hidden="true" />
                    Back to Dashboard
                </Button>
            </div>
            <div className="max-w-7xl mx-auto px-ds-4 sm:px-ds-6 lg:px-ds-8 pb-20">
                {/*
                  Every other tab renders no top-level heading at all (several
                  use a bare `<h2>`, several use none), so a screen-reader user
                  landing on them heard an unnamed page. The Personal Profile
                  tab is the one exception — it already renders its own `<h1>`
                  via `PageHeader` — so this shell heading is suppressed there
                  rather than duplicating it.
                */}
                {activeTab !== 'personal' && (
                    <PageHeader title="Company Settings" className="mb-ds-6" />
                )}
                <div className="flex min-w-0 flex-col xl:flex-row gap-ds-8">
                    <aside className="w-full min-w-0 xl:w-64 flex-shrink-0">
                        <SectionNavigation
                            label="Company settings sections"
                            groups={navigationGroups}
                            currentId={activeTab}
                            onSelect={setActiveTab}
                            controlsId="company-settings-content"
                            mobileLayout="grid"
                            className="xl:sticky xl:top-24"
                        />
                    </aside>

                    <section
                        id="company-settings-content"
                        className="flex-1 min-w-0 min-h-[600px] relative"
                        aria-label="Company settings content"
                    >
                        {renderContent()}
                    </section>
                </div>
            </div>

            {showManageTeam && (
                <ManageTeamModal
                    companyId={currentCompanyProfile.id}
                    onClose={() => setShowManageTeam(false)}
                />
            )}
        </div>
    );
}
