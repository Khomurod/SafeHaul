import React from 'react';
import { Icon, LayoutDashboard, FileText, ShieldCheck, Activity, StickyNote, Phone, Mail, History } from '@design-system/icons';
import { Avatar, ButtonLink, TabList } from '@design-system/components';
import { StatusBadge } from '@shared/components/badges/StatusBadge';
import { useCompactViewport } from './useCompactViewport';

/**
 * Driver identity block plus the dossier's section navigation.
 *
 * Presentation uses the approved `Button` and `--ds-*` tokens.
 * Frozen contracts: the six navigation ids
 * (`application`, `documents`, `dq`, `pev`, `activity`, `notes`) in that order,
 * their visible labels, the exact `setActiveTab(id)` values, the
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
 */

const NAV_ITEMS = [
    { id: 'application', label: 'Application', icon: LayoutDashboard },
    { id: 'documents', label: 'Documents', icon: FileText },
    { id: 'dq', label: 'DQ File', icon: ShieldCheck },
    { id: 'pev', label: 'Previous Employment', icon: History },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'notes', label: 'Notes', icon: StickyNote },
];

export function DossierSidebar({
    appData,
    currentStatus,
    activeTab,
    setActiveTab,
    dqStatus,
    idBase = 'dossier',
}) {
    const isCompact = useCompactViewport();

    // Contact Logic
    const email = appData?.email || '';
    const phone = appData?.phone || '';

    const initials = `${appData?.firstName?.[0] || ''}${appData?.lastName?.[0] || ''}`;
    const fullName = `${appData?.firstName || ''} ${appData?.lastName || ''}`.trim();

    // Automatic activation: Arrow/Home/End both move focus and select, so the
    // panel always matches the focused tab. Both axes are handled because the
    // strip is horizontal on small screens and vertical from `sm` up.
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
                            {fullName || 'Driver'}
                        </h2>
                        <div className="mt-ds-1"><StatusBadge status={currentStatus} /></div>
                        {/* Set by the server from the link the driver came through. */}
                        {appData?.referral?.code && (
                            <p className="mt-ds-1 text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                                Referred by {appData.referral.referrerName || 'a driver'} · link {appData.referral.code}
                            </p>
                        )}
                    </div>
                </div>

                {/*
                  `ButtonLink`, not a styled `<a>`: these are navigations
                  (a dialler, a mail client), so they must be announced as
                  links. The two-line tile shape comes from the caller; the
                  border, radius, focus ring and hover are the primitive's.
                */}
                <div className="mt-ds-4 grid grid-cols-2 gap-ds-2">
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
            </div>

            {/* Navigation */}
            <TabList
                ariaLabel="Driver dossier sections"
                idBase={idBase}
                activeTab={activeTab}
                onChange={setActiveTab}
                orientation={isCompact ? 'horizontal' : 'vertical'}
                className="gap-ds-1 overflow-x-auto px-ds-2 py-ds-2 sm:flex-1 sm:overflow-x-visible sm:overflow-y-auto sm:px-ds-3 sm:py-ds-4"
                tabs={NAV_ITEMS.map((item) => ({
                    ...item,
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

        </div>
    );
}
