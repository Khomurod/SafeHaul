import React, { useId, useRef, useState } from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useApplicationView } from '@features/company-admin/hooks/useApplicationView';
import { useApplicationDelete } from '@features/applications/hooks/useApplicationDelete';
import { useData } from '@/context/DataContext';
import { Modal } from '@design-system/patterns';
import { Button, TabPanel } from '@/design-system/components';
import { DossierSidebar } from './DossierSidebar';
import { DossierHeader } from './DossierHeader';
import { DossierContent } from './DossierContent';

/**
 * DriverProfileModal
 *
 * The main container for the Driver Dossier. It manages the active tab state and
 * orchestrates data fetching via `useApplicationView`.
 *
 * Presentation migrated to the approved accessible `Modal`, the approved `Button`
 * and `--ds-*` tokens (2026-07-27).
 *
 * Frozen contracts: the dialog's accessible name **"Driver dossier"** and the
 * fact that Escape closes it (both asserted by
 * `e2e/company-candidate-table.spec.cjs`); the
 * `useApplicationView(companyId, driverId, null, onClose, null)` argument list;
 * the `'application'` initial tab and every tab state value; the
 * `deleteApplication({ companyId, applicationId, collectionName })` payload and
 * the `onDeleted()` → `onClose()` ordering after a successful delete; the
 * `company_admin`-of-this-company OR `super_admin` delete rule; and every
 * confirmation string.
 *
 * DEFECTS FIXED (2026-07-27):
 * - The dialog was hand-rolled: `role="dialog"`/`aria-modal` with **no focus
 *   containment, no focus move-in and no focus restoration**. Tab walked straight
 *   out of the dossier into the page behind it, and closing dumped the keyboard
 *   user back at the top of the document. It now uses the shared accessible
 *   `Modal`, which owns all three.
 * - Escape was a `window` listener owned by this component. While a delete was
 *   in flight the confirmation's own `onClose` is intentionally `undefined`, so
 *   nothing stopped the event and Escape tore down the whole dossier
 *   mid-delete. `Modal` now owns Escape per dialog, so Escape dismisses the
 *   topmost one and is inert while deleting.
 * - The layout was `flex-row` with a fixed **280 px** sidebar inside a `90vw`
 *   panel. At 412 px that left roughly 90 px for the actual content. The panel is
 *   now full-screen below `sm` with the navigation as a horizontal strip, and the
 *   three-pane desktop layout from `sm` up.
 * - Loading was a bare spinning icon (no role, no text) and the error was a plain
 *   `<div>`; neither was announced. They are now `role="status"` / `role="alert"`.
 * - The destructive confirmation focused its first focusable element, which was
 *   the destructive button. It now opens with focus on Cancel.
 */
