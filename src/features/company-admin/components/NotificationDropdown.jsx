import React, { useState, useEffect, useRef } from 'react';
import { Icon, Bell, Check, Clock, User, Briefcase, FileText, FileCheck, AlertTriangle } from '@design-system/icons';
import { Badge, Button, IconButton } from '@/design-system/components';
import { ErrorState } from '@design-system/patterns';
import { useCompanyNotifications } from '../hooks/useCompanyNotifications';

// Icon mapping for notification types
const getNotificationIcon = (type) => {
    switch (type) {
        case 'lead_assigned':
        case 'leads_assigned':
        case 'application_assigned': return <Icon icon={Briefcase} className="text-ds-status-info-fg" />;
        case 'status_change': return <Icon icon={FileText} className="text-ds-status-success-fg" />;
        case 'team_activity': return <Icon icon={User} className="text-ds-status-accent-fg" />;
        case 'document_signed': return <Icon icon={FileCheck} className="text-ds-status-success-fg" />;
        case 'document_seal_failed': return <Icon icon={AlertTriangle} className="text-ds-status-danger-fg" />;
        // A hired driver's DQ document (`functions/notifyDqExpiry.js`).
        case 'dq_expiring': return <Icon icon={AlertTriangle} className="text-ds-status-warning-fg" />;
        case 'dq_expired': return <Icon icon={AlertTriangle} className="text-ds-status-danger-fg" />;
        default: return <Icon icon={Bell} className="text-ds-content-muted" />;
    }
};

// Time ago format
const timeAgo = (date) => {
    if (!date) return '';
    const now = new Date();
    const then = date.toDate ? date.toDate() : new Date(date);
    const diff = Math.floor((now - then) / 1000);

    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
};

// The dossier tab a notice about a record is about, by its type, so the notices
// already sent open it too: a signed or unsealed document (`sealNotifications.js`)
// its Documents to sign, a PEV answer or no-response (`employmentVerification/
// notifications.js`) Previous Employment, a DQ deadline (`notifyDqExpiry.js`) the
// DQ File. A request for a new link (`requestNewLink.js`) opens where the link is
// sent again: a document's on Documents to sign, a PEV's on Previous Employment,
// a change review's on Application (Email review link). Any other opens the
// dossier on its first tab.
const DOSSIER_TAB_BY_TYPE = Object.freeze({
    document_signed: 'documents',
    document_seal_failed: 'documents',
    pev_completed: 'pev',
    pev_no_response: 'pev',
    dq_expiring: 'dq',
    dq_expired: 'dq',
    signing_link_requested: 'documents',
    pev_link_requested: 'pev',
    review_link_requested: 'application',
});

// The server's notifications name the record they are about: the dossier
// finds an application or a lead by its id, and E-Docs lists a signing request.
// An import's summary ("15 leads assigned to you", `leads_assigned`) names no
// record, so its type opens the reader's Assigned to me list: those already
// sent open it too.
const openerOf = (notif, onOpenRecord, onOpenDocuments, onOpenAssignedLeads) => {
    if (notif.type === 'leads_assigned') return onOpenAssignedLeads || null;
    if (!notif.relatedId) return null;
    if (onOpenRecord && (notif.relatedType === 'application' || notif.relatedType === 'lead')) {
        const collection = notif.relatedType === 'lead' ? 'leads' : 'applications';
        return () => onOpenRecord(notif.relatedId, DOSSIER_TAB_BY_TYPE[notif.type], collection);
    }
    return onOpenDocuments && notif.relatedType === 'signing_request' ? onOpenDocuments : null;
};

/**
 * `onOpenRecord(id, tab, collection)` opens a record's dossier, on `tab` when the
 * notice is about one (else undefined: the first tab), looking for it first in
 * `collection` (`'applications'` or `'leads'`, from the notice's type); the shell
 * renders it.
 * `onOpenDocuments()` opens E-Docs; `onOpenAssignedLeads()` the Leads list's
 * Assigned to me tab.
 */
