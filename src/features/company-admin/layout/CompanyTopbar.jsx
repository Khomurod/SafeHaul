import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useData } from '@/context/DataContext';
import { Icon, LogOut, ArrowLeftRight, Menu } from '@design-system/icons';
import { Avatar, ButtonLink, IconButton } from '@/design-system/components';
import { useUnsavedChangesGuard } from '@/design-system/patterns';
import { NotificationDropdown } from '../components/NotificationDropdown';
import { getPortalUser } from '@features/auth';
import { isSuperAdminClaims } from '@app/auth/roles';

const PROFILE_PATH = '/company/profile';

// Helper to get user role label
const getUserRoleLabel = (claims, companyId) => {
    if (!claims) return 'User';
    if (isSuperAdminClaims(claims)) return 'Super Admin';
    if (claims.roles?.[companyId] === 'company_admin') return 'Company Admin';
    if (claims.roles?.[companyId]) return 'Recruiter';
    return 'Team Member';
};

export const CompanyTopbar = ({
    isNavigationOpen,
    onOpenNavigation,
    navigationTriggerRef,
    onOpenRecord,
}) => {
    const { currentUser, handleLogout, currentCompanyProfile, currentUserClaims, returnToCompanyChooser } = useData();
    // Switching company, logging out and opening E-Docs or the reader's leads
    // from the bell all leave the page: unsaved changes ask first.
    const guard = useUnsavedChangesGuard();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const companyId = currentCompanyProfile?.id;

    const [displayName, setDisplayName] = useState(currentUser?.displayName || currentUser?.email?.split('@')[0] || 'User');

    useEffect(() => {
        const fetchUserName = async () => {
            if (!currentUser?.uid) return;
            try {
                // Try to get name from Firestore profile which is more reliable
                const userDoc = await getPortalUser(currentUser.uid);
                if (userDoc?.name) {
                    setDisplayName(userDoc.name);
                } else if (currentUser.displayName) {
                    setDisplayName(currentUser.displayName);
                }
            } catch (error) {
                console.error("Error fetching user name:", error);
            }
        };
        fetchUserName();
    }, [currentUser]);

    // `false` when the person is still signed in, so the unsaved-changes
    // guard keeps protecting the page.
    const onLogout = async () => {
        try {
            return await handleLogout();
        } catch (error) {
            console.error('Logout failed', error);
            return false;
        }
    };


    // The name and avatar open Profile. A plain press stays in the app and asks
    // first while the page holds unsaved changes; a new-tab or modified press
    // opens as the browser would.
    const openProfile = (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (pathname === PROFILE_PATH) return;
        guard.request(() => navigate(PROFILE_PATH));
    };

    const roleLabel = getUserRoleLabel(currentUserClaims, companyId);
    // Use displayName for initials
    const initials = displayName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase() || 'U';

    return (
        <header className="h-16 bg-ds-surface border-b border-ds-border-subtle flex items-center justify-between gap-2 px-3 sm:px-6 shadow-ds-xs">
            {/* Left: Company Name */}
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <IconButton
                    ref={navigationTriggerRef}
                    label="Open navigation"
                    variant="ghost"
                    className="md:hidden"
                    onClick={onOpenNavigation}
                    aria-controls="workspace-navigation"
                    aria-expanded={isNavigationOpen}
                    aria-haspopup="dialog"
                >
                    <Icon icon={Menu} size="xl" />
                </IconButton>
                <p className="text-ds-heading-md font-semibold text-ds-content truncate">
                    {currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'Dashboard'}
                </p>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* Notifications */}
                <NotificationDropdown
                    companyId={companyId}
                    onOpenRecord={onOpenRecord}
                    onOpenDocuments={() => guard.request(() => navigate('/company/e-docs'))}
                    onOpenAssignedLeads={() => guard.request(() => navigate('/company/drivers/leads/my'))}
                />

                <div className="h-8 w-px bg-ds-border-subtle mx-1 hidden sm:block" aria-hidden="true" />

                {/* User Info: the way to Profile, named "Your profile" and what it shows */}
                <div className="hidden md:flex">
                    <ButtonLink href={PROFILE_PATH} variant="ghost" onClick={openProfile}>
                        <span className="sr-only">Your profile: </span>
                        <span className="flex flex-col items-end">
                            <span className="text-ds-body font-semibold text-ds-content">
                                {displayName}
                            </span>{' '}
                            <span className="text-ds-xs font-normal text-ds-content-muted">
                                {roleLabel}
                            </span>
                        </span>

                        {/* Avatar */}
                        <Avatar size="md" tone="primary">
                            {initials}
                        </Avatar>
                    </ButtonLink>
                </div>

                <div className="h-8 w-px bg-ds-border-subtle mx-1 hidden md:block" aria-hidden="true" />

                {/* Switch Company Button */}
                <IconButton
                    label="Switch company"
                    variant="ghost"
                    onClick={() => guard.request(returnToCompanyChooser)}
                    title="Switch Company"
                >
                    <Icon icon={ArrowLeftRight} size="lg" />
                </IconButton>

                {/* Logout Button */}
                <IconButton
                    label="Log out"
                    variant="ghost"
                    onClick={() => guard.request(onLogout)}
                    title="Logout"
                >
                    <Icon icon={LogOut} size="lg" />
                </IconButton>
            </div>
        </header>
    );
};
