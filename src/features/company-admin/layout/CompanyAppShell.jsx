import React, { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { WorkspaceFrame } from '@/design-system/layouts';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { CompanySidebar } from './CompanySidebar';
import { CompanyTopbar } from './CompanyTopbar';
import { FeatureDeactivationWarning } from '../components/FeatureDeactivationWarning';

const SIDEBAR_STORAGE_KEY = 'companySidebarMode';

export const CompanyAppShell = () => {
    const isMobile = useIsMobile();
    const location = useLocation();
    const navigationTriggerRef = useRef(null);
    const [isNavigationOpen, setIsNavigationOpen] = useState(false);
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
    }, [location.pathname]);

    return (
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
    );
};
