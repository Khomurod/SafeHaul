/**
 * Queue status indicator.
 *
 * A floating notice showing when submissions are queued, when the app is
 * offline, and when the queue is being processed.
 *
 * Migrated to `--ds-*` status roles and `Button` on 2026-08-21. The four states,
 * their order of precedence, every string, the `processQueueNow` wiring and the
 * `useSubmissionQueue` contract are unchanged.
 *
 * Two real defects fixed along the way, both of which mattered most on the
 * surface this appears on — the public driver application, which is mobile-first
 * and is where a queued submission is a driver's completed application:
 *
 *  1. **It announced nothing.** Four states appeared and disappeared in silence.
 *     Going offline mid-application, or a queue error, is exactly the kind of
 *     thing a screen-reader user needs told. The region is now a live region:
 *     polite for the informational states, `alert` for the error.
 *  2. **The two actions were hand-built buttons** at `px-2 py-1 text-xs` — about
 *     22px tall, well under any touch-target guidance, on the most mobile-heavy
 *     screen in the product. They are `Button size="sm"` now, which is 36px.
 */

import React from 'react';
import { AlertCircle, CloudUpload, Loader2, WifiOff } from 'lucide-react';
import { Button } from '@design-system/components';
import { useSubmissionQueue } from '@/hooks/useSubmissionQueue';

/**
 * The shell every state shares. It was duplicated four times, which is how the
 * four states ended up with four different tints from three different palettes
 * (amber, blue, red, yellow) for what is one component.
 */
function QueueNotice({ tone, assertive = false, icon: Icon, iconClassName = '', children }) {
    const TONE_CLASSES = {
        warning: 'border-ds-status-warning-border bg-ds-status-warning-bg text-ds-status-warning-fg',
        info: 'border-ds-status-info-border bg-ds-status-info-bg text-ds-status-info-fg',
        danger: 'border-ds-status-danger-border bg-ds-status-danger-bg text-ds-status-danger-fg',
    };

    return (
        <div className="fixed bottom-4 right-4 z-50 animate-in fade-in slide-in-from-bottom-2">
            <div
                role={assertive ? 'alert' : 'status'}
                className={`flex items-center gap-ds-2 rounded-ds-md border px-ds-4 py-ds-3 shadow-ds-lg ${TONE_CLASSES[tone]}`}
            >
                <Icon size={18} aria-hidden="true" className={iconClassName} />
                {children}
            </div>
        </div>
    );
}

export function QueueStatusIndicator() {
    const {
        pendingCount,
        isProcessing,
        isOnline,
        hasQueuedItems,
        showQueueIndicator,
        processQueueNow,
        error,
    } = useSubmissionQueue();

    if (!showQueueIndicator && isOnline) {
        return null;
    }

    if (!isOnline) {
        return (
            <QueueNotice tone="warning" icon={WifiOff}>
                <span className="text-ds-sm font-medium">
                    You&apos;re offline
                    {hasQueuedItems && ` • ${pendingCount} pending`}
                </span>
            </QueueNotice>
        );
    }

    if (isProcessing) {
        return (
            <QueueNotice tone="info" icon={Loader2} iconClassName="animate-spin">
                <span className="text-ds-sm font-medium">
                    Submitting {pendingCount} queued application{pendingCount > 1 ? 's' : ''}...
                </span>
            </QueueNotice>
        );
    }

    if (error) {
        return (
            <QueueNotice tone="danger" assertive icon={AlertCircle}>
                <span className="text-ds-sm font-medium">Queue error</span>
                <Button size="sm" variant="secondary" onClick={processQueueNow}>
                    Retry
                </Button>
            </QueueNotice>
        );
    }

    if (hasQueuedItems) {
        return (
            <QueueNotice tone="warning" icon={CloudUpload}>
                <span className="text-ds-sm font-medium">
                    {pendingCount} application{pendingCount > 1 ? 's' : ''} pending
                </span>
                <Button size="sm" variant="secondary" onClick={processQueueNow}>
                    Submit Now
                </Button>
            </QueueNotice>
        );
    }

    return null;
}

export default QueueStatusIndicator;
