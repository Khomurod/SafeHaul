import React, { Suspense } from 'react';
import { LoadingState } from '@design-system/patterns';
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
 * The lazy-tab loading fallback is the design system's `LoadingState`, a
 * `role="status"` region, so switching to Previous Employment, Activity or
 * Notes is announced while the chunk downloads.
 *
 * Documents (shown as "Documents to sign") holds the driver's signing documents
 * (`SigningDocumentsSection`) only. The driver's uploads have one place, the DQ
 * File tab, which lists and opens them; the gallery that repeated them here is
 * gone, and the tab says where they are. The DQ File tab also takes the record
 * (`appData`): its checklist reads the employers' verifications from it, and
 * opens Previous Employment for them (`onOpenTab`); Documents to sign sends a
 * document to it.
 *
 * `refreshKey` changes when a call is logged in the dossier: Activity, which
 * reads its entries once, starts again; Notes reads its notes again and keeps a
 * note being written.
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
    onOpenTab,
}) {
    // Shared loading fallback: `h4`, under the header's `h3` section title.
    const TabLoading = () => <LoadingState surface="bare" headingLevel={4} title="Loading this tab…" />;

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
                            record={appData}
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
                    onOpenTab={onOpenTab}
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
                            refreshKey={refreshKey}
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

    /*
      Only Activity fills the panel's height: its log scrolls inside its own
      card under a filter that stays put. Every other section is as tall as its
      content. A full-height wrapper around a longer section let the content run
      past the wrapper, and the panel's bottom padding stayed at the wrapper's
      end, so the last card met the dialog's edge with no space under it.
    */
    return (
        <div className={`${activeTab === 'activity' ? 'h-full ' : ''}animate-in fade-in duration-300`}>
            {renderContent()}
        </div>
    );
}
