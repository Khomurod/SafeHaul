import React from 'react';
import { Icon, Phone, Mail } from '@design-system/icons';
import { Avatar, Button, ButtonLink, TabList } from '@design-system/components';
import { StatusBadge } from '@shared/components/badges/StatusBadge';
import { useCompactViewport } from './useCompactViewport';
import { dossierStatusLabel } from './dossierStatusLabel';
import { DossierKeyFacts } from './DossierKeyFacts';
import { DossierCloseButton } from './DossierHeader';
import { DOSSIER_SECTIONS, sectionTitle } from './dossierSections';

/**
 * Driver identity block plus the dossier's section navigation.
 *
 * Presentation uses the approved `Button` and `--ds-*` tokens.
 * Frozen contracts: the six navigation ids
 * (`application`, `documents`, `dq`, `pev`, `activity`, `notes`) in that order,
 * their visible labels (`documents` reads "Documents to sign": it holds only the
 * driver's signing documents, the uploads being in the DQ File tab), the exact
 * `setActiveTab(id)` values, the
 * `tel:` / `mailto:` href schemes, and the `dqStatus === 'incomplete'` rule.
 *
 * The strip is the design system's `TabList`. This is the split-across-components
 * case the primitive's `tabIds` export exists for: the sidebar owns the strip and
 * `DriverProfileModal` owns the panel, and both derive their ids from one
 * `idBase` rather than passing id-builder functions between them.
 *
 * `orientation` still follows the viewport, because that is a property of this
 * dossier's layout rather than of tabs in general: the strip is a horizontal row
 * on a phone and a vertical rail on a desktop, and `aria-orientation` has to
 * describe the one the user is looking at, or the arrow keys announce the wrong
 * axis.
 *
 * Rules this sidebar keeps:
 * - The navigation is a real tab interface — `tablist`, `aria-selected`,
 *   `aria-controls` and the arrow-key model — so assistive technology can say
 *   which section is current and a keyboard user does not Tab through all six.
 * - Selection is never signalled by background colour alone.
 * - The DQ-incomplete warning carries text, not a bare red dot, so a screen
 *   reader and anyone who cannot distinguish the colour both get it.
 * - The Call/Email labels stay at or above the 12 px interface floor.
 * - Missing contact details render as inert text, never as a live
 *   `<a href="tel:">` with `pointer-events-none`, which stays in the tab order
 *   and announces as a link pointing nowhere.
 * - Under Call and Email, the key facts (`DossierKeyFacts`): the phone and
 *   email as text, Do not text beside the phone, the day the record came in and
 *   the last call.
 *
 * On a phone the dossier does not render `DossierSidebar`: `DriverProfileModal`
 * lays out its parts. `DossierIdentityBar` (Close first, then the name and the
 * status on one line) and `DossierSectionTabs` stay at the top, and
 * `DossierDetails` (the rest of this column) scrolls away with the section, so
 * what stays fixed is two short rows rather than about 360 of 915 px.
 */


/**
 * The record a lead and the application it became name in each other, set by
 * the server when the lead's driver applied (`functions/shared/leadApplicationLink.js`),
 * or null. An application holds its own id as `applicationId`: only a lead's
 * names another record.
 */
function linkedRecordOf(appData, collectionName) {
    if (collectionName === 'leads' && appData?.applicationId) {
        return { id: appData.applicationId, text: 'Applied', action: 'Open application' };
    }
    if (collectionName === 'applications' && appData?.fromLeadId) {
        return { id: appData.fromLeadId, text: 'From a lead', action: 'Open lead' };
    }
    return null;
}

const nameOf = (appData) => `${appData?.firstName || ''} ${appData?.lastName || ''}`.trim();

/** Who referred the driver, and the lead or application this record names. */
function RecordLinks({ appData, collectionName, onOpenRecord }) {
    const linked = onOpenRecord ? linkedRecordOf(appData, collectionName) : null;
    return (
        <>
            {/* Set by the server from the link the driver came through. */}
            {appData?.referral?.code && (
                <p className="mt-ds-1 text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                    Referred by {appData.referral.referrerName || 'a driver'} · link {appData.referral.code}
                </p>
            )}
            {/* A `link` button: it shows the other record in this
                dossier rather than navigating. */}
            {linked && (
                <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">
                    {linked.text} ·{' '}
                    <Button variant="link" size="sm" onClick={() => onOpenRecord(linked.id)}>
                        {linked.action}
                    </Button>
                </p>
            )}
        </>
    );
}

/** Call and Email, then the key facts. */
function ContactBlock({ appData, collectionName, companyId, canEdit, logCall = null }) {
    // Contact Logic
    const email = appData?.email || '';
    const phone = appData?.phone || '';

    return (
        <>
            {/*
              `ButtonLink`, not a styled `<a>`: these are navigations
              (a dialler, a mail client), so they must be announced as
              links. The two-line tile shape comes from the caller; the
              border, radius, focus ring and hover are the primitive's.
            */}
            {/* One equal column per tile, so Log call sits between Call and Email when offered. */}
            <div className="mt-ds-4 grid auto-cols-fr grid-flow-col gap-ds-2">
                {phone ? (
                    <ButtonLink
                        href={`tel:${phone}`}
                        variant="secondary"
                        fullWidth
                        className="h-auto flex-col gap-ds-1 py-ds-2 text-ds-xs"
                    >
                        {/* Inside `ButtonLink`, whose `.ds-button__content > svg` rule owns the size. */}
                        <Icon icon={Phone} />
                        <span>Call</span>
                    </ButtonLink>
                ) : (
                    <p className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                        <Icon icon={Phone} size="lg" />
                        <span>No phone</span>
                    </p>
                )}

                {logCall}

                {email ? (
                    <ButtonLink
                        href={`mailto:${email}`}
                        variant="secondary"
                        fullWidth
                        className="h-auto flex-col gap-ds-1 py-ds-2 text-ds-xs"
                    >
                        <Icon icon={Mail} />
                        <span>Email</span>
                    </ButtonLink>
                ) : (
                    <p className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                        <Icon icon={Mail} size="lg" />
                        <span>No email</span>
                    </p>
                )}
            </div>

            <DossierKeyFacts appData={appData} collectionName={collectionName} companyId={companyId} canEdit={canEdit} />
        </>
    );
}