export function NotificationDropdown({ companyId, onOpenRecord, onOpenDocuments, onOpenAssignedLeads }) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);
    const bellRef = useRef(null);

    const {
        notifications,
        unreadCount,
        loading,
        error,
        retry,
        markAsRead,
        markAllAsRead
    } = useCompanyNotifications(companyId);

    const openNotification = (notif, open) => {
        // A failed write is logged by the hook; the record opens either way.
        if (!notif.read) markAsRead(notif.id).catch(() => {});
        // The row goes with the panel, so the dossier, which returns focus to
        // where it found it, returns it to the bell.
        bellRef.current?.focus();
        setIsOpen(false);
        open();
    };

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Bell Button */}
            <IconButton
                ref={bellRef}
                label="Notifications"
                variant="ghost"
                onClick={() => setIsOpen(!isOpen)}
                className={`relative ${isOpen ? 'text-ds-status-info-fg bg-ds-status-info-bg' : ''}`}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <Icon icon={Bell} size="xl" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-ds-action-danger text-ds-content-inverse text-ds-xs font-bold rounded-ds-full flex items-center justify-center border-2 border-ds-surface shadow-ds-xs">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </IconButton>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-1.5rem))] bg-ds-surface rounded-ds-lg shadow-ds-lg border border-ds-border-subtle z-ds-dropdown overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-ds-border-subtle bg-ds-surface-subtle flex justify-between items-center">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-ds-content">Notifications</h3>
                            {unreadCount > 0 && (
                                <Badge tone="info">
                                    {unreadCount} new
                                </Badge>
                            )}
                        </div>
                        {unreadCount > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={markAllAsRead}
                            >
                                <Icon icon={Check} size="xs" /> Mark all read
                            </Button>
                        )}
                    </div>

                    {/* Notification List */}
                    <div className="max-h-96 overflow-y-auto">
                        {/* A failed read is not "All caught up!": it says so and
                            reads again on Retry. The reader's own reminders, if
                            their read answered, still show below it. */}
                        {!loading && error && (
                            <ErrorState
                                surface="bare"
                                headingLevel={4}
                                title="Notifications could not be loaded."
                                description="Check your internet connection, then press Retry."
                                actions={(
                                    <Button variant="secondary" size="sm" onClick={retry}>
                                        Retry
                                    </Button>
                                )}
                            />
                        )}
                        {loading ? (
                            <div className="p-8 text-center">
                                <div className="animate-spin w-6 h-6 border-2 border-ds-action-primary border-t-transparent rounded-ds-full mx-auto"></div>
                                <p className="text-ds-body text-ds-content-muted mt-2">Loading...</p>
                            </div>
                        ) : notifications.length === 0 && !error ? (
                            <div className="p-8 text-center">
                                <div className="w-12 h-12 bg-ds-surface-subtle rounded-ds-full flex items-center justify-center mx-auto mb-3">
                                    <Icon icon={Bell} size="2xl" className="text-ds-content-muted" />
                                </div>
                                <p className="text-ds-body font-medium text-ds-content">All caught up!</p>
                                <p className="text-ds-xs text-ds-content-muted mt-1">No new notifications</p>
                            </div>
                        ) : (
                            notifications.map((notif) => {
                                const open = openerOf(notif, onOpenRecord, onOpenDocuments, onOpenAssignedLeads);
                                const content = (
                                    <>
                                        <span className={`w-8 h-8 rounded-ds-md flex items-center justify-center ${!notif.read ? 'bg-ds-surface shadow-ds-sm' : 'bg-ds-surface-subtle'}`}>
                                            {getNotificationIcon(notif.type)}
                                        </span>
                                        <span className="flex-1 min-w-0">
                                            <span className={`block text-ds-body ${!notif.read ? 'font-semibold text-ds-content' : 'text-ds-content-secondary'}`}>
                                                {notif.title || 'Notification'}
                                                {!notif.read && <span className="ds-visually-hidden"> (unread)</span>}
                                            </span>
                                            <span className="block text-ds-xs text-ds-content-muted mt-0.5 truncate">
                                                {notif.message}
                                            </span>
                                            {open && notif.relatedType === 'signing_request' && (
                                                <span className="block text-ds-xs text-ds-content-link mt-0.5">Open E-Docs</span>
                                            )}
                                            <span className="text-ds-xs text-ds-content-muted mt-1 flex items-center gap-1">
                                                <Icon icon={Clock} size="xs" />
                                                {timeAgo(notif.createdAt)}
                                            </span>
                                        </span>
                                        {!notif.read && (
                                            <span aria-hidden="true" className="w-2 h-2 bg-ds-action-primary rounded-ds-full mt-2"></span>
                                        )}
                                    </>
                                );
                                return (
                                    <div
                                        key={notif.id}
                                        className={`px-4 py-3 border-b border-ds-border-subtle transition-colors ${open ? 'hover:bg-ds-surface-hover' : ''} ${!notif.read ? 'bg-ds-status-info-bg' : ''}`}
                                    >
                                        {/* A notification about a record is the row's own
                                            button, unstyled: the row draws it. It opens the
                                            record (a signing request, in E-Docs), from the
                                            keyboard too. One about no record has nothing to
                                            open, so it is plain text, and "Mark all read"
                                            clears it. */}
                                        {open ? (
                                            <button
                                                type="button"
                                                onClick={() => openNotification(notif, open)}
                                                className="flex w-full gap-3 text-left focus-visible:shadow-ds-focus"
                                            >
                                                {content}
                                            </button>
                                        ) : (
                                            <div className="flex w-full gap-3">{content}</div>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