export function DriverProfileModal({
    companyId,
    driverId,
    isOpen,
    onClose,
    onDeleted,
}) {
    const [activeTab, setActiveTab] = useState('application');
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    const cancelDeleteRef = useRef(null);
    const tabPanelRef = useRef(null);
    /*
      One id base, shared with the sidebar that renders the strip.
      `tabIds` derives both halves of the `aria-controls` / `aria-labelledby`
      pair from it, which is why this component no longer hands two
      id-builder functions across a prop boundary — that was the drift the
      primitive's `tabIds` export was written to prevent.
    */
    const tabsIdBase = `dossier-${useId().replace(/:/g, '')}`;

    const { currentUserClaims } = useData();
    const isCompanyAdmin = currentUserClaims?.roles?.[companyId] === 'company_admin'
        || currentUserClaims?.roles?.globalRole === 'super_admin';
    const { deleting, deleteApplication } = useApplicationDelete();

    // Use the existing hook for data fetching
    // We pass onClose as onClosePanel to the hook
    const {
        loading,
        error,
        appData,
        companyProfile,
        currentStatus,
        isEditing,
        setIsEditing,
        isSaving,
        canEdit,
        handleStatusUpdate,
        handleAssignChange,
        handleSaveEdit,
        handleManagementComplete,
        fileUrls,
        dqStatus,
        collectionName,
        teamMembers,
        assignedTo,
    } = useApplicationView(companyId, driverId, null, onClose, null);

    const handleConfirmDelete = async () => {
        const ok = await deleteApplication({ companyId, applicationId: driverId, collectionName });
        if (ok) {
            setConfirmingDelete(false);
            onDeleted?.();
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <Modal
                label="Driver dossier"
                onClose={onClose}
                // `Modal` otherwise focuses the first focusable child, which in
                // DOM order is the sidebar's `tel:` link — so opening a dossier
                // put focus on a control that dials the driver the moment the
                // user pressed Enter. The dossier is a reading surface, so focus
                // goes to the tab panel: it is the scroll container, it is named
                // by the selected tab, and nothing happens if it is activated.
                initialFocusRef={tabPanelRef}
                // Backdrop dismissal is kept from the previous implementation.
                /*
                 * `7xl` is `min(80rem, 90vw)`, which is what `sm:w-[90vw]
                 * sm:max-w-7xl` already resolved to; `fill` is the `sm:h-[90vh]`.
                 * The `z-[60]` that used to sit here was compensating for the
                 * mobile drawer, which now sits a layer below every dialog — and
                 * the document preview inside this one is a DOM descendant, so
                 * it paints above regardless of the number.
                 */
                size="7xl"
                scroll="body"
                fill
                mobile="fullscreen"
            >
                {/*
                  The panel is a column (`scroll="body"`), so the two panes go
                  side by side inside this one child rather than on the panel.

                  Below `sm` the navigation is a horizontal strip above the
                  content; from `sm` up it is the fixed-width left pane. Same DOM
                  order either way, so the tab sequence never changes.
                */}
                <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                    <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface-subtle sm:h-full sm:w-[280px] sm:border-b-0 sm:border-r">
                        <DossierSidebar
                            appData={appData}
                            currentStatus={currentStatus}
                            activeTab={activeTab}
                            setActiveTab={setActiveTab}
                            loading={loading}
                            dqStatus={dqStatus}
                            idBase={tabsIdBase}
                        />
                    </div>

                    {/* Right Side Container */}
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-ds-surface sm:h-full">

                        {/*
                          The header wraps at every width and has a minimum height
                          rather than a fixed one. With `sm:flex-nowrap` + `sm:h-16`
                          the section title was squeezed to zero width at 1024 px —
                          it is `truncate`, so it did not ellipsise, it simply
                          vanished while the status/assign controls kept their full
                          width. Wrapping lets the actions drop to a second line
                          instead of eating the title.
                        */}
                        <div className="z-ds-raised flex shrink-0 flex-wrap items-center justify-between gap-ds-2 border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-3 sm:min-h-16 sm:px-ds-6">
                            <DossierHeader
                                activeTab={activeTab}
                                appData={appData}
                                companyProfile={companyProfile}
                                currentStatus={currentStatus}
                                onClose={onClose}
                                onStatusUpdate={handleStatusUpdate}
                                canEdit={canEdit}
                                teamMembers={teamMembers}
                                assignedTo={assignedTo}
                                onAssignChange={handleAssignChange}
                                canDelete={isCompanyAdmin}
                                onDelete={() => setConfirmingDelete(true)}
                            />
                        </div>

                        {/*
                          The tab panel is the scroll container, and it is
                          keyboard-focusable so a keyboard user can scroll long tab
                          content without tabbing through every control inside it.
                        */}
                        <TabPanel
                            ref={tabPanelRef}
                            idBase={tabsIdBase}
                            tabId={activeTab}
                            className="relative flex-1 overflow-y-auto overflow-x-hidden bg-ds-surface p-ds-4 sm:p-ds-6"
                        >
                            {loading ? (
                                <div
                                    role="status"
                                    /*
                                     * `raised`, the same layer as the header
                                     * above, and it still covers it: the tab
                                     * panel sets no z-index of its own, so this
                                     * overlay and that header compare directly —
                                     * and at equal z-index the later element in
                                     * the document wins. It was a bare `z-20`
                                     * outranking a bare `z-10`, which is the
                                     * same outcome by a route nobody could name.
                                     */
                                    className="absolute inset-0 z-ds-raised flex flex-col items-center justify-center gap-ds-2 bg-ds-surface/80"
                                >
                                    <Loader2 className="h-8 w-8 animate-spin text-ds-action-primary" aria-hidden="true" />
                                    <p className="text-ds-sm font-medium text-ds-content-secondary">Loading driver dossier…</p>
                                </div>
                            ) : error ? (
                                <div role="alert" className="p-ds-8 text-center">
                                    <p className="font-medium text-ds-status-danger-fg">Error loading application details.</p>
                                    <p className="mt-ds-2 text-ds-sm text-ds-content-secondary [overflow-wrap:anywhere]">{error}</p>
                                </div>
                            ) : (
                                <DossierContent
                                    activeTab={activeTab}
                                    appData={appData}
                                    driverId={driverId}
                                    companyId={companyId}
                                    collectionName={collectionName}
                                    isEditing={isEditing}
                                    setIsEditing={setIsEditing}
                                    handleSaveEdit={handleSaveEdit}
                                    isSaving={isSaving}
                                    fileUrls={fileUrls}
                                    canEdit={canEdit}
                                />
                            )}
                        </TabPanel>
                    </div>
                </div>
            </Modal>

            {confirmingDelete && (
                <Modal
                    onClose={deleting ? undefined : () => setConfirmingDelete(false)}
                    labelledBy="delete-app-title"
                    // Destructive dialogs open on the least destructive action.
                    initialFocusRef={cancelDeleteRef}
                    size="md"
                >
                    <div className="p-ds-6">
                        <div className="mb-ds-3 flex items-center gap-ds-3">
                            <span className="rounded-ds-md bg-ds-status-danger-bg p-ds-2 text-ds-status-danger-fg">
                                <AlertTriangle size={22} aria-hidden="true" />
                            </span>
                            <h2 id="delete-app-title" className="text-ds-body-lg font-bold text-ds-content">Delete this application?</h2>
                        </div>
                        <p className="mb-ds-6 text-ds-sm text-ds-content-secondary">
                            This permanently removes the application, its activity history, notes, and all
                            uploaded documents. This cannot be undone.
                        </p>
                        <div className="flex flex-col justify-end gap-ds-3 sm:flex-row">
                            <Button
                                ref={cancelDeleteRef}
                                variant="secondary"
                                onClick={() => setConfirmingDelete(false)}
                                disabled={deleting}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="danger"
                                onClick={handleConfirmDelete}
                                disabled={deleting}
                                loading={deleting}
                            >
                                {deleting ? 'Deleting…' : 'Delete permanently'}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}
        </>
    );
}
