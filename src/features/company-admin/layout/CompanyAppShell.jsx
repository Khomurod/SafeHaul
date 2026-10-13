import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WorkspaceFrame } from '@/design-system/layouts';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { CompanySidebar } from './CompanySidebar';
import { CompanyTopbar } from './CompanyTopbar';
import { FeatureDeactivationWarning } from '../components/FeatureDeactivationWarning';
import { useData } from '@/context/DataContext';

const SIDEBAR_STORAGE_KEY = 'companySidebarMode';

// The record a notification names opens here, over the page and outside the top
// bar's stacking layer, which a dialog must not render inside. It loads when a
// notification is first opened.
const DriverProfileModal = lazy(() => import('../components/modals/driver-dossier/DriverProfileModal')
    .then((module) => ({ default: module.DriverProfileModal })));

export const CompanyAppShell = () => {
    const isMobile = useIsMobile();
    const location = useLocation();
    const navigationTriggerRef = useRef(null);
    const { currentCompanyProfile } = useData();
    const [isNavigationOpen, setIsNavigationOpen] = useState(false);
    const [openRecordId, setOpenRecordId] = useState(null);
    const [isNavigationExpanded, setIsNavigationExpanded] = useState(() => {
        const stored = localStorage.getItem(SIDEBAR_STORAGE_KEY);
        return stored ? stored === 'expanded' : true;
    });

    useEffect(() => {
        localStorage.setItem(
            SIDEBAR_STORAGE_KEY,
            isNavigationExpanded ? 'expanded' : 'minimized',
        );
    }, [isNavigationExpanded]);

    useEffect(() => {
        setIsNavigationOpen(false);
        setOpenRecordId(null);
    }, [location.pathname]);

    return (
        <>
            <WorkspaceFrame
                navigation={(
                    <CompanySidebar
                        isExpanded={isNavigationExpanded}
                        onExpandedChange={setIsNavigationExpanded}
                        onNavigate={() => setIsNavigationOpen(false)}
                    />
                )}
                topbar={(
                    <CompanyTopbar
                        navigationTriggerRef={navigationTriggerRef}
                        isNavigationOpen={isNavigationOpen}
                        onOpenNavigation={() => setIsNavigationOpen(true)}
                        onOpenRecord={setOpenRecordId}
                    />
                )}
                navigationOpen={!isMobile || isNavigationOpen}
                navigationExpanded={isNavigationExpanded}
                onNavigationClose={isMobile ? () => setIsNavigationOpen(false) : undefined}
                focusReturnRef={navigationTriggerRef}
                navigationLabel="Company navigation"
            >
                <FeatureDeactivationWarning />
                <Outlet />
            </WorkspaceFrame>
            {openRecordId && currentCompanyProfile?.id && (
                <Suspense fallback={null}>
                    <DriverProfileModal
                        key={openRecordId}
                        companyId={currentCompanyProfile.id}
                        driverId={openRecordId}
                        isOpen
                        onClose={() => setOpenRecordId(null)}
                        onDeleted={() => setOpenRecordId(null)}
                    />
                </Suspense>
            )}
        </>
    );
};
