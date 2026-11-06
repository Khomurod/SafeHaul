import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigationType, Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import {
    Icon, Building, Blocks, ArrowLeft, Users, Mail, MessageSquare, Send, KeyRound, ClipboardList,
} from '@design-system/icons';

import { SmsSettingsTab } from './SmsSettingsTab';
import { AutomatedSmsTab } from './AutomatedSmsTab';
import { CompanyProfileTab } from './CompanyProfileTab';
import { ApplicationFormTab } from './ApplicationFormTab';
import { TeamManagementTab } from './TeamManagementTab';
import { EmailSettingsTab } from './EmailSettingsTab';
import { IntegrationsTab } from './IntegrationsTab';
import { ApiKeysTab } from './api-keys/ApiKeysTab';
import { SettingsMenu } from './SettingsMenu';
import { ButtonLink, SectionNavigation } from '@/design-system/components';
import { useUnsavedChangesGuard } from '@/design-system/patterns';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { isFeatureOn } from '@features/super-admin/config/features';

/**
 * The sections, grouped. Every id is also its `?section=` value, so a link to a
 * section keeps working when its label changes.
 */
function settingsGroups(profile) {
    return [
        {
            id: 'company',
            label: 'Company',
            items: [
                { id: 'company', label: 'Company profile', icon: Building },
                { id: 'application', label: 'Application questions', icon: ClipboardList },
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
                // Every company may make keys. Facebook leads shows only where a
                // super admin switched it on (stored as `features.callTracking`).
                { id: 'api_keys', label: 'API keys', icon: KeyRound },
                ...(isFeatureOn(profile, 'callTracking')
                    ? [{ id: 'integrations', label: 'Facebook leads', icon: Blocks }]
                    : []),
            ],
        },
    ];
}

/**
 * Sections that moved, and where an old link to one lands now, with the
 * address's other parameters (`e2eAuth`) kept. My profile is the Profile page,
 * open to every staff member; Plan is a line in Company profile.
 */
const MOVED_SECTIONS = {
    personal: { pathname: '/company/profile' },
    billing: { pathname: '/company/settings', section: 'company' },
};

function movedSectionTarget(searchParams) {
    const moved = MOVED_SECTIONS[searchParams.get('section')];
    if (!moved) return null;
    const params = new URLSearchParams(searchParams);
    if (moved.section) params.set('section', moved.section);
    else params.delete('section');
    const search = params.toString();
    return { pathname: moved.pathname, search: search ? `?${search}` : '' };
}

/** The phone's menu of sections: shown when the address names no section. */
const MENU = 'menu';

export function CompanySettings() {
    const { currentCompanyProfile, currentUser, currentUserClaims } = useData();
    const [searchParams] = useSearchParams();
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, currentCompanyProfile?.id);

    const moved = movedSectionTarget(searchParams);
    if (moved) return <Navigate to={moved} replace />;
    if (!isCompanyAdmin && currentCompanyProfile) {
        return <Navigate to="/company/dashboard" replace />;
    }
    if (!currentCompanyProfile) return null;

    // The company shell's `UnsavedChangesBoundary` asks before any move leaves unsaved changes.
    return (
        <SettingsShell
            currentCompanyProfile={currentCompanyProfile}
            currentUser={currentUser}
            isCompanyAdmin={isCompanyAdmin}
        />
    );
}

