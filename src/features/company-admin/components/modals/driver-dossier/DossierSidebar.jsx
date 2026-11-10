import React from 'react';
import { Icon, Phone, Mail, Link2, User } from '@design-system/icons';
import { Avatar, Badge, Button, ButtonLink, TabList } from '@design-system/components';
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
 * with the collection it is in, or null. An application holds its own id as
 * `applicationId`: only a lead's names another record.
 */
function linkedRecordOf(appData, collectionName) {
    if (collectionName === 'leads' && appData?.applicationId) {
        return { id: appData.applicationId, collection: 'applications', text: 'Applied', action: 'Open application' };
    }
    if (collectionName === 'applications' && appData?.fromLeadId) {
        return { id: appData.fromLeadId, collection: 'leads', text: 'From a lead', action: 'Open lead' };
    }
    return null;
}

const nameOf = (appData) => `${appData?.firstName || ''} ${appData?.lastName || ''}`.trim();

/** Who referred the driver, and the lead or application this record names. */
function RecordLinks({ appData, collectionName, onOpenRecord }) {
    const linked = onOpenRecord ? linkedRecordOf(appData, collectionName) : null;
    if (!appData?.referral?.code && !linked) return null;
    return (
        <div className="space-y-ds-1">
            {/* Set by the server from the link the driver came through. One
                text node, so it reads (and is found) as one sentence. */}
            {appData?.referral?.code && (
                <p className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                    <Icon icon={Link2} size="sm" className="mt-ds-1 shrink-0 text-ds-content-muted" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                        Referred by {appData.referral.referrerName || 'a driver'} · link {appData.referral.code}
                    </span>
                </p>
            )}
            {/* A `link` button: it shows the other record in this
                dossier rather than navigating. */}
            {linked && (
                <p className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                    <Icon icon={User} size="sm" className="mt-ds-1 shrink-0 text-ds-content-muted" />
                    <span className="min-w-0">
                        {linked.text} ·{' '}
                        <Button variant="link" size="sm" onClick={() => onOpenRecord(linked.id, linked.collection)}>
                            {linked.action}
                        </Button>
                    </span>
                </p>
            )}
        </div>
    );
}

/**
 * Call, Log call and Email in one row, then the key facts.
 *
 * Call is the primary action: it is the reason a recruiter opens a dossier from
 * a list, so it is the one filled button. The three share the row by content
 * (`flex-1` from a zero basis, never below their own width), so "Log call" keeps
 * one line at the sidebar's narrowest.
 */
function ContactBlock({ appData, collectionName, companyId, canEdit, logCall = null }) {
    const email = appData?.email || '';
    const phone = appData?.phone || '';

    return (
        <>
            {/*
              `ButtonLink`, not a styled `<a>`: these are navigations
              (a dialler, a mail client), so they must be announced as
              links. Border, radius, focus ring and hover are the primitive's.
            */}
            <div className="flex gap-ds-2 [&>*]:min-w-fit [&>*]:flex-1">
                {phone ? (
                    <ButtonLink href={`tel:${phone}`} variant="primary" size="sm">
                        {/* Inside `ButtonLink`, whose `.ds-button__content > svg` rule owns the size. */}
                        <Icon icon={Phone} />
                        <span>Call</span>
                    </ButtonLink>
                ) : (
                    <p className="flex min-h-9 items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                        <Icon icon={Phone} size="sm" />
                        <span>No phone</span>
                    </p>
                )}

                {logCall}

                {email ? (
                    <ButtonLink href={`mailto:${email}`} variant="secondary" size="sm">
                        <Icon icon={Mail} />
                        <span>Email</span>
                    </ButtonLink>
                ) : (
                    <p className="flex min-h-9 items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                        <Icon icon={Mail} size="sm" />
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
            /*
              On a phone the strip is one row that scrolls sideways
              (`flex-nowrap` over the primitive's wrapping row): wrapped, six
              sections took three rows and the selected underline sat between
              them. From `sm` it is the vertical rail.
            */
            className="flex-nowrap gap-ds-1 overflow-x-auto px-ds-2 [&>*]:shrink-0 [&>*]:whitespace-nowrap sm:flex-1 sm:overflow-x-visible sm:overflow-y-auto sm:px-ds-3 sm:py-ds-3"
            tabs={DOSSIER_SECTIONS.map((item) => ({
                ...item,
                label: sectionTitle(item.id, { isLead }),
                // A word, not a dot: the badge says it, and the name keeps its
                // "— incomplete" for assistive technology.
                badge: item.id === 'dq' && dqStatus === 'incomplete' ? (
                    <>
                        <span aria-hidden="true" className="ml-auto shrink-0 pl-ds-2">
                            <Badge tone="danger">Incomplete</Badge>
                        </span>
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
        <div className="space-y-ds-4 border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-4">
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
            {/* Identity, links to related records, then how to reach the driver. */}
            <div className="space-y-ds-4 border-b border-ds-border-subtle bg-ds-surface p-ds-5">
                <div className="flex items-start gap-ds-3">
                    {/* 48px: beside a two-line name it anchors the block without
                        taking the width the name needs. */}
                    <Avatar size="lg" tone="info" bordered>
                        {initials}
                    </Avatar>
                    <div className="min-w-0 flex-1">
                        {/*
                          `<h2>` under the dialog's own accessible name. The name
                          is the driver's, so a screen-reader user knows whose
                          dossier they opened without hunting for it. Balanced,
                          so a long name breaks into even lines.
                        */}
                        <h2 className="text-balance text-ds-heading-sm font-bold text-ds-content [overflow-wrap:anywhere]">
                            {nameOf(appData) || 'Driver'}
                        </h2>
                        {/* Named as the header's status picker names it. */}
                        <div className="mt-ds-2"><StatusBadge status={dossierStatusLabel(currentStatus)} /></div>
                    </div>
                </div>

                <RecordLinks appData={appData} collectionName={collectionName} onOpenRecord={onOpenRecord} />

                <ContactBlock appData={appData} collectionName={collectionName} companyId={companyId} canEdit={canEdit} logCall={logCall} />
            </div>

            {/* Navigation */}
            <DossierSectionTabs activeTab={activeTab} setActiveTab={setActiveTab} dqStatus={dqStatus} idBase={idBase} collectionName={collectionName} />
        </div>
    );
}
