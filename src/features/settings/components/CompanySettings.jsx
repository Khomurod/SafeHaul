import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigationType, Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import {
    Icon, Building, User, CreditCard, Blocks, ArrowLeft, Users, Mail, MessageSquare, Send, KeyRound, LayoutDashboard,
} from '@design-system/icons';

import { SmsSettingsTab } from './SmsSettingsTab';
import { AutomatedSmsTab } from './AutomatedSmsTab';
import { CompanyProfileTab } from './CompanyProfileTab';
import { TeamManagementTab } from './TeamManagementTab';
import { EmailSettingsTab } from './EmailSettingsTab';
import { PersonalProfileTab } from './PersonalProfileTab';
import { IntegrationsTab } from './IntegrationsTab';
import { BillingTab } from './BillingTab';
import { ApiKeysTab } from './api-keys/ApiKeysTab';
import { SettingsOverview } from './overview/SettingsOverview';
import { useSettingsOverview } from '../hooks/useSettingsOverview';
import { ButtonLink, SectionNavigation } from '@/design-system/components';
import { ConfirmDialog, UnsavedChangesProvider, useUnsavedChangesGuard } from '@/design-system/patterns';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { isCompanyAdminForRoute } from '@app/auth/roles';

/**
 * The sections, grouped. Every id is also its `?section=` value, so a link to a
 * section keeps working when its label changes. Overview has no group label: it
 * is the way in, not a group.
 */
function settingsGroups(profile) {
    return [
        { id: 'overview', items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard }] },
        {
            id: 'company',
            label: 'Company',
            items: [
                { id: 'company', label: 'Company profile', icon: Building },
                { id: 'team', label: 'Team', icon: Users },
            ],
        },
        {
            id: 'messaging',
            label: 'Messaging',
            items: [
                { id: 'email', label: 'Email', icon: Mail },
                { id: 'sms', label: 'Text messages (SMS)', icon: MessageSquare },
                { id: 'automated_sms', label: 'Automated texts', icon: Send },
            ],
        },
        {
            id: 'connections',
            label: 'Connections',
            items: [
                // Every company may make keys; Facebook leads is hidden with call tracking.
                { id: 'api_keys', label: 'API keys', icon: KeyRound },
                ...(profile?.features?.callTracking !== false
                    ? [{ id: 'integrations', label: 'Facebook leads', icon: Blocks }]
                    : []),
            ],
        },
        {
            id: 'account',
            label: 'Account',
            items: [
                { id: 'billing', label: 'Plan', icon: CreditCard },
                { id: 'personal', label: 'My profile', icon: User },
            ],
        },
    ];
}

export function CompanySettings() {
    const { currentCompanyProfile, currentUser, currentUserClaims } = useData();
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id);

    if (!isCompanyAdmin && currentCompanyProfile) {
        return <Navigate to="/company/dashboard" replace />;
    }
    if (!currentCompanyProfile) return null;

    return (
        <UnsavedChangesProvider>
            <SettingsShell
                currentCompanyProfile={currentCompanyProfile}
                currentUser={currentUser}
                isCompanyAdmin={isCompanyAdmin}
            />
        </UnsavedChangesProvider>
    );
}

