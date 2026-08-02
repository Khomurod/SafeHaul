import React, { useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { LogOut, ArrowLeftRight, Menu } from 'lucide-react';
import { IconButton } from '@/design-system/components';
import { NotificationDropdown } from '../components/NotificationDropdown';
import { getPortalUser } from '@features/auth';

// Helper to get user role label
const getUserRoleLabel = (claims, companyId) => {
    if (!claims) return 'User';
    if (claims.roles?.globalRole === 'super_admin') return 'Super Admin';
    if (claims.roles?.[companyId] === 'company_admin') return 'Company Admin';
    if (claims.roles?.[companyId]) return 'Recruiter';
    return 'Team Member';
};

export const CompanyTopbar = ({
    isNavigationOpen,
    onOpenNavigation,
    navigationTriggerRef,
}) => {
    const { currentUser, handleLogout, currentCompanyProfile, currentUserClaims, returnToCompanyChooser } = useData();
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

    const onLogout = async () => {
        try {
            await handleLogout();
        } catch (error) {
            console.error('Logout failed', error);
        }
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
                    <Menu size={20} aria-hidden="true" />
                </IconButton>
                <p className="text-ds-heading-md font-semibold text-ds-content truncate">
                    {currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'Dashboard'}
                </p>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                {/* Notifications */}
                <NotificationDropdown companyId={companyId} />

                <div className="h-8 w-px bg-ds-border-subtle mx-1 hidden sm:block" aria-hidden="true" />

                {/* User Info */}
                <div className="items-center gap-3 hidden md:flex">
                    <div className="flex flex-col items-end hidden md:flex">
                        <span className="text-ds-body font-semibold text-ds-content">
                            {displayName}
                        </span>
                        <span className="text-ds-xs text-ds-content-muted">
                            {roleLabel}
                        </span>
                    </div>

                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-ds-action-primary flex items-center justify-center text-ds-body font-bold text-ds-content-inverse shadow-ds-xs" aria-hidden="true">
                        {initials}
                    </div>
                </div>

                <div className="h-8 w-px bg-ds-border-subtle mx-1 hidden md:block" aria-hidden="true" />

                {/* Switch Company Button */}
                <IconButton
                    label="Switch company"
                    variant="ghost"
                    onClick={returnToCompanyChooser}
                    title="Switch Company"
                >
                    <ArrowLeftRight size={18} aria-hidden="true" />
                </IconButton>

                {/* Logout Button */}
                <IconButton
                    label="Log out"
                    variant="ghost"
                    onClick={onLogout}
                    title="Logout"
                >
                    <LogOut size={18} aria-hidden="true" />
                </IconButton>
            </div>
        </header>
    );
};
