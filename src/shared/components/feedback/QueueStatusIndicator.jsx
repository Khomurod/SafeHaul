/**
 * Queue Status Indicator
 * 
 * A floating indicator that shows when there are pending submissions
 * or when the app is offline/processing the queue.
 */

import React from 'react';
import { WifiOff, CloudUpload, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useSubmissionQueue } from '@/hooks/useSubmissionQueue';

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

    // Don't show if nothing to display
    if (!showQueueIndicator && isOnline) {
        return null;
    }

    // Offline state
    if (!isOnline) {
        return (
            <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 text-amber-800 rounded-lg shadow-lg border border-amber-200">
                    <WifiOff size={18} />
                    <span className="text-sm font-medium">
                        You're offline
                        {hasQueuedItems && ` • ${pendingCount} pending`}
                    </span>
                </div>
            </div>
        );
    }

    // Processing state
    if (isProcessing) {
        return (
            <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center gap-2 px-4 py-3 bg-blue-100 text-blue-800 rounded-lg shadow-lg border border-blue-200">
                    <Loader2 size={18} className="animate-spin" />
                    <span className="text-sm font-medium">
                        Submitting {pendingCount} queued application{pendingCount > 1 ? 's' : ''}...
                    </span>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center gap-2 px-4 py-3 bg-red-100 text-red-800 rounded-lg shadow-lg border border-red-200">
                    <AlertCircle size={18} />
                    <span className="text-sm font-medium">Queue error</span>
                    <button
                        onClick={processQueueNow}
                        className="ml-2 px-2 py-1 text-xs font-bold bg-red-200 rounded hover:bg-red-300 transition-colors"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    // Has queued items (online but not processing)
    if (hasQueuedItems) {
        return (
            <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-2 fade-in">
                <div className="flex items-center gap-2 px-4 py-3 bg-yellow-100 text-yellow-800 rounded-lg shadow-lg border border-yellow-200">
                    <CloudUpload size={18} />
                    <span className="text-sm font-medium">
                        {pendingCount} application{pendingCount > 1 ? 's' : ''} pending
                    </span>
                    <button
                        onClick={processQueueNow}
                        className="ml-2 px-2 py-1 text-xs font-bold bg-yellow-200 rounded hover:bg-yellow-300 transition-colors"
                    >
                        Submit Now
                    </button>
                </div>
            </div>
        );
    }

    return null;
}

export default QueueStatusIndicator;
