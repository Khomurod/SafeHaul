import React, { Suspense } from 'react';
import { Icon, Loader2 } from '@design-system/icons';
import { ApplicationTab } from './tabs/ApplicationTab';
import { SigningDocumentsSection } from './tabs/SigningDocumentsSection';
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
 * | 'pev' | 'activity' | 'notes'` routing values. Notes also receives the
 * record's `sharedHistory` from `appData`, so it does not read the record again.
 *
 * The lazy-tab loading fallback is a `role="status"` region, so switching to
 * Previous Employment, Activity or Notes is announced while the chunk
 * downloads.
 *
 * Documents (shown as "Documents to sign") holds the driver's signing documents
 * (`SigningDocumentsSection`) only. The driver's uploads have one place, the DQ
 * File tab, which lists and opens them; the gallery that repeated them here is
 * gone, and the tab says where they are. The DQ File tab also takes the record
 * (`appData`): its checklist reads the employers' verifications from it.
 *
 * `refreshKey` changes when a call is logged in the dossier: Activity and Notes,
 * which read their entries once, start again and show it.
 */
export function DossierContent({
    activeTab,
    appData,
    driverId,
    companyId,
    collectionName,
    fileUrls,
    filesPending = false,
    canEdit,
    refreshKey = 0,
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
                return (
                    <div className="space-y-ds-6">
                        <SigningDocumentsSection
                            companyId={companyId}
                            recordId={driverId}
                            collectionName={collectionName}
                        />
                        <p className="px-ds-1 text-ds-sm text-ds-content-secondary">
                            The driver&apos;s uploads, such as the CDL and the medical card, are in the DQ File tab.
                        </p>
                    </div>
                );

            case 'dq':
                return <DQFileTab
                    companyId={companyId}
                    applicationId={driverId}
                    collectionName={collectionName}
                    appData={appData}
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
                            key={refreshKey}
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
                            key={refreshKey}
                            companyId={companyId}
                            applicationId={driverId}
                            collectionName={collectionName}
                            sharedHistory={appData?.sharedHistory}
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
