import React, { Suspense } from 'react';
import { Icon, Loader2 } from '@design-system/icons';
import { ApplicationTab } from './tabs/ApplicationTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { DQFileTab } from '@features/company-admin/components/tabs/DQFileTab';

// The tabs that load when opened, each from its own file: through a shared
// index, Activity and Notes also downloaded the Previous Employment tab.
const ActivityHistoryTab = React.lazy(() => import('@features/company-admin/components/tabs/ActivityHistoryTab').then(m => ({ default: m.ActivityHistoryTab })));
const NotesTab = React.lazy(() => import('@features/company-admin/components/tabs/NotesTab').then(m => ({ default: m.NotesTab })));
const PEVTab = React.lazy(() => import('@features/company-admin/components/tabs/PEVTab').then(m => ({ default: m.PEVTab })));

/**
 * Routes the active dossier tab to its content component.
 *
 * Presentation uses `--ds-*` tokens. Frozen contracts: every prop handed to
 * every tab, the lazy-loading split, and the `'application' | 'documents' | 'dq'
 * | 'pev' | 'activity' | 'notes'` routing values.
 *
 * The lazy-tab loading fallback is a `role="status"` region, so switching to
 * Previous Employment, Activity or Notes is announced while the chunk
 * downloads.
 */
export function DossierContent({
    activeTab,
    appData,
    driverId,
    companyId,
    collectionName,
    fileUrls,
    filesPending = false,
    canEdit
}) {
    // Shared Loading Fallback
    const TabLoading = () => (
        <div role="status" className="flex items-center justify-center py-ds-12 text-ds-content-secondary">
            <Icon icon={Loader2} size="2xl" className="mr-ds-2 animate-spin" /> Loading Tab...
        </div>
    );

    const renderContent = () => {
        switch (activeTab) {
            case 'application':
                return <ApplicationTab
                    appData={appData}
                    fileUrls={fileUrls}
                    filesPending={filesPending}
                    canEdit={canEdit}
                    companyId={companyId}
                    applicationId={driverId}
                    collectionName={collectionName}
                />;

            case 'documents':
                return <DocumentsTab
                    appData={appData}
                    fileUrls={fileUrls}
                    filesPending={filesPending}
                />;

            case 'dq':
                return <DQFileTab
                    companyId={companyId}
                    applicationId={driverId}
                    collectionName={collectionName}
                />;

            case 'pev':
                return (
                    <Suspense fallback={<TabLoading />}>
                        <PEVTab
                            companyId={companyId}
                            applicationId={driverId}
                            appData={appData}
                            collectionName={collectionName}
                        />
                    </Suspense>
                );

            case 'activity':
                return (
                    <Suspense fallback={<TabLoading />}>
                        <ActivityHistoryTab
                            companyId={companyId}
                            applicationId={driverId}
                            collectionName={collectionName}
                        />
                    </Suspense>
                );

            case 'notes':
                return (
                    <Suspense fallback={<TabLoading />}>
                        <NotesTab
                            companyId={companyId}
                            applicationId={driverId}
                            collectionName={collectionName}
                        />
                    </Suspense>
                );

            default:
                return null;
        }
    };

    return (
        <div className="h-full animate-in fade-in duration-300">
            {renderContent()}
        </div>
    );
}
