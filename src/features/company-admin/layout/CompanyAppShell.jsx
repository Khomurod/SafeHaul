import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { WorkspaceFrame } from '@/design-system/layouts';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { CompanySidebar } from './CompanySidebar';
import { CompanyTopbar } from './CompanyTopbar';
import { FeatureDeactivationWarning } from '../components/FeatureDeactivationWarning';
import { useLiveCompany } from '../hooks/useLiveCompany';
import { CompanyDeactivatedScreen } from './CompanyDeactivatedScreen';
import { useData } from '@/context/DataContext';
import { DriverDossier } from '../components/modals/driver-dossier/DriverDossier';
import { UnsavedChangesBoundary } from './UnsavedChangesBoundary';

const SIDEBAR_STORAGE_KEY = 'companySidebarMode';

export const CompanyAppShell = () => {
    const isMobile = useIsMobile();
    const location = useLocation();
    const navigate = useNavigate();
    const navigationTriggerRef = useRef(null);
    const { currentCompanyProfile } = useData();
    // The company's document, watched: its feature switches and whether it was turned off.
    const deactivated = useLiveCompany();
    const [isNavigationOpen, setIsNavigationOpen] = useState(false);
    // The record open over the page, `{ id, tab, collection }`: `tab` is the
    // dossier tab a notification is about, else the dossier opens on its first;
    // `collection` the one the opener knows the record is in, if it does.
    const [openRecord, setOpenRecord] = useState(null);
    const openRecordOn = useCallback((id, tab, collection) => setOpenRecord(id ? { id, tab, collection } : null), []);
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
        setOpenRecord(null);
    }, [location.pathname]);

    // A page that sends the person on to a record names it in the navigation's
    // state (`openRecordId`, with `openRecordCollection` when it knows it: Add
    // lead, once the lead is saved), and it opens here over the page it lands on.
    // Once: the state is dropped, so a reload or a Back to that page does not open
    // it again.
    useEffect(() => {
        const recordId = location.state?.openRecordId;
        if (!recordId) return;
        setOpenRecord({ id: recordId, collection: location.state.openRecordCollection });
        const state = { ...location.state };
        delete state.openRecordId;
        delete state.openRecordCollection;
        navigate(
            { pathname: location.pathname, search: location.search, hash: location.hash },
            { replace: true, state },
        );
    }, [location, navigate]);

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
                        onOpenRecord={openRecordOn}
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
              The record a notification or a navigation names opens here, over
              the page and outside the top bar's stacking layer, which a dialog
              must not render inside; a notification's on the tab it is about.
            */}
            {openRecord && currentCompanyProfile?.id && (
                <DriverDossier
                    key={openRecord.id}
                    companyId={currentCompanyProfile.id}
                    driverId={openRecord.id}
                    initialTab={openRecord.tab}
                    collectionHint={openRecord.collection}
                    isOpen
                    onClose={() => setOpenRecord(null)}
                    onDeleted={() => setOpenRecord(null)}
                />
            )}
        </UnsavedChangesBoundary>
    );
};
