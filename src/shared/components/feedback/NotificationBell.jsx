import React, { useId, useState, useRef, useEffect } from 'react';
import { Bell, Check, Phone } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '@shared/hooks/useNotifications';
import { NotificationItem } from './NotificationItem';
import { Badge, Button, IconButton } from '@/design-system/components';

/**
 * Notification bell and dropdown.
 *
 * Migrated to the design system 2026-07-28 as part of the "Toast/notification"
 * roadmap row, alongside `ToastProvider` and `NotificationItem`.
 *
 * Presentation only. Frozen and unchanged: the `useNotifications(userId)`
 * interface, the unread counts, the `upcomingCount > 0` → open on Callbacks rule
 * and its two fallbacks, the click-outside close, the
 * `markAsRead(id)`-then-`navigate(link)` item behaviour (and that a link-less
 * notification does *not* close the dropdown), `markListAsRead(activeTab)`, the
 * `'9+'` cap, and every user-facing string.
 *
 * Defects fixed:
 *  1. **The bell had no accessible name** — an icon-only `<button>` whose only
 *     children were a decorative `<Bell>`/`<Phone>` and a bare number. It now
 *     announces how many unread notifications there are and whether the panel is
 *     open (`aria-expanded`).
 *  2. **`text-[10px]` on the unread count badge.**
 *  3. **The tab strip was colour-only** — a blue-vs-orange bottom border with no
 *     `role="tab"`, no `aria-selected` and no arrow-key movement. It is now a real
 *     WAI-ARIA tab interface with roving focus, matching `AnalyticsView` and
 *     `CreateView`.
 *  4. **`animate-pulse` ran indefinitely** on the bell whenever a callback was
 *     due, with no reduced-motion guard. The urgent state is now carried by tone
 *     and by the announced name.
 *  5. **`text-gray-400` on white = 2.56:1** on the section label and both empty
 *     states, with `opacity-20` on the empty icons taking them lower still.
 *  6. **The scrolling list was an unnamed region** with no focusable child in the
 *     empty state.
 *  7. Legacy palette throughout, plus hard-coded `rounded-xl` / `shadow-2xl` /
 *     `text-xs` and a raw `<button>` for "Mark read".
 */

const TABS = [
    { id: 'general', label: 'General' },
    { id: 'callbacks', label: 'Callbacks' },
];

