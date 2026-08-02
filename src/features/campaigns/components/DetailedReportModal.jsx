import React, { useEffect, useState } from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { X, RotateCcw } from 'lucide-react';
import { db, functions } from '@lib/firebase';
import { useToast } from '@shared/components/feedback';
import { Modal } from '@shared/components/modals/Modal';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { Badge, Button, IconButton } from '@/design-system/components';

export default function DetailedReportModal({ companyId, sessionId, isOpen, onClose }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [retrying, setRetrying] = useState(false);
    // Replaces the blocking `window.confirm` on the retry action.
    const [pendingRetry, setPendingRetry] = useState(false);
    const { showSuccess, showError } = useToast();

    useEffect(() => {
        if (!isOpen || !companyId || !sessionId) return;

        const fetchLogs = async () => {
            try {
                setLoading(true);
                const logsRef = collection(db, 'companies', companyId, 'bulk_sessions', sessionId, 'logs');
                const q = query(logsRef, orderBy('timestamp', 'desc'), limit(200));
                const snapshot = await getDocs(q);

                const fetchedLogs = snapshot.docs.map((docSnap) => ({
                    id: docSnap.id,
                    ...docSnap.data(),
                }));
                setLogs(fetchedLogs);
            } catch (error) {
                console.error('Error fetching logs:', error);
                showError('Failed to load delivery details. Check permissions.');
            } finally {
                setLoading(false);
            }
        };

        fetchLogs();
    }, [isOpen, companyId, sessionId, showError]);

    /**
     * Retry used to be guarded by a blocking `window.confirm`. It now opens the
     * shared accessible `ConfirmDialog`, nested inside this report dialog.
     *
     * This is a *costly* action — it creates a whole new campaign and re-sends to
     * every failed recipient, including permanent errors — so the dialog is
     * explicitly destructive-toned and spells that out rather than reading as an
     * informational modal.
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
            showError(err.message);
        } finally {
            setRetrying(false);
        }
    };

    const hasFailures = logs.some((log) => log.status === 'failed' || log.isSuccess === false);

    if (!isOpen) return null;

    // Announce the async state to assistive tech without exposing recipient data.
    const statusAnnouncement = loading
        ? 'Loading delivery details'
        : logs.length === 0
            ? 'No delivery logs found'
            : `${logs.length} delivery ${logs.length === 1 ? 'record' : 'records'} loaded`;

    return (
        <Modal
            onClose={onClose}
            labelledBy="delivery-report-title"
            overlayClassName="fixed inset-0 z-50 flex justify-center overflow-y-auto bg-ds-overlay p-4 backdrop-blur-sm"
            className="m-auto w-full max-w-4xl overflow-hidden rounded-ds-xl bg-ds-surface shadow-ds-lg"
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
                                {!retrying && <RotateCcw size={14} aria-hidden="true" />}
                                {retrying ? 'Starting...' : 'Retry Failed Requests'}
                            </Button>
                        )}
                        <IconButton label="Close" size="sm" variant="ghost" onClick={onClose}>
                            <X size={18} aria-hidden="true" />
                        </IconButton>
                    </div>
                </div>

                <p className="sr-only" role="status" aria-live="polite">{statusAnnouncement}</p>

                <div
                    className="max-h-96 overflow-auto rounded-ds-lg border border-ds-border-subtle focus-visible:outline-none focus-visible:shadow-ds-focus"
                    tabIndex={0}
                    role="group"
                    aria-label="Delivery results"
                >
                    <table className="min-w-full border-collapse text-ds-sm">
                        <caption className="sr-only">Per-recipient delivery results</caption>
                        <thead className="sticky top-0 bg-ds-surface-subtle">
                            <tr>
                                <th scope="col" className="px-ds-4 py-ds-3 text-left text-ds-xs font-semibold uppercase tracking-wide text-ds-content-secondary">
                                    Recipient
                                </th>
                                <th scope="col" className="px-ds-4 py-ds-3 text-left text-ds-xs font-semibold uppercase tracking-wide text-ds-content-secondary">
                                    Contact
                                </th>
                                <th scope="col" className="px-ds-4 py-ds-3 text-left text-ds-xs font-semibold uppercase tracking-wide text-ds-content-secondary">
                                    Status
                                </th>
                                <th scope="col" className="px-ds-4 py-ds-3 text-left text-ds-xs font-semibold uppercase tracking-wide text-ds-content-secondary">
                                    Error Detail
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-ds-border-subtle">
                            {loading ? (
                                <tr>
                                    <td colSpan="4" className="px-ds-4 py-ds-4 text-center text-ds-sm text-ds-content-muted">
                                        Loading logs...
                                    </td>
                                </tr>
                            ) : logs.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="px-ds-4 py-ds-4 text-center text-ds-sm text-ds-content-muted">
                                        No activity logs found. Ensure permissions are set.
                                    </td>
                                </tr>
                            ) : (
                                logs.map((log) => {
                                    const delivered = log.status === 'delivered' || log.isSuccess;
                                    return (
                                        <tr key={log.id}>
                                            <td className="whitespace-nowrap px-ds-4 py-ds-3 text-ds-sm font-medium text-ds-content">
                                                {log.recipientName || 'Unknown'}
                                            </td>
                                            <td className="whitespace-nowrap px-ds-4 py-ds-3 text-ds-sm text-ds-content-secondary">
                                                {log.recipientIdentity || 'N/A'}
                                            </td>
                                            <td className="px-ds-4 py-ds-3">
                                                <Badge tone={delivered ? 'success' : 'danger'}>
                                                    {delivered ? 'Delivered' : 'Failed'}
                                                </Badge>
                                            </td>
                                            <td className="px-ds-4 py-ds-3 text-ds-sm text-ds-content-muted [overflow-wrap:anywhere]">
                                                {log.error || '-'}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>

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
              case the shared `Modal`'s connected-target focus-restore guard covers.
            */}
            <ConfirmDialog
                isOpen={pendingRetry}
                tone="danger"
                title="Start a new campaign for failed recipients?"
                description="This creates a new campaign and messages every failed recipient from this run again, including those that failed with permanent errors."
                confirmLabel="Start retry campaign"
                cancelLabel="Don't retry"
                loading={retrying}
                onConfirm={confirmRetry}
                onCancel={() => setPendingRetry(false)}
            />
        </Modal>
    );
}
