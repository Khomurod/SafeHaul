import React, { useId, useRef, useState } from 'react';
import { Icon, Loader2, AlertTriangle } from '@design-system/icons';
import { useApplicationView } from '@features/company-admin/hooks/useApplicationView';
import { useApplicationDelete } from '@features/applications/hooks/useApplicationDelete';
import { useData } from '@/context/DataContext';
import { Modal } from '@design-system/patterns';
import { Button, TabPanel } from '@/design-system/components';
import { DossierDetails, DossierIdentityBar, DossierSectionTabs, DossierSidebar } from './DossierSidebar';
import { DossierHeader } from './DossierHeader';
import { DossierContent } from './DossierContent';
import { DossierLogCall } from './DossierLogCall';
import { useCompactViewport } from './useCompactViewport';
import { isCompanyAdminForRoute } from '@app/auth/roles';

/**
 * DriverProfileModal
 *
 * The main container for the Driver Dossier. It manages the active tab state and
 * orchestrates data fetching via `useApplicationView`.
 *
 * Presentation uses the approved accessible `Modal`, the approved `Button`
 * and `--ds-*` tokens.
 *
 * Frozen contracts: the dialog's accessible name **"Driver dossier"** and the
 * fact that Escape closes it (both asserted by
 * `e2e/company-candidate-table.spec.cjs`); the
 * `useApplicationView(companyId, driverId)` argument list;
 * the `'application'` initial tab and every tab state value; the
 * `deleteApplication({ companyId, applicationId, collectionName })` payload and
 * the `onDeleted()` → `onClose()` ordering after a successful delete; the
 * `company_admin`-of-this-company OR `super_admin` delete rule; and every
 * confirmation string (an application's; a lead's names the lead).
 *
 * Rules this dialog keeps:
 * - It is the shared accessible `Modal`, which owns focus containment, focus
 *   move-in and focus restoration, so Tab cannot walk out of the dossier into
 *   the page behind it and closing returns the keyboard user where they were.
 * - `Modal` owns Escape per dialog, so Escape dismisses the topmost one and is
 *   inert while deleting. No `window` listener here: while a delete is in flight
 *   the confirmation's own `onClose` is intentionally `undefined`, so such a
 *   listener would tear down the whole dossier mid-delete.
 * - The panel is full-screen below `sm` with the navigation as a horizontal
 *   strip, and the three-pane desktop layout from `sm` up; a fixed 280 px
 *   sidebar would leave about 90 px for the content at 412 px.
 * - **On a phone only two short rows stay put** (`useCompactViewport`, the
 *   breakpoint the classes switch on): Close, the name and the status on one
 *   line (`DossierIdentityBar`), then the section strip. Everything else, the
 *   driver's details, the section's header with its controls and the section
 *   itself, is in the tab panel and scrolls away together. The fixed name
 *   block, strip and header used to take about 360 of 915 px, with Close on
 *   the header's third row. The tab panel stays the one scroll container and
 *   the first focus on both layouts, at the top of what scrolls, so opening
 *   the dossier scrolls nothing away.
 * - Loading and error are announced: `role="status"` / `role="alert"`.
 * - The destructive confirmation opens with focus on Cancel, and names what
 *   it deletes: a lead (`collectionName`, the collection the record was found
 *   in), or an application.
 * - A lead and the application it became open each other here (the sidebar's
 *   "Open application" / "Open lead"): the dossier shows that record, on its
 *   first tab, until the page opens another.
 * - It opens on the `'application'` tab unless the opener names another as
 *   `initialTab` (a bell notice or a Needs attention row opens the tab it is
 *   about).
 * - A call logged here (`DossierLogCall`) reads the record again, so the stage
 *   it moved and the last call show, and reopens Activity and Notes on their
 *   newest entries; the tab the recruiter is on stays.
 * - A tab may open another (`onOpenTab`: the DQ file's employers open Previous
 *   Employment). The panel then starts at its top and takes the focus, as the
 *   control that was pressed is gone.
 */
