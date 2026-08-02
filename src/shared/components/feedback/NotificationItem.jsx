import React from 'react';
import { Clock, Calendar, ExternalLink, Check, X } from 'lucide-react';
import { updateNotificationStatus } from '@lib/notificationService';
import { Badge, IconButton } from '@/design-system/components';

/**
 * One row in the notification dropdown.
 *
 * Migrated to the design system 2026-07-28 as part of the "Toast/notification"
 * roadmap row, alongside `ToastProvider` and `NotificationBell`.
 *
 * Presentation only. Frozen and unchanged: the `type === 'callback' &&
 * scheduledFor` rule, the `status === 'completed'` rule, the overdue rule
 * (`now > scheduledFor`) and the "due soon" 5-minute window, the
 * `updateNotificationStatus(id, 'completed' | 'dismissed')` calls, the
 * `createdAt.seconds` → local-time formatting with its `'Just now'` fallback, the
 * `scheduledFor` date/time formats, the `onClick` row behaviour, and every
 * user-facing string.
 *
 * Defects fixed:
 *  1. **The row was a `<li onClick>`** — no role, no `tabIndex`, no key handling.
 *     Opening a notification, the component's whole purpose, was mouse-only. The
 *     title is now a real button (pointer row-click is preserved), matching the
 *     pattern already used for the Super Admin company rows.
 *  2. **Both actions were hover-only *and* named by `title` alone.**
 *     `opacity-0 group-hover:opacity-100` meant a keyboard user could not see
 *     them, and a `title` is not a reliable accessible name. They are now
 *     `IconButton`s revealed on focus as well as hover, named with the
 *     notification they act on.
 *  3. **`text-[10px]` twice** — the callback time chip and the meta line.
 *  4. **`text-gray-400` on white = 2.56:1** on that same meta line, and
 *     `opacity-50` on the external-link marker took it lower.
 *  5. **Unread was communicated by a coloured dot alone**, with no text
 *     equivalent, so a screen-reader user could not tell read from unread.
 *  6. Legacy palette throughout (blue-50/500, orange-50/100/500/600, red-100/500/600,
 *     green-100/200/600, gray-50/100/300/500/700/900).
 */
export function NotificationItem({ notification, onClick }) {
    const {
        id,
        title,
        message,
        isRead,
        status,
        createdAt,
        scheduledFor,
        type,
        link
    } = notification;

    const isCallback = type === 'callback' && scheduledFor;
    const isCompleted = status === 'completed';

    let scheduledDate, isOverdue, isSoon;
    if (isCallback) {
        scheduledDate = new Date(scheduledFor);
        const now = new Date();
        isOverdue = now > scheduledDate && !isCompleted;
        isSoon = now > new Date(scheduledDate.getTime() - 5 * 60000) && !isCompleted;
    }

    let containerClass = "group relative flex gap-ds-3 border-b border-ds-border-subtle p-ds-4 transition-colors last:border-0 hover:bg-ds-surface-subtle";

    if (isCompleted) {
        containerClass += " bg-ds-surface-subtle";
    } else if (!isRead) {
        if (isCallback) containerClass += " bg-ds-status-warning-bg";
        else containerClass += " bg-ds-status-info-bg";
    } else {
        containerClass += " bg-ds-surface";
    }

    const handleAction = async (e, actionStatus) => {
        e.stopPropagation();
        await updateNotificationStatus(id, actionStatus);
    };

    const renderIcon = () => {
        if (isCompleted) {
            return (
                <span aria-hidden="true" className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ds-status-success-bg text-ds-status-success-fg">
                    <Check size={16} />
                </span>
            );
        }
        if (isCallback) {
            const iconTone = isOverdue
                ? 'bg-ds-status-danger-bg text-ds-status-danger-fg'
                : 'bg-ds-status-warning-bg text-ds-status-warning-fg';
            return (
                <span aria-hidden="true" className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
                    <Clock size={16} />
                </span>
            );
        }
        return (
            <span
                aria-hidden="true"
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${!isRead ? 'bg-ds-action-primary' : 'bg-ds-border'}`}
            />
        );
    };

    return (
        <li onClick={onClick} className={containerClass}>
            {renderIcon()}

            <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between">
                    {/*
                      Was a plain `<h4>` inside a click-only `<li>`. Making the
                      title the actionable control is what gives this row a
                      keyboard path at all.
                    */}
                    <h4 className="min-w-0 pr-6">
                        <button
                            type="button"
                            onClick={onClick}
                            className={`truncate text-left text-ds-sm focus-visible:outline-none focus-visible:shadow-ds-focus ${
                                !isRead ? 'font-bold text-ds-content' : 'font-medium text-ds-content-secondary'
                            } ${isCompleted ? 'text-ds-content-muted line-through' : ''}`}
                        >
                            {title}
                            {/* Unread was a coloured dot with no text equivalent. */}
                            {!isRead && !isCompleted && <span className="sr-only"> (unread)</span>}
                            {isCompleted && <span className="sr-only"> (completed)</span>}
                        </button>
                    </h4>

                    {isCallback && !isCompleted && (
                        <Badge tone={isOverdue ? 'danger' : 'neutral'}>
                            {scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </Badge>
                    )}
                </div>

                <p className={`mt-1 line-clamp-2 text-ds-xs text-ds-content-secondary ${isCompleted ? 'line-through' : ''}`}>{message}</p>

                <div className="mt-ds-2 flex items-center gap-ds-2 text-ds-xs text-ds-content-secondary">
                    {isCallback ? (
                        <>
                            <Calendar size={12} aria-hidden="true" /> {scheduledDate.toLocaleDateString()}
                            {isOverdue && !isCompleted && <span className="ml-auto font-bold text-ds-status-danger-fg">Overdue</span>}
                            {!isOverdue && isSoon && !isCompleted && <span className="ml-auto font-bold text-ds-status-warning-fg">Due Soon</span>}
                        </>
                    ) : (
                        <span>
                            {createdAt?.seconds
                                ? new Date(createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : 'Just now'}
                        </span>
                    )}
                </div>
            </div>

            {/*
              `focus-within` as well as `group-hover`: these were invisible to
              keyboard users, so the actions could be reached but never seen.
            */}
            <div className="absolute right-2 top-2 flex flex-col gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                {!isCompleted && (
                    <IconButton
                        label={`Mark "${title}" as complete`}
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleAction(e, 'completed')}
                    >
                        <Check size={12} aria-hidden="true" className="text-ds-status-success-fg" />
                    </IconButton>
                )}

                <IconButton
                    label={`Dismiss "${title}"`}
                    variant="ghost"
                    size="sm"
                    onClick={(e) => handleAction(e, 'dismissed')}
                >
                    <X size={12} aria-hidden="true" />
                </IconButton>
            </div>

            {link && (
                <span className="absolute bottom-2 right-2 text-ds-content-secondary">
                    <ExternalLink size={12} aria-hidden="true" />
                    <span className="sr-only">Opens a linked page</span>
                </span>
            )}
        </li>
    );
}
