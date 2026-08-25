import React, { useState, useEffect, useRef } from 'react';
import { Bell, Check, Clock, User, Briefcase, FileText } from 'lucide-react';
import { Badge, Button, IconButton } from '@/design-system/components';
import { useCompanyNotifications } from '../hooks/useCompanyNotifications';

// Icon mapping for notification types
const getNotificationIcon = (type) => {
    switch (type) {
        case 'lead_assigned': return <Briefcase size={16} className="text-ds-status-info-fg" />;
        case 'status_change': return <FileText size={16} className="text-ds-status-success-fg" />;
        case 'team_activity': return <User size={16} className="text-ds-status-accent-fg" />;
        default: return <Bell size={16} className="text-ds-content-muted" />;
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

export function NotificationDropdown({ companyId }) {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    const {
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead
    } = useCompanyNotifications(companyId);

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
                label="Notifications"
                variant="ghost"
                onClick={() => setIsOpen(!isOpen)}
                className={`relative ${isOpen ? 'text-ds-status-info-fg bg-ds-status-info-bg' : ''}`}
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <Bell size={20} aria-hidden="true" />
                {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-ds-action-danger text-ds-content-inverse text-ds-xs font-bold rounded-ds-full flex items-center justify-center border-2 border-ds-surface shadow-ds-xs">
                        {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                )}
            </IconButton>

            {/* Dropdown Panel */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-[min(24rem,calc(100vw-1.5rem))] bg-ds-surface rounded-ds-lg shadow-ds-lg border border-ds-border-subtle z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
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
                                <Check size={12} aria-hidden="true" /> Mark all read
                            </Button>
                        )}
                    </div>

                    {/* Notification List */}
                    <div className="max-h-96 overflow-y-auto">
                        {loading ? (
                            <div className="p-8 text-center">
                                <div className="animate-spin w-6 h-6 border-2 border-ds-action-primary border-t-transparent rounded-ds-full mx-auto"></div>
                                <p className="text-ds-body text-ds-content-muted mt-2">Loading...</p>
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="p-8 text-center">
                                <div className="w-12 h-12 bg-ds-surface-subtle rounded-ds-full flex items-center justify-center mx-auto mb-3">
                                    <Bell size={24} className="text-ds-content-muted" />
                                </div>
                                <p className="text-ds-body font-medium text-ds-content">All caught up!</p>
                                <p className="text-ds-xs text-ds-content-muted mt-1">No new notifications</p>
                            </div>
                        ) : (
                            notifications.map(notif => (
                                <div
                                    key={notif.id}
                                    onClick={() => !notif.read && markAsRead(notif.id)}
                                    className={`px-4 py-3 border-b border-ds-border-subtle hover:bg-ds-surface-hover cursor-pointer transition-colors ${!notif.read ? 'bg-ds-status-info-bg' : ''}`}
                                >
                                    <div className="flex gap-3">
                                        <div className={`w-8 h-8 rounded-ds-md flex items-center justify-center ${!notif.read ? 'bg-ds-surface shadow-ds-sm' : 'bg-ds-surface-subtle'}`}>
                                            {getNotificationIcon(notif.type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={`text-ds-body ${!notif.read ? 'font-semibold text-ds-content' : 'text-ds-content-secondary'}`}>
                                                {notif.title || 'Notification'}
                                            </p>
                                            <p className="text-ds-xs text-ds-content-muted mt-0.5 truncate">
                                                {notif.message}
                                            </p>
                                            <p className="text-ds-xs text-ds-content-muted mt-1 flex items-center gap-1">
                                                <Clock size={12} aria-hidden="true" />
                                                {timeAgo(notif.createdAt)}
                                            </p>
                                        </div>
                                        {!notif.read && (
                                            <div className="w-2 h-2 bg-ds-action-primary rounded-ds-full mt-2"></div>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
