import React, { Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { ApplicationTab } from './tabs/ApplicationTab';
import { DocumentsTab } from './tabs/DocumentsTab';
import { DQFileTab } from '@features/company-admin/components/tabs/DQFileTab';

// Lazy Load Legacy Tabs to keep bundle size optimized
const ActivityHistoryTab = React.lazy(() => import('@features/company-admin/components/tabs').then(m => ({ default: m.ActivityHistoryTab })));
const NotesTab = React.lazy(() => import('@features/company-admin/components/tabs').then(m => ({ default: m.NotesTab })));
const PEVTab = React.lazy(() => import('@features/company-admin/components/tabs/PEVTab').then(m => ({ default: m.PEVTab }))); // Legacy PEV Tab

/**
 * Routes the active dossier tab to its content component.
 *
 * Presentation migrated to `--ds-*` tokens (2026-07-27). Every prop handed to
 * every tab, the lazy-loading split, and the `'application' | 'documents' | 'dq'
 * | 'pev' | 'activity' | 'notes'` routing values are unchanged.
 *
 * DEFECT FIXED (2026-07-27): the lazy-tab loading fallback was a bare spinner
 * with no live region, so switching to Previous Employment, Activity or Notes
 * announced nothing at all while the chunk downloaded.
 */
export function DossierContent({
    activeTab,
    appData,
    driverId,
    companyId,
    collectionName,
    isEditing,
    setIsEditing,
    handleSaveEdit,
    isSaving,
    fileUrls,
    canEdit
}) {
    // Shared Loading Fallback
    const TabLoading = () => (
        <div role="status" className="flex items-center justify-center py-ds-12 text-ds-content-secondary">
            <Loader2 size={24} className="mr-ds-2 animate-spin" aria-hidden="true" /> Loading Tab...
        </div>
    );

    const renderContent = () => {
        switch (activeTab) {
            case 'application':
                return <ApplicationTab
                    appData={appData}
                    fileUrls={fileUrls}
                    isEditing={isEditing}
                    setIsEditing={setIsEditing}
                    canEdit={canEdit}
                    companyId={companyId}
                    applicationId={driverId}
                    collectionName={collectionName}
                />;

            case 'documents':
                return <DocumentsTab
                    appData={appData}
                    fileUrls={fileUrls}
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
