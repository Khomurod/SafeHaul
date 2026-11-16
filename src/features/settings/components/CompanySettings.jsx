import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigationType, Navigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import {
    Building, Blocks, Users, Mail, MessageSquare, Send, KeyRound, ClipboardList,
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
import { SectionNavigation } from '@/design-system/components';
import { PageContainer, PageEyebrow } from '@/design-system/layouts';
import { useUnsavedChangesGuard } from '@/design-system/patterns';
import { useIsCompact } from '@shared/hooks/useIsCompact';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { isFeatureOn } from '@shared/utils/companyFeatures';

/**
 * The sections, grouped. Every id is also its `?section=` value, so a link to a
 * section keeps working when its label changes. Each says in one line what it
 * holds: the second line of its row in the menu and in the rail. In the rail
 * the line describes the item, whose name stays its label ("Team").
 */
function settingsGroups(profile) {
    return [
        {
            id: 'company',
            label: 'Company',
            items: [
                { id: 'company', label: 'Company profile', icon: Building, description: 'Name, logo, contact details and address' },
                { id: 'application', label: 'Application questions', icon: ClipboardList, description: 'Questions, rules, agreements and report uploads' },
                { id: 'team', label: 'Team', icon: Users, description: 'Who recruits for you' },
            ],
        },
        {
            id: 'messaging',
            label: 'Messaging',
            items: [
                { id: 'email', label: 'Email', icon: Mail, description: 'Sending from your own mailbox' },
                { id: 'sms', label: 'Text messages (SMS)', icon: MessageSquare, description: 'Phone lines and who texts from them' },
                { id: 'automated_sms', label: 'Automated texts', icon: Send, description: 'Messages sent at each contact attempt' },
            ],
        },
        {
            id: 'connections',
            label: 'Connections',
            items: [
                // Every company may make keys. Facebook leads shows only where a
                // super admin switched it on (stored as `features.callTracking`).
                { id: 'api_keys', label: 'API keys', icon: KeyRound, description: 'Let another service read your applications' },
                ...(isFeatureOn(profile, 'callTracking')
                    ? [{ id: 'integrations', label: 'Facebook leads', icon: Blocks, description: 'Leads from Facebook Lead Ads' }]
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

/**
 * The menu of sections, a page of its own at every width (C2): shown when the
 * address names no section. Up to 1279px (`useIsCompact`) it is also the only
 * way between sections; wider, a section has the rail beside it.
 */
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
    // Up to 1279px there is no room for the rail beside a section: every
    // section links back to the menu instead.
    const isCompact = useIsCompact();
    const guard = useUnsavedChangesGuard();

    const groups = settingsGroups(currentCompanyProfile);
    // The section is in the address (`?section=team`), so a reload, Back and a
    // shared link keep it. With none, or one this company does not show, the
    // menu of sections opens, at every width.
    const sectionIds = groups.flatMap((group) => group.items.map((item) => item.id));
    const requestedSection = searchParams.get('section');
    const addressedSection = sectionIds.includes(requestedSection) ? requestedSection : MENU;
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

    // The way back to the menu keeps every other parameter (`e2eAuth`).
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

    // Above every section: "Settings" beside the rail, or the way back to the
    // menu where the menu is a page. The menu has its own eyebrow.
    const eyebrow = isCompact
        ? {
            back: {
                label: 'Settings',
                href: menuHref,
                onClick: (event) => {
                    event.preventDefault();
                    selectSection(MENU);
                },
            },
        }
        : { eyebrow: 'Settings' };

    return (
        <div className="min-h-full min-w-0 bg-ds-canvas text-ds-content" data-testid="company-settings-shell">
            <PageContainer width="standard">
                <div className="flex min-w-0 items-start gap-ds-10">
                    {/* The rail beside a section, from 1280px; the menu is its own page. */}
                    {!isCompact && activeTab !== MENU && (
                        <aside className="sticky top-ds-8 w-72 shrink-0">
                            <SectionNavigation
                                label="Company settings sections"
                                groups={groups}
                                currentId={activeTab}
                                onSelect={selectSection}
                                controlsId="company-settings-content"
                            />
                        </aside>
                    )}

                    {/* A size container: a section lays itself out by the room
                        it has beside the rail, not by the window. */}
                    <section
                        id="company-settings-content"
                        className="min-w-0 flex-1 [container-type:inline-size]"
                        aria-label="Company settings content"
                    >
                        {activeTab !== MENU && <PageEyebrow {...eyebrow} className="mb-ds-2" />}
                        {renderContent()}
                    </section>
                </div>
            </PageContainer>
        </div>
    );
}
