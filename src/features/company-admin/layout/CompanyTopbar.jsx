import React, { useState, useEffect } from 'react';
import { useData } from '@/context/DataContext';
import { LogOut, ArrowLeftRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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

export const CompanyTopbar = () => {
    const { currentUser, handleLogout, currentCompanyProfile, currentUserClaims, returnToCompanyChooser } = useData();
    const navigate = useNavigate();
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
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 sticky top-0 z-40 shadow-sm">
            {/* Left: Company Name */}
            <div className="flex items-center gap-4">
                <h1 className="text-lg font-semibold text-gray-900">
                    {currentCompanyProfile?.companyName || currentCompanyProfile?.name || 'Dashboard'}
                </h1>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
                {/* Notifications */}
                <NotificationDropdown companyId={companyId} />

                <div className="h-8 w-px bg-gray-200 mx-1"></div>

                {/* User Info */}
                <div className="flex items-center gap-3">
                    <div className="flex flex-col items-end hidden md:flex">
                        <span className="text-sm font-semibold text-gray-900">
                            {displayName}
                        </span>
                        <span className="text-xs text-gray-500">
                            {roleLabel}
                        </span>
                    </div>

                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-sm font-bold text-white shadow-sm">
                        {initials}
                    </div>
                </div>

                <div className="h-8 w-px bg-gray-200 mx-1"></div>

                {/* Switch Company Button */}
                <button
                    onClick={returnToCompanyChooser}
                    className="flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Switch Company"
                >
                    <ArrowLeftRight size={18} />
                </button>

                {/* Logout Button */}
                <button
                    onClick={onLogout}
                    className="flex items-center gap-2 px-3 py-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Logout"
                >
                    <LogOut size={18} />
                </button>
            </div>
        </header>
    );
};