export function DriverProfileModal({
    companyId,
    driverId,
    isOpen,
    onClose,
    onDeleted,
    initialTab,
}) {
    const [activeTab, setActiveTab] = useState(initialTab || 'application');
    // The record shown: the one the page opened, or the one it links to.
    const [linked, setLinked] = useState(null);
    const recordId = linked?.from === driverId ? linked.id : driverId;
    const openLinkedRecord = (id) => {
        setLinked({ from: driverId, id });
        setActiveTab('application');
    };
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    // Counts the calls logged here: Activity and Notes read again on each.
    const [callsLogged, setCallsLogged] = useState(0);
    const cancelDeleteRef = useRef(null);
    const tabPanelRef = useRef(null);
    const openTab = (id) => {
        setActiveTab(id);
        const panel = tabPanelRef.current;
        if (!panel) return;
        panel.scrollTop = 0;
        panel.focus();
    };
    /*
      One id base, shared with the sidebar that renders the strip.
      `tabIds` derives both halves of the `aria-controls` / `aria-labelledby`
      pair from it, which is why this component no longer hands two
      id-builder functions across a prop boundary — that was the drift the
      primitive's `tabIds` export was written to prevent.
    */
    const tabsIdBase = `dossier-${useId().replace(/:/g, '')}`;
    const isCompact = useCompactViewport();

    const { currentUserClaims } = useData();
    const isCompanyAdmin = isCompanyAdminForRoute(currentUserClaims, companyId);
    const { deleting, deleteApplication } = useApplicationDelete();

    const {
        loading,
        error,
        appData,
        currentStatus,
        canEdit,
        handleStatusUpdate,
        handleAssignChange,
        handleDownloadPdf,
        fileUrls,
        filesPending,
        dqStatus,
        collectionName,
        teamMembers,
        assignedTo,
        refreshRecord,
    } = useApplicationView(companyId, recordId);
    const isLead = collectionName === 'leads';

    const handleCallLogged = () => {
        refreshRecord?.();
        setCallsLogged((count) => count + 1);
    };

    const handleConfirmDelete = async () => {
        const ok = await deleteApplication({ companyId, applicationId: recordId, collectionName });
        if (ok) {
            setConfirmingDelete(false);
            onDeleted?.();
            onClose();
        }
    };

    if (!isOpen) return null;

    // What the left column shows about the driver, on either layout.
    const recordProps = {
        appData,
        collectionName,
        onOpenRecord: openLinkedRecord,
        companyId,
        // Do not text acts on the phone shown, which is the last record's while
        // the next loads or after its read failed.
        canEdit: canEdit && !loading && !error,
        logCall: (
            <DossierLogCall
                companyId={companyId}
                recordId={recordId}
                record={appData}
                collectionName={collectionName}
                canLog={canEdit && !loading && !error}
                onLogged={handleCallLogged}
            />
        ),
    };
    const tabsProps = { activeTab, setActiveTab, dqStatus, idBase: tabsIdBase, collectionName };

    const header = (
        /*
          The header wraps at every width and has a minimum height
          rather than a fixed one. With `sm:flex-nowrap` + `sm:h-16`
          the section title was squeezed to zero width at 1024 px —
          it is `truncate`, so it did not ellipsise, it simply
          vanished while the status/assign controls kept their full
          width. Wrapping lets the actions drop to a second line
          instead of eating the title.
        */
        <div className="z-ds-raised flex shrink-0 flex-wrap items-center justify-between gap-ds-2 border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-3 sm:min-h-16 sm:px-ds-6">
            <DossierHeader
                activeTab={activeTab}
                // `useAppFetch` keeps the last record's data until the next arrives.
                appData={loading || error ? null : appData}
                loading={loading}
                currentStatus={currentStatus}
                onClose={onClose}
                onStatusUpdate={handleStatusUpdate}
                canEdit={canEdit}
                teamMembers={teamMembers}
                assignedTo={assignedTo}
                onAssignChange={handleAssignChange}
                canDelete={isCompanyAdmin}
                onDelete={() => setConfirmingDelete(true)}
                onDownload={handleDownloadPdf}
                collectionName={collectionName}
                // On a phone, Close leads the identity bar instead.
                showClose={!isCompact}
            />
        </div>
    );

    const body = loading ? (
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
            <Icon icon={Loader2} size="3xl" className="animate-spin text-ds-action-primary" />
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
            driverId={recordId}
            companyId={companyId}
            collectionName={collectionName}
            fileUrls={fileUrls}
            filesPending={filesPending}
            canEdit={canEdit}
            refreshKey={callsLogged}
            onOpenTab={openTab}
        />
    );

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
                 * the dialogs opened inside this one are DOM descendants, so
                 * they paint above regardless of the number.
                 */
                size="7xl"
                scroll="body"
                fill
                mobile="fullscreen"
            >
                {isCompact ? (
                    /*
                      A phone: Close, the name and the strip stay; the driver's
                      details, the header and the section scroll together in the
                      tab panel, which is the first focus and already at the top.
                    */
                    <div className="flex min-h-0 flex-1 flex-col">
                        <DossierIdentityBar appData={appData} currentStatus={currentStatus} onClose={onClose} />
                        <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface-subtle">
                            <DossierSectionTabs {...tabsProps} />
                        </div>
                        <TabPanel
                            ref={tabPanelRef}
                            idBase={tabsIdBase}
                            tabId={activeTab}
                            className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-ds-surface"
                        >
                            <DossierDetails {...recordProps} />
                            {header}
                            <div className="p-ds-4">{body}</div>
                        </TabPanel>
                    </div>
                ) : (
                    /*
                      The panel is a column (`scroll="body"`), so the two panes go
                      side by side inside this one child rather than on the panel.
                    */
                    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
                        <div className="shrink-0 border-b border-ds-border-subtle bg-ds-surface-subtle sm:h-full sm:w-[280px] sm:border-b-0 sm:border-r">
                            <DossierSidebar {...recordProps} {...tabsProps} currentStatus={currentStatus} />
                        </div>

                        {/* Right Side Container */}
                        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-ds-surface sm:h-full">
                            {header}

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
                                {body}
                            </TabPanel>
                        </div>
                    </div>
                )}
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
                                {/* Same padding-sized tile, same two-pixel snap. */}
                                <Icon icon={AlertTriangle} size="xl" />
                            </span>
                            <h2 id="delete-app-title" className="text-ds-body-lg font-bold text-ds-content">
                                {isLead ? 'Delete this lead?' : 'Delete this application?'}
                            </h2>
                        </div>
                        <p className="mb-ds-6 text-ds-sm text-ds-content-secondary">
                            This permanently removes the {isLead ? 'lead' : 'application'}, its activity history, notes, and all
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