function SettingsShell({ currentCompanyProfile, currentUser, isCompanyAdmin }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigationType = useNavigationType();
    const isPhone = useIsMobile();
    const guard = useUnsavedChangesGuard();

    const groups = settingsGroups(currentCompanyProfile);
    // The section is in the address (`?section=team`), so a reload, Back and a
    // shared link keep it; Overview, the first, needs none. A section this
    // company does not show opens Overview.
    const sectionIds = groups.flatMap((group) => group.items.map((item) => item.id));
    const requestedSection = searchParams.get('section');
    const addressedSection = sectionIds.includes(requestedSection) ? requestedSection : 'overview';
    const setActiveTab = (section) => setSearchParams((params) => {
        const next = new URLSearchParams(params);
        if (section === 'overview') next.delete('section');
        else next.set('section', section);
        return next;
    });
    // Every move between sections asks first while one holds unsaved changes.
    const selectSection = (section) => guard.request(() => setActiveTab(section));

    // The browser's Back and Forward change the address before anything can ask,
    // so while a section holds unsaved changes the page keeps showing it and asks
    // then: Discard follows the address, Keep editing puts the address back.
    const [shownSection, setShownSection] = useState(addressedSection);
    const heldByHistory = addressedSection !== shownSection && guard.dirty && navigationType === 'POP';
    if (addressedSection !== shownSection && !heldByHistory) setShownSection(addressedSection);
    useEffect(() => {
        if (heldByHistory) guard.request(() => setShownSection(addressedSection));
        // `guard.request` changes with the dirty flag, which `heldByHistory` already follows.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [heldByHistory, addressedSection]);
    const activeTab = heldByHistory ? shownSection : addressedSection;
    const keepEditing = () => {
        // A new entry, so the next Back still reaches the page the person came from.
        if (heldByHistory) setActiveTab(shownSection);
        guard.cancel();
    };

    // The phone's way back to Overview keeps every other parameter (`e2eAuth`).
    const overviewParams = new URLSearchParams(searchParams);
    overviewParams.delete('section');
    const overviewQuery = overviewParams.toString();
    const overviewHref = `/company/settings${overviewQuery ? `?${overviewQuery}` : ''}`;

    const renderContent = () => {
        switch (activeTab) {
            case 'overview':
                return <OverviewWithStatuses profile={currentCompanyProfile} groups={groups} onSelect={selectSection} />;
            case 'company':
                return <CompanyProfileTab currentCompanyProfile={currentCompanyProfile} />;
            case 'team':
                return (
                    <TeamManagementTab
                        currentCompanyProfile={currentCompanyProfile}
                        currentUserId={currentUser?.uid}
                        isCompanyAdmin={isCompanyAdmin}
                    />
                );
            case 'personal':
                return <PersonalProfileTab currentUser={currentUser} currentCompanyProfile={currentCompanyProfile} />;
            case 'email':
                return <EmailSettingsTab currentCompanyProfile={currentCompanyProfile} />;
            case 'sms':
                return <SmsSettingsTab currentCompanyProfile={currentCompanyProfile} />;
            case 'automated_sms':
                return <AutomatedSmsTab companyId={currentCompanyProfile.id} />;
            case 'integrations':
                return <IntegrationsTab companyId={currentCompanyProfile.id} />;
            case 'api_keys':
                return <ApiKeysTab companyId={currentCompanyProfile.id} />;
            case 'billing':
                return <BillingTab currentCompanyProfile={currentCompanyProfile} />;
            default:
                return null;
        }
    };

    return (
        <div className="min-h-full min-w-0 bg-ds-canvas text-ds-content" data-testid="company-settings-shell">
            <div className="mx-auto max-w-7xl p-3 sm:p-6">
                <div className="flex min-w-0 flex-col gap-ds-6 xl:flex-row xl:gap-ds-8">
                    {/* A phone has no room for the rail beside the content or above
                        it: Overview is its way to every section. */}
                    {!isPhone && (
                        <aside className="w-full min-w-0 flex-shrink-0 xl:w-64">
                            <SectionNavigation
                                label="Company settings sections"
                                groups={groups}
                                currentId={activeTab}
                                onSelect={selectSection}
                                controlsId="company-settings-content"
                                mobileLayout="grid"
                                className="xl:sticky xl:top-6"
                            />
                        </aside>
                    )}

                    <section
                        id="company-settings-content"
                        className="flex min-w-0 flex-1 flex-col gap-ds-4"
                        aria-label="Company settings content"
                    >
                        {isPhone && activeTab !== 'overview' && (
                            <div>
                                <ButtonLink
                                    href={overviewHref}
                                    variant="ghost"
                                    size="sm"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        selectSection('overview');
                                    }}
                                >
                                    <Icon icon={ArrowLeft} />
                                    Settings
                                </ButtonLink>
                            </div>
                        )}
                        {renderContent()}
                    </section>
                </div>
            </div>

            <ConfirmDialog
                isOpen={guard.pending}
                tone="warning"
                title="Leave without saving?"
                description="This section has changes that have not been saved. Leaving now discards them."
                confirmLabel="Discard changes"
                cancelLabel="Keep editing"
                onConfirm={guard.confirm}
                onCancel={keepEditing}
            />
        </div>
    );
}

/** Overview with each section's state; its reads run only while Overview is shown. */
function OverviewWithStatuses({ profile, groups, onSelect }) {
    const statuses = useSettingsOverview(profile);
    return <SettingsOverview groups={groups} onSelect={onSelect} statuses={statuses} />;
}