export function NotificationBell({ userId }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('general');
    const dropdownRef = useRef(null);
    const tabRefs = useRef({});
    const navigate = useNavigate();
    const tabsId = useId();
    const listLabelId = useId();

    const {
        general,
        callbacks,
        upcomingCount,
        markAsRead,
        markListAsRead
    } = useNotifications(userId);

    const unreadGeneral = general.filter(n => !n.isRead).length;
    const unreadCallbacks = callbacks.filter(n => !n.isRead).length;
    const totalUnread = unreadGeneral + unreadCallbacks;

    const handleToggle = () => {
        if (!isOpen) {
            if (upcomingCount > 0) {
                setActiveTab('callbacks');
            } else if (callbacks.length > 0 && general.length === 0) {
                setActiveTab('callbacks');
            } else {
                setActiveTab('general');
            }
        }
        setIsOpen(!isOpen);
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleItemClick = (notification) => {
        markAsRead(notification.id);
        if (notification.link) {
            navigate(notification.link);
            setIsOpen(false);
        }
    };

    // Roving focus: a tablist must respond to Arrow/Home/End, not just clicks.
    const onTabKeyDown = (event) => {
        const index = TABS.findIndex((t) => t.id === activeTab);
        let next = null;
        if (event.key === 'ArrowRight') next = TABS[(index + 1) % TABS.length];
        if (event.key === 'ArrowLeft') next = TABS[(index - 1 + TABS.length) % TABS.length];
        if (event.key === 'Home') next = TABS[0];
        if (event.key === 'End') next = TABS[TABS.length - 1];
        if (!next) return;
        event.preventDefault();
        setActiveTab(next.id);
        tabRefs.current[next.id]?.focus();
    };

    const unreadFor = (tabId) => (tabId === 'callbacks' ? unreadCallbacks : unreadGeneral);
    const bellLabel = upcomingCount > 0
        ? `Notifications: ${totalUnread} unread, ${upcomingCount} callback due`
        : `Notifications: ${totalUnread} unread`;

    return (
        <div className="relative" ref={dropdownRef}>
            <IconButton
                label={bellLabel}
                variant="ghost"
                aria-expanded={isOpen}
                onClick={handleToggle}
                className="relative"
            >
                {upcomingCount > 0
                    ? <Phone size={20} aria-hidden="true" className="text-ds-status-warning-fg" />
                    : <Bell size={20} aria-hidden="true" />}

                {totalUnread > 0 && (
                    <span
                        aria-hidden="true"
                        className={`absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full text-ds-xs font-bold text-ds-content-inverse ring-2 ring-ds-surface ${
                            upcomingCount > 0 ? 'bg-ds-action-danger' : 'bg-ds-action-primary'
                        }`}
                    >
                        {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                )}
            </IconButton>

            {isOpen && (
                <div className="absolute right-0 z-[9999] mt-2 w-80 overflow-hidden rounded-ds-lg border border-ds-border-subtle bg-ds-surface shadow-ds-lg sm:w-96">

                    <div
                        role="tablist"
                        aria-label="Notification categories"
                        onKeyDown={onTabKeyDown}
                        className="flex border-b border-ds-border-subtle bg-ds-surface-subtle"
                    >
                        {TABS.map((tab) => {
                            const selected = activeTab === tab.id;
                            const unread = unreadFor(tab.id);
                            return (
                                <button
                                    key={tab.id}
                                    type="button"
                                    role="tab"
                                    id={`${tabsId}-tab-${tab.id}`}
                                    aria-selected={selected}
                                    aria-controls={`${tabsId}-panel`}
                                    tabIndex={selected ? 0 : -1}
                                    ref={(node) => { tabRefs.current[tab.id] = node; }}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex flex-1 items-center justify-center gap-ds-2 border-b-2 py-ds-3 text-ds-xs font-bold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                        selected
                                            ? 'border-ds-action-primary bg-ds-surface text-ds-content-link'
                                            : 'border-transparent text-ds-content-secondary hover:text-ds-content'
                                    }`}
                                >
                                    {tab.label}
                                    {unread > 0 && (
                                        <Badge tone={tab.id === 'callbacks' ? 'warning' : 'neutral'}>
                                            {unread}
                                            <span className="sr-only"> unread</span>
                                        </Badge>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex items-center justify-between border-b border-ds-border-subtle bg-ds-surface px-ds-4 py-ds-2">
                        <span id={listLabelId} className="text-ds-xs font-medium text-ds-content-secondary">
                            {activeTab === 'callbacks' ? 'Scheduled Calls' : 'Recent Activity'}
                        </span>
                        {unreadFor(activeTab) > 0 && (
                            <Button variant="ghost" size="sm" onClick={() => markListAsRead(activeTab)}>
                                <Check size={12} aria-hidden="true" /> Mark read
                            </Button>
                        )}
                    </div>

                    <div
                        role="tabpanel"
                        id={`${tabsId}-panel`}
                        aria-labelledby={`${tabsId}-tab-${activeTab}`}
                        tabIndex={0}
                        className="max-h-[400px] overflow-y-auto focus-visible:outline-none focus-visible:shadow-ds-focus"
                    >
                        {activeTab === 'callbacks' ? (
                            callbacks.length === 0 ? (
                                <p role="status" className="p-ds-10 text-center text-ds-sm text-ds-content-secondary">
                                    <Phone size={32} className="mx-auto mb-ds-2 block" aria-hidden="true" />
                                    No scheduled callbacks.
                                </p>
                            ) : (
                                <ul aria-labelledby={listLabelId} className="divide-y divide-ds-border-subtle">
                                    {callbacks.map(note => (
                                        <NotificationItem
                                            key={note.id}
                                            notification={note}
                                            onClick={() => handleItemClick(note)}
                                        />
                                    ))}
                                </ul>
                            )
                        ) : (
                            general.length === 0 ? (
                                <p role="status" className="p-ds-10 text-center text-ds-sm text-ds-content-secondary">
                                    <Bell size={32} className="mx-auto mb-ds-2 block" aria-hidden="true" />
                                    No notifications yet.
                                </p>
                            ) : (
                                <ul aria-labelledby={listLabelId} className="divide-y divide-ds-border-subtle">
                                    {general.map(note => (
                                        <NotificationItem
                                            key={note.id}
                                            notification={note}
                                            onClick={() => handleItemClick(note)}
                                        />
                                    ))}
                                </ul>
                            )
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
