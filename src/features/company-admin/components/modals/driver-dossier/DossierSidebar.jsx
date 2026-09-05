import React from 'react';
import {
    LayoutDashboard,
    FileText,
    ShieldCheck,
    Activity,
    StickyNote,
    Phone,
    Mail,
    History,
} from 'lucide-react';
import { Avatar, ButtonLink, TabList } from '@design-system/components';
import { StatusBadge } from '@shared/components/badges/StatusBadge';
import { useCompactViewport } from './useCompactViewport';

/**
 * Driver identity block plus the dossier's section navigation.
 *
 * Presentation migrated to the approved `Button` and `--ds-*` tokens
 * (2026-07-27). Frozen contracts: the six navigation ids
 * (`application`, `documents`, `dq`, `pev`, `activity`, `notes`) in that order,
 * their visible labels, the exact `setActiveTab(id)` values, the
 * `tel:` / `mailto:` href schemes, and the `dqStatus === 'incomplete'` rule.
 *
 * The strip is the design system's `TabList` (2026-08-25). It was a feature-owned
 * WAI-ARIA composition, recorded as an exception because "the design system has
 * no approved Tabs primitive" — true when it was written, and untrue from
 * 2026-08-21, when `TabList` shipped naming this file as one of its nine intended
 * consumers. This is the split-across-components case the primitive's `tabIds`
 * export exists for: the sidebar owns the strip and `DriverProfileModal` owns the
 * panel, and they now derive their ids from one `idBase` instead of passing two
 * id-builder functions between them.
 *
 * `orientation` still follows the viewport, because that is a property of this
 * dossier's layout rather than of tabs in general: the strip is a horizontal row
 * on a phone and a vertical rail on a desktop, and `aria-orientation` has to
 * describe the one the user is looking at, or the arrow keys announce the wrong
 * axis.
 *
 * DEFECTS FIXED (2026-07-27):
 * - The navigation was six plain `<button>`s. There was no `tablist`, no
 *   `aria-selected`, no `aria-controls` and no arrow-key model, so assistive
 *   technology could not tell it was a tab interface, could not say which
 *   section was current, and a keyboard user had to Tab through all six.
 * - Selection was signalled by background colour alone.
 * - The DQ-incomplete warning was a bare red dot with no text or label —
 *   invisible to a screen reader and to anyone who cannot distinguish it.
 * - The Call/Email labels used `text-[10px]`, below the 12 px interface floor.
 * - The disabled contact state used `pointer-events-none` on a live
 *   `<a href="tel:">`, so it stayed in the tab order and announced as a link
 *   pointing nowhere. Missing contact details now render as inert text.
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
    loading,
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
                            <Phone aria-hidden="true" />
                            <span>Call</span>
                        </ButtonLink>
                    ) : (
                        <p className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                            <Phone size={18} aria-hidden="true" />
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
                            <Mail aria-hidden="true" />
                            <span>Email</span>
                        </ButtonLink>
                    ) : (
                        <p className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                            <Mail size={18} aria-hidden="true" />
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
