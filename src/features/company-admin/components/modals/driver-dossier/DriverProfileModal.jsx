import React, { useEffect, useId, useRef, useState } from 'react';
import { useApplicationView } from '@features/company-admin/hooks/useApplicationView';
import { useApplicationDelete } from '@features/applications/hooks/useApplicationDelete';
import { useData } from '@/context/DataContext';
import { ConfirmDialog, LoadingState, Modal } from '@design-system/patterns';
import { TabPanel } from '@/design-system/components';
import { DossierDetails, DossierIdentityBar, DossierSectionTabs, DossierSidebar } from './DossierSidebar';
import { DossierHeader } from './DossierHeader';
import { DossierContent } from './DossierContent';
import { DossierLogCall } from './DossierLogCall';
import { useCompactViewport } from './useCompactViewport';
import { useContactAttemptTexts } from './useContactAttemptTexts';
import { savedTextNote } from './contactAttemptText';
import { isCompanyAdminForRoute } from '@app/auth/roles';
import { forgetDriverUploadFilings } from '@features/company-admin/components/tabs/dqFileSync';

/**
 * DriverProfileModal
 *
 * The main container for the Driver Dossier. It manages the active tab state and
 * orchestrates data fetching via `useApplicationView`.
 *
 * Presentation uses the approved accessible `Modal`, `ConfirmDialog` and
 * `LoadingState` patterns and `--ds-*` tokens.
 *
 * Frozen contracts: the dialog's accessible name **"Driver dossier"** and the
 * fact that Escape closes it (both asserted by
 * `e2e/company-candidate-table.spec.cjs`); the
 * `useApplicationView(companyId, driverId, undefined, collectionHint)` argument
 * list;
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
 * - Loading and error are announced: the design system's `LoadingState`
 *   (`role="status"`) and a `role="alert"`.
 * - The destructive confirmation is the standard `ConfirmDialog`: it opens
 *   with focus on Cancel, Escape and Cancel are inert while the delete runs,
 *   and it names what it deletes: a lead (`collectionName`, the collection the
 *   record was found in), or an application.
 * - A lead and the application it became open each other here (the sidebar's
 *   "Open application" / "Open lead"): the dossier shows that record, on its
 *   first tab, until the page opens another.
 * - An opener that knows the record's collection names it (`collectionHint`,
 *   `'applications'` or `'leads'`), and so does the sidebar's link, so a lead is
 *   found in one read (`useAppFetch`); without one, applications are looked in
 *   first.
 * - It opens on the `'application'` tab unless the opener names another as
 *   `initialTab` (a bell notice or a Needs attention row opens the tab it is
 *   about).
 * - **Choosing a Contact Attempt stage says whether the driver is texted**
 *   (`useContactAttemptTexts`): the picker's option warns, and the saved
 *   status's confirmation adds that a text is queued, or that the driver may be
 *   texted. The server alone sends it (`functions/atsContactSms.js`).
 * - A call logged here (`DossierLogCall`) reads the record again, so the stage
 *   it moved and the last call show, and reopens Activity and Notes on their
 *   newest entries; the tab the recruiter is on stays.
 * - A tab may open another (`onOpenTab`: the DQ file's employers open Previous
 *   Employment). The panel then starts at its top and takes the focus, as the
 *   control that was pressed is gone.
 * - What the dossier does once a record while it is open is forgotten when it
 *   closes: the DQ tab's filing of the driver's uploads
 *   (`fileDriverUploadsOnce`).
 */
export function DriverProfileModal({
    companyId,
    driverId,
    isOpen,
    onClose,
    onDeleted,
    initialTab,
    collectionHint,
}) {
    const [activeTab, setActiveTab] = useState(initialTab || 'application');
    // The record shown: the one the page opened, or the one it links to, with
    // the collection each is known to be in.
    const [linked, setLinked] = useState(null);
    const showsLinked = linked?.from === driverId;
    const recordId = showsLinked ? linked.id : driverId;
    const recordCollectionHint = showsLinked ? linked.collection : collectionHint;
    const openLinkedRecord = (id, collection) => {
        setLinked({ from: driverId, id, collection });
        setActiveTab('application');
    };
    const [confirmingDelete, setConfirmingDelete] = useState(false);
    // Counts the calls logged here: Activity and Notes read again on each.
    const [callsLogged, setCallsLogged] = useState(0);
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
    // The next opening of the dossier files each record's uploads again.
    useEffect(() => () => forgetDriverUploadFilings(), []);

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
    } = useApplicationView(companyId, recordId, undefined, recordCollectionHint);
    const isLead = collectionName === 'leads';
    // What moving to a Contact Attempt stage does: the text the server sends.
    const textOutlookFor = useContactAttemptTexts({
        companyId,
        enabled: Boolean(isOpen && canEdit),
        currentStatus,
        record: loading || error ? null : appData,
        isLead,
    });
    const handleStageChange = (stage) => handleStatusUpdate(stage, { note: savedTextNote(textOutlookFor(stage)) });

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
                onStatusUpdate={handleStageChange}
                textOutlookFor={textOutlookFor}
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
            className="absolute inset-0 z-ds-raised flex flex-col items-center justify-center bg-ds-surface/80"
        >
            {/* The standard loading state, its own polite region. `h4`: it
                stands in for the section under the header's `h3`. */}
            <LoadingState surface="bare" headingLevel={4} title="Loading driver dossier…" />
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

            {/* Focus starts on Cancel; nothing closes it while the delete runs. */}
            <ConfirmDialog
                isOpen={confirmingDelete}
                tone="danger"
                title={isLead ? 'Delete this lead?' : 'Delete this application?'}
                description={`This permanently removes the ${isLead ? 'lead' : 'application'}, its activity history, `
                    + 'notes, and all uploaded documents. This cannot be undone.'}
                confirmLabel={deleting ? 'Deleting…' : 'Delete permanently'}
                loading={deleting}
                onConfirm={handleConfirmDelete}
                onCancel={() => setConfirmingDelete(false)}
            />
        </>
    );
}
