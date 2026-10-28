import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WorkspaceFrame } from '@/design-system/layouts';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { CompanySidebar } from './CompanySidebar';
import { CompanyTopbar } from './CompanyTopbar';
import { FeatureDeactivationWarning } from '../components/FeatureDeactivationWarning';
import { useCompanyDeactivated } from '../hooks/useCompanyDeactivated';
import { CompanyDeactivatedScreen } from './CompanyDeactivatedScreen';
import { useData } from '@/context/DataContext';
import { DriverDossier } from '../components/modals/driver-dossier/DriverDossier';
import { UnsavedChangesBoundary } from './UnsavedChangesBoundary';

const SIDEBAR_STORAGE_KEY = 'companySidebarMode';

export const CompanyAppShell = () => {
    const isMobile = useIsMobile();
    const location = useLocation();
    const navigationTriggerRef = useRef(null);
    const { currentCompanyProfile } = useData();
    const deactivated = useCompanyDeactivated();
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

    if (deactivated) return <CompanyDeactivatedScreen />;

    return (
        <UnsavedChangesBoundary>
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
            {/*
              The record a notification names opens here, over the page and
              outside the top bar's stacking layer, which a dialog must not
              render inside.
            */}
            {openRecordId && currentCompanyProfile?.id && (
                <DriverDossier
                    key={openRecordId}
                    companyId={currentCompanyProfile.id}
                    driverId={openRecordId}
                    isOpen
                    onClose={() => setOpenRecordId(null)}
                    onDeleted={() => setOpenRecordId(null)}
                />
            )}
        </UnsavedChangesBoundary>
    );
};
