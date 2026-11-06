import React, { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Icon, X, RotateCcw } from '@design-system/icons';
import { functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback';
import { useLoadMoreFocus } from '@shared/hooks/useLoadMoreFocus';
import { ConfirmDialog, Modal } from '@design-system/patterns';
import { Badge, Button, DataTable, IconButton, Notice } from '@/design-system/components';
import { sendResultOf } from '../constants/campaignConstants';
import { useCampaignLogs } from '../hooks/useCampaignLogs';
import { plainErrorMessage } from '@shared/utils/plainErrorMessage';

/** One row per recipient; the error detail wraps rather than widening the dialog. */
const REPORT_COLUMNS = [
    {
        key: 'recipient',
        header: 'Recipient',
        rowHeader: true,
        width: 'md',
        render: (log) => (
            <span className="text-ds-sm font-medium text-ds-content [overflow-wrap:anywhere]">{log.recipientName || 'Unknown'}</span>
        ),
    },
    {
        key: 'contact',
        header: 'Contact',
        width: 'sm',
        render: (log) => <span className="text-ds-sm">{log.recipientIdentity || 'N/A'}</span>,
    },
    {
        key: 'status',
        header: 'Status',
        width: 'md',
        render: (log) => {
            const result = sendResultOf(log);
            return <Badge tone={result.tone}>{result.label}</Badge>;
        },
    },
    {
        key: 'detail',
        header: 'Error Detail',
        width: 'xl',
        render: (log) => {
            const result = sendResultOf(log);
            return (
                <span className="text-ds-sm text-ds-content-muted [overflow-wrap:anywhere]">
                    {result.reason || result.note || '-'}
                </span>
            );
        },
    },
];

export default function DetailedReportModal({ companyId, sessionId, isOpen, onClose }) {
    const [retrying, setRetrying] = useState(false);
    // Replaces the blocking `window.confirm` on the retry action.
    const [pendingRetry, setPendingRetry] = useState(false);
    const { showSuccess, showError } = useToast();
    const { logs, loading, total, failedTotal, hasMore, loadMore, loadingMore, loadMoreFailed } = useCampaignLogs({
        companyId,
        sessionId,
        enabled: isOpen,
        countFailed: true,
        onError: (err) => {
            console.error('Error fetching logs:', err);
            showError('Failed to load delivery details. Check permissions.');
        },
    });
    const { buttonRef, doneRef, showDone, press } = useLoadMoreFocus({
        // Closing the report starts it afresh, even when it reopens on the same session.
        resetKey: isOpen ? sessionId : null,
        hasMore,
        isLoadingMore: loadingMore,
        loadMoreFailed,
        loadedCount: logs.length,
    });

    /**
     * Retry used to be guarded by a blocking `window.confirm`. It now opens the
     * approved accessible `ConfirmDialog`, nested inside this report dialog.
     *
     * This is a *costly* action — it creates a whole new campaign and re-sends to
     * every failed recipient, including permanent errors, except a text the SMS
     * provider never answered (the server leaves those out) — so the
     * dialog is explicitly destructive-toned and spells that out rather than
     * reading as an informational modal.
     */
    const confirmRetry = async () => {
        try {
            setRetrying(true);
            const retryFn = httpsCallable(functions, 'retryFailedAttempts');
            const result = await retryFn({
                companyId,
                originalSessionId: sessionId,
            });

            if (result.data.success) {
                showSuccess(`Retry session started with ${result.data.targetCount} targets.`);
                setPendingRetry(false);
                onClose();
            } else {
                // Leave the confirmation open so the operator can retry; the toast
                // wording is unchanged.
                showError(result.data.message || 'Retry failed to start.');
            }
        } catch (err) {
            console.error(err);
            showError(plainErrorMessage(err, 'The retry could not be started.'));
        } finally {
            setRetrying(false);
        }
    };

    // The server count covers failures beyond the rows shown; the rows are the
    // fallback when the count fails.
    const hasFailures = (failedTotal ?? 0) > 0 || logs.some((log) => log.status === 'failed' || log.isSuccess === false);

    if (!isOpen) return null;

    const shown = logs.length.toLocaleString('en-US');
    // The table announces its loading and empty states; this announces the count
    // once the records are in, without reading out any recipient's data.
    let loadedAnnouncement = '';
    if (!loading && logs.length > 0) {
        loadedAnnouncement = total > logs.length
            ? `${shown} of ${total.toLocaleString('en-US')} delivery records loaded`
            : `${shown} delivery ${logs.length === 1 ? 'record' : 'records'} loaded`;
    }

    return (
        <Modal
            onClose={onClose}
            labelledBy="delivery-report-title"
            size="4xl"
        >
            <div className="flex flex-col gap-ds-4 p-ds-6">
                <div className="flex items-start justify-between gap-ds-4">
                    <h2 id="delivery-report-title" className="text-ds-heading-sm font-bold text-ds-content">
                        Delivery Report
                    </h2>
                    <div className="flex items-center gap-ds-2">
                        {hasFailures && (
                            <Button
                                variant="danger"
                                size="sm"
                                onClick={() => setPendingRetry(true)}
                                loading={retrying}
                            >
                                {!retrying && <Icon icon={RotateCcw} size="sm" />}
                                {retrying ? 'Starting...' : 'Retry Failed Requests'}
                            </Button>
                        )}
                        <IconButton label="Close" size="sm" variant="ghost" onClick={onClose}>
                            <Icon icon={X} size="lg" />
                        </IconButton>
                    </div>
                </div>

                <p className="sr-only" role="status" aria-live="polite">{loadedAnnouncement}</p>

                <DataTable
                    ariaLabel="Per-recipient delivery results"
                    density="compact"
                    minWidth="none"
                    maxHeight="md"
                    data={logs}
                    columns={REPORT_COLUMNS}
                    getRowId={(log) => log.id}
                    isLoading={loading}
                    loadingLabel="Loading delivery details"
                    empty={{ title: 'No activity logs found. Ensure permissions are set.' }}
                />

                {hasMore && (
                    <Notice
                        tone="info"
                        size="sm"
                        actions={(
                            <Button ref={buttonRef} variant="secondary" size="sm" loading={loadingMore} onClick={press(loadMore)}>
                                Load more records
                            </Button>
                        )}
                    >
                        {total === null
                            ? `Showing the newest ${shown} delivery records.`
                            : `Showing the newest ${shown} of ${total.toLocaleString('en-US')} delivery records.`}
                    </Notice>
                )}
                {hasMore && loadMoreFailed && (
                    <p role="alert" className="text-ds-sm text-ds-status-danger-fg">More delivery records could not be loaded.</p>
                )}
                {showDone && (
                    <Notice ref={doneRef} tabIndex={-1} tone="info" size="sm">
                        {`All ${(total ?? logs.length).toLocaleString('en-US')} delivery records are shown.`}
                    </Notice>
                )}

                <div className="flex justify-end">
                    <Button variant="primary" size="md" onClick={onClose}>
                        Close
                    </Button>
                </div>
            </div>

            {/*
              Replaces `window.confirm('Start a new campaign for FAILED recipients
              only? This will retry permanent errors too.')`. Nested inside this
              report dialog: on success both unmount together, which is exactly the
              case the approved `Modal`'s connected-target focus-restore guard covers.
            */}
            <ConfirmDialog
                isOpen={pendingRetry}
                tone="danger"
                title="Start a new campaign for failed recipients?"
                description="This creates a new campaign and messages every failed recipient from this run again, including those that failed with permanent errors. Texts the SMS provider never answered are left out, as they may already have been delivered."
                confirmLabel="Start retry campaign"
                cancelLabel="Don't retry"
                loading={retrying}
                onConfirm={confirmRetry}
                onCancel={() => setPendingRetry(false)}
            />
        </Modal>
    );
}