function SettingsShell({ currentCompanyProfile, currentUser, isCompanyAdmin }) {
    const [searchParams, setSearchParams] = useSearchParams();
    const navigationType = useNavigationType();
    const isPhone = useIsMobile();
    const guard = useUnsavedChangesGuard();

    const groups = settingsGroups(currentCompanyProfile);
    // The section is in the address (`?section=team`), so a reload, Back and a
    // shared link keep it. With none, or one this company does not show, a
    // phone opens its menu of sections and a wider screen opens Company profile.
    const home = isPhone ? MENU : 'company';
    const sectionIds = groups.flatMap((group) => group.items.map((item) => item.id));
    const requestedSection = searchParams.get('section');
    const addressedSection = sectionIds.includes(requestedSection) ? requestedSection : home;
    const setActiveTab = (section) => setSearchParams((params) => {
        const next = new URLSearchParams(params);
        if (section === MENU) next.delete('section');
        else next.set('section', section);
        return next;
    });
    // Every move between sections asks first while one holds unsaved changes;
    // choosing the section already shown is no move.
    const selectSection = (section) => {
        if (section === activeTab) return;
        guard.request(() => setActiveTab(section));
    };

    // The browser's Back and Forward change the address before anything can ask,
    // so while a section holds unsaved changes the page keeps showing it and asks
    // then: Discard follows the address, Keep editing puts the address back.
    const [shownSection, setShownSection] = useState(addressedSection);
    const heldByHistory = addressedSection !== shownSection && guard.dirty && navigationType === 'POP';
    if (addressedSection !== shownSection && !heldByHistory) setShownSection(addressedSection);
    useEffect(() => {
        if (!heldByHistory) return;
        guard.request(() => setShownSection(addressedSection), {
            // A new entry, so the next Back still reaches the page the person came from.
            onCancel: () => setActiveTab(shownSection),
        });
        // `guard.request` changes with the dirty flag, which `heldByHistory` already follows.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [heldByHistory, addressedSection]);
    const activeTab = heldByHistory ? shownSection : addressedSection;

    // A wide screen names Company profile in the address (replacing the entry), so
    // narrowing the window or turning a phone keeps it, edits and all, rather than
    // swapping it for the phone's menu.
    const namesHome = !isPhone && !sectionIds.includes(requestedSection) && !heldByHistory;
    useEffect(() => {
        if (!namesHome) return;
        setSearchParams((params) => {
            const next = new URLSearchParams(params);
            next.set('section', 'company');
            return next;
        }, { replace: true });
    }, [namesHome, setSearchParams]);

    // The phone's way back to its menu keeps every other parameter (`e2eAuth`).
    const menuParams = new URLSearchParams(searchParams);
    menuParams.delete('section');
    const menuQuery = menuParams.toString();
    const menuHref = `/company/settings${menuQuery ? `?${menuQuery}` : ''}`;

    const renderContent = () => {
        switch (activeTab) {
            case MENU:
                return <SettingsMenu groups={groups} onSelect={selectSection} />;
            case 'company':
                return <CompanyProfileTab currentCompanyProfile={currentCompanyProfile} />;
            case 'application':
                return <ApplicationFormTab currentCompanyProfile={currentCompanyProfile} />;
            case 'team':
                return (
                    <TeamManagementTab
                        currentCompanyProfile={currentCompanyProfile}
                        currentUserId={currentUser?.uid}
                        isCompanyAdmin={isCompanyAdmin}
                    />
                );
            case 'email':
                return <EmailSettingsTab currentCompanyProfile={currentCompanyProfile} />;
            case 'sms':
                return <SmsSettingsTab currentCompanyProfile={currentCompanyProfile} isCompanyAdmin={isCompanyAdmin} />;
            case 'automated_sms':
                return <AutomatedSmsTab companyId={currentCompanyProfile.id} />;
            case 'integrations':
                return <IntegrationsTab companyId={currentCompanyProfile.id} />;
            case 'api_keys':
                return <ApiKeysTab companyId={currentCompanyProfile.id} />;
            default:
                return null;
        }
    };

    return (
        <div className="min-h-full min-w-0 bg-ds-canvas text-ds-content" data-testid="company-settings-shell">
            <div className="mx-auto max-w-7xl p-3 sm:p-6">
                <div className="flex min-w-0 flex-col gap-ds-6 xl:flex-row xl:gap-ds-8">
                    {/* A phone has no room for the rail beside the content or above
                        it: its menu of sections is the way to every section. */}
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
                        {isPhone && activeTab !== MENU && (
                            <div>
                                <ButtonLink
                                    href={menuHref}
                                    variant="ghost"
                                    size="sm"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        selectSection(MENU);
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
        </div>
    );
}