/**
 * The section navigation. Automatic activation: Arrow/Home/End both move focus
 * and select, so the panel always matches the focused tab. The strip is
 * horizontal on a phone and a vertical rail from `sm` up.
 */
export function DossierSectionTabs({ activeTab, setActiveTab, dqStatus, idBase = 'dossier', collectionName }) {
    const isCompact = useCompactViewport();
    // Each tab says its section's one name, the header's too (a lead's first: Lead).
    const isLead = collectionName === 'leads';
    return (
        <TabList
            ariaLabel="Driver dossier sections"
            idBase={idBase}
            activeTab={activeTab}
            onChange={setActiveTab}
            orientation={isCompact ? 'horizontal' : 'vertical'}
            className="gap-ds-1 overflow-x-auto px-ds-2 py-ds-2 sm:flex-1 sm:overflow-x-visible sm:overflow-y-auto sm:px-ds-3 sm:py-ds-4"
            tabs={DOSSIER_SECTIONS.map((item) => ({
                ...item,
                label: sectionTitle(item.id, { isLead }),
                badge: item.id === 'dq' && dqStatus === 'incomplete' ? (
                    <>
                        <span
                            aria-hidden="true"
                            className="ml-auto h-2 w-2 shrink-0 rounded-ds-full bg-ds-status-danger-fg"
                        />
                        <span className="ds-visually-hidden">— incomplete</span>
                    </>
                ) : null,
            }))}
        />
    );
}

/**
 * The dossier's top line on a phone: Close first, then whose dossier it is and
 * its status, on one line. The name is the same `<h2>` the desktop identity
 * block holds, cut short with an ellipsis rather than wrapped.
 */
export function DossierIdentityBar({ appData, currentStatus, onClose }) {
    return (
        <div className="flex shrink-0 items-center gap-ds-2 border-b border-ds-border-subtle bg-ds-surface py-ds-2 pl-ds-2 pr-ds-4">
            <DossierCloseButton onClose={onClose} />
            <h2 className="min-w-0 flex-1 truncate text-ds-body-lg font-bold text-ds-content">
                {nameOf(appData) || 'Driver'}
            </h2>
            <span className="shrink-0"><StatusBadge status={dossierStatusLabel(currentStatus)} /></span>
        </div>
    );
}

/**
 * The rest of the left column on a phone, at the top of what scrolls: the
 * referral and linked record, Call and Email, and the key facts.
 */
export function DossierDetails({ appData, collectionName, onOpenRecord, companyId, canEdit = false, logCall = null }) {
    return (
        <div className="border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-4 pb-ds-4 pt-ds-3">
            <RecordLinks appData={appData} collectionName={collectionName} onOpenRecord={onOpenRecord} />
            <ContactBlock appData={appData} collectionName={collectionName} companyId={companyId} canEdit={canEdit} logCall={logCall} />
        </div>
    );
}

export function DossierSidebar({
    appData,
    currentStatus,
    activeTab,
    setActiveTab,
    dqStatus,
    idBase = 'dossier',
    collectionName,
    onOpenRecord,
    companyId,
    canEdit = false,
    // Beside Call: the dossier's Log call (`DossierLogCall`), or nothing.
    logCall = null,
}) {
    const initials = `${appData?.firstName?.[0] || ''}${appData?.lastName?.[0] || ''}`;

    return (
        <div className="flex h-full flex-col">
            {/* Identity Header */}
            <div className="border-b border-ds-border-subtle bg-ds-surface p-ds-4 sm:p-ds-6">
                <div className="flex items-center gap-ds-4">
                    {/* 48px on a phone, 64px from 640px up — unchanged, and now
                        expressed through the contract's own responsive size
                        rather than a hand-written `sm:` pair. Primer types its
                        avatar the same way, for the same reason: a profile
                        header wants a larger disc where there is room. */}
                    <Avatar size={{ base: 'lg', sm: 'xl' }} tone="info" bordered>
                        {initials}
                    </Avatar>
                    <div className="min-w-0">
                        {/*
                          `<h2>` under the dialog's own accessible name. The name
                          is the driver's, so a screen-reader user knows whose
                          dossier they opened without hunting for it.
                        */}
                        <h2 className="text-ds-body-lg font-bold leading-tight text-ds-content [overflow-wrap:anywhere]">
                            {nameOf(appData) || 'Driver'}
                        </h2>
                        {/* Named as the header's status picker names it. */}
                        <div className="mt-ds-1"><StatusBadge status={dossierStatusLabel(currentStatus)} /></div>
                        <RecordLinks appData={appData} collectionName={collectionName} onOpenRecord={onOpenRecord} />
                    </div>
                </div>

                <ContactBlock appData={appData} collectionName={collectionName} companyId={companyId} canEdit={canEdit} logCall={logCall} />
            </div>

            {/* Navigation */}
            <DossierSectionTabs activeTab={activeTab} setActiveTab={setActiveTab} dqStatus={dqStatus} idBase={idBase} collectionName={collectionName} />
        </div>
    );
}
