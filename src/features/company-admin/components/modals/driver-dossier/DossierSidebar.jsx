import React, { useRef } from 'react';
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
 * DOCUMENTED EXCEPTION — feature-owned WAI-ARIA tab composition.
 * The design system has no approved Tabs primitive (`SectionNavigation` is a
 * vertical `nav` with `aria-current`, not a tablist), so this is a documented
 * feature-owned composition, matching the Documents Center precedent: real
 * `role="tablist"`/`role="tab"`, `aria-selected`, `aria-controls`, roving
 * `tabIndex`, and automatic activation on Arrow/Home/End.
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

const TAB_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function DossierSidebar({
    appData,
    currentStatus,
    activeTab,
    setActiveTab,
    loading,
    dqStatus,
    tabPanelId,
    tabIdFor = (tab) => `dossier-tab-${tab}`,
}) {
    const tabRefs = useRef({});
    const isCompact = useCompactViewport();

    // Contact Logic
    const email = appData?.email || '';
    const phone = appData?.phone || '';

    const initials = `${appData?.firstName?.[0] || ''}${appData?.lastName?.[0] || ''}`;
    const fullName = `${appData?.firstName || ''} ${appData?.lastName || ''}`.trim();

    // Automatic activation: Arrow/Home/End both move focus and select, so the
    // panel always matches the focused tab. Both axes are handled because the
    // strip is horizontal on small screens and vertical from `sm` up.
    const handleTabKeyDown = (event) => {
        if (!TAB_KEYS.has(event.key)) return;
        event.preventDefault();
        const currentIndex = NAV_ITEMS.findIndex((item) => item.id === activeTab);
        const lastIndex = NAV_ITEMS.length - 1;
        let nextIndex = currentIndex;
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
            nextIndex = (currentIndex - 1 + NAV_ITEMS.length) % NAV_ITEMS.length;
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
            nextIndex = (currentIndex + 1) % NAV_ITEMS.length;
        }
        if (event.key === 'Home') nextIndex = 0;
        if (event.key === 'End') nextIndex = lastIndex;
        const nextTab = NAV_ITEMS[nextIndex];
        setActiveTab(nextTab.id);
        tabRefs.current[nextTab.id]?.focus();
    };

    return (
        <div className="flex h-full flex-col">
            {/* Identity Header */}
            <div className="border-b border-ds-border-subtle bg-ds-surface p-ds-4 sm:p-ds-6">
                <div className="flex items-center gap-ds-4">
                    <span
                        aria-hidden="true"
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-ds-surface bg-ds-status-info-bg text-ds-body-lg font-bold text-ds-status-info-fg shadow-ds-xs sm:h-16 sm:w-16 sm:text-ds-heading-sm"
                    >
                        {initials}
                    </span>
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
                  Contact actions live in the identity block rather than a
                  desktop-only footer, so the Call/Email affordances survive the
                  compact layout instead of disappearing on phones — the devices
                  most likely to place the call.

                  DOCUMENTED EXCEPTION — styled `<a>` rather than an approved
                  control. `tel:` and `mailto:` are navigations, so a link is the
                  correct element; the design system has no Link/ButtonLink
                  primitive yet (recorded in the roadmap). Tokens only, 44 px
                  target, visible focus ring.
                */}
                <div className="mt-ds-4 grid grid-cols-2 gap-ds-2">
                    {phone ? (
                        <a
                            href={`tel:${phone}`}
                            className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border bg-ds-surface text-ds-xs font-semibold text-ds-content-secondary hover:border-ds-focus hover:text-ds-content-link focus-visible:outline-none focus-visible:shadow-ds-focus"
                        >
                            <Phone size={18} aria-hidden="true" />
                            <span>Call</span>
                        </a>
                    ) : (
                        <p className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                            <Phone size={18} aria-hidden="true" />
                            <span>No phone</span>
                        </p>
                    )}

                    {email ? (
                        <a
                            href={`mailto:${email}`}
                            className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border bg-ds-surface text-ds-xs font-semibold text-ds-content-secondary hover:border-ds-focus hover:text-ds-content-link focus-visible:outline-none focus-visible:shadow-ds-focus"
                        >
                            <Mail size={18} aria-hidden="true" />
                            <span>Email</span>
                        </a>
                    ) : (
                        <p className="flex min-h-11 flex-col items-center justify-center gap-ds-1 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle text-ds-xs font-medium text-ds-content-secondary">
                            <Mail size={18} aria-hidden="true" />
                            <span>No email</span>
                        </p>
                    )}
                </div>
            </div>

            {/* Navigation */}
            <div
                role="tablist"
                aria-label="Driver dossier sections"
                aria-orientation={isCompact ? 'horizontal' : 'vertical'}
                onKeyDown={handleTabKeyDown}
                className="flex flex-row gap-ds-1 overflow-x-auto px-ds-2 py-ds-2 sm:flex-1 sm:flex-col sm:overflow-x-visible sm:overflow-y-auto sm:px-ds-3 sm:py-ds-4"
            >
                {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    const isSelected = activeTab === item.id;
                    const flagIncomplete = item.id === 'dq' && dqStatus === 'incomplete';
                    return (
                        <button
                            key={item.id}
                            ref={(node) => { tabRefs.current[item.id] = node; }}
                            type="button"
                            role="tab"
                            id={tabIdFor(item.id)}
                            aria-selected={isSelected}
                            aria-controls={tabPanelId}
                            // Roving tabIndex: only the selected tab is in the tab order.
                            tabIndex={isSelected ? 0 : -1}
                            onClick={() => setActiveTab(item.id)}
                            className={`flex min-h-11 shrink-0 items-center gap-ds-3 whitespace-nowrap rounded-ds-md px-ds-4 py-ds-3 text-ds-sm font-medium transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus sm:w-full ${
                                isSelected
                                    ? 'border border-ds-border-subtle bg-ds-surface text-ds-content-link shadow-ds-xs'
                                    : 'border border-transparent text-ds-content-secondary hover:bg-ds-surface hover:text-ds-content'
                            }`}
                        >
                            <Icon
                                size={18}
                                aria-hidden="true"
                                className={isSelected ? 'text-ds-action-primary' : 'text-ds-content-muted'}
                            />
                            <span>{item.label}</span>
                            {/* Selection is carried by aria-selected plus this text, never
                                by the background colour alone. */}
                            {isSelected && <span className="ds-visually-hidden"> (selected)</span>}
                            {flagIncomplete && (
                                <>
                                    <span
                                        aria-hidden="true"
                                        className="ml-auto h-2 w-2 shrink-0 rounded-full bg-ds-status-danger-fg"
                                    />
                                    <span className="ds-visually-hidden">— incomplete</span>
                                </>
                            )}
                        </button>
                    );
                })}
            </div>

        </div>
    );
}
