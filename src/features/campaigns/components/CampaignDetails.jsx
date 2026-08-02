import React, { useState } from 'react';
import {
    ArrowLeft, Users, MessageSquare,
    BarChart3, Clock, CheckCircle2, AlertCircle, RefreshCw,
    Pause, Play, XCircle
} from 'lucide-react';
import { CampaignResultsTable } from './CampaignResultsTable';
import { functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { useData } from '@/context/DataContext';
import { Badge, Button, Card, FieldMessage, IconButton } from '@/design-system/components';

// Feature-owned domain → visual mapping (design system only knows generic tones).
// Tones preserve the previous appearance: active=success, completed=info,
// scheduled/paused=warning (amber/orange), queued=accent, failed=danger,
// draft/cancelled/unknown=neutral.
const STATUS_TONE = {
    active: 'success',
    draft: 'neutral',
    completed: 'info',
    scheduled: 'warning',
    queued: 'accent',
    failed: 'danger',
    paused: 'warning',
    cancelled: 'neutral',
};

function statusPresentation(status) {
    const tone = STATUS_TONE[status] || 'neutral';
    const label = typeof status === 'string' && status.length > 0
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : 'Unknown';
    return { tone, label };
}

function StatCard({ icon: Icon, label, value, tone }) {
    const chip = {
        info: 'bg-ds-status-info-bg text-ds-status-info-fg',
        success: 'bg-ds-status-success-bg text-ds-status-success-fg',
        danger: 'bg-ds-status-danger-bg text-ds-status-danger-fg',
    }[tone];
    return (
        <Card>
            <div className="mb-ds-2 flex items-center gap-ds-3">
                <span className={`rounded-ds-md p-ds-2 ${chip}`} aria-hidden="true">
                    <Icon size={20} />
                </span>
                <span className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-muted">{label}</span>
            </div>
            <div className="text-ds-heading-lg font-bold text-ds-content">{value}</div>
        </Card>
    );
}

export function CampaignDetails({ campaign, onClose }) {
    const { currentCompanyProfile } = useData();
    const [retrying, setRetrying] = useState(false);

    const effectiveCompanyId = campaign?.companyId || currentCompanyProfile?.id;
    const tenantMismatch = Boolean(
        campaign?.companyId &&
        currentCompanyProfile?.id &&
        campaign.companyId !== currentCompanyProfile.id
    );
    const [pausing, setPausing] = useState(false);
    const [resuming, setResuming] = useState(false);
    const [cancelling, setCancelling] = useState(false);
    // Replace the two bare `confirm(...)` guards on retry and cancel.
    const [pendingRetry, setPendingRetry] = useState(false);
    const [pendingCancel, setPendingCancel] = useState(false);
    const { showSuccess, showError } = useToast();

    if (!campaign) return null;

    if (tenantMismatch) {
        return (
            <div className="p-ds-6 text-center text-ds-status-danger-fg">
                <p className="font-semibold">This campaign belongs to a different company.</p>
                <p className="mt-ds-2 text-ds-sm">Close this view and open campaigns from your active company workspace.</p>
            </div>
        );
    }

    if (!effectiveCompanyId) {
        return (
            <div className="p-ds-6 text-center text-ds-status-warning-fg">
                <p className="font-semibold">Company context is missing for this campaign.</p>
            </div>
        );
    }

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleString();
    };

    /**
     * Retry and cancel used bare `confirm(...)` — the same blocking browser dialog
     * as `window.confirm`, just without the explicit `window.` prefix, which is why
     * the earlier `window.confirm` sweep missed them. Both now use the shared
     * accessible `ConfirmDialog`. Every callable, payload, toast string and
     * `onClose()` timing below is unchanged.
     */
    const confirmRetry = async () => {
        try {
            setRetrying(true);
            const retryFn = httpsCallable(functions, 'retryFailedAttempts');
            const result = await retryFn({
                companyId: effectiveCompanyId,
                originalSessionId: campaign.id
            });

            if (result.data.success) {
                showSuccess(`Retry session started with ${result.data.targetCount} targets.`);
                setPendingRetry(false);
                onClose(); // Close details to see the new session in dashboard
            } else {
                showError(result.data.message || "Retry failed to start.");
            }
        } catch (err) {
            console.error(err);
            showError(err.message);
        } finally {
            setRetrying(false);
        }
    };

    const handlePause = async () => {
        try {
            setPausing(true);
            const pauseFn = httpsCallable(functions, 'pauseBulkSession');
            await pauseFn({ companyId: effectiveCompanyId, sessionId: campaign.id });
            showSuccess("Campaign paused.");
            onClose();
        } catch (err) {
            showError(err.message);
        } finally {
            setPausing(false);
        }
    };

    const handleResume = async () => {
        try {
            setResuming(true);
            const resumeFn = httpsCallable(functions, 'resumeBulkSession');
            const result = await resumeFn({ companyId: effectiveCompanyId, sessionId: campaign.id });
            if (result?.data?.success === false) {
                showError(result.data.message || "Could not resume campaign.");
                return;
            }
            showSuccess("Campaign resumed.");
            onClose();
        } catch (err) {
            showError(err.message || 'Failed to resume campaign.');
        } finally {
            setResuming(false);
        }
    };

    const confirmCancel = async () => {
        try {
            setCancelling(true);
            const cancelFn = httpsCallable(functions, 'cancelBulkSession');
            await cancelFn({ companyId: effectiveCompanyId, sessionId: campaign.id });
            showSuccess("Campaign cancelled.");
            setPendingCancel(false);
            onClose();
        } catch (err) {
            showError(err.message);
        } finally {
            setCancelling(false);
        }
    };

    const progressPercent = campaign.progress
        ? (campaign.progress.processedCount / (campaign.progress.totalCount || 1)) * 100
        : 0;

    const hasFailures = campaign.progress?.failedCount > 0;
    const isActive = ['active', 'queued', 'scheduled'].includes(campaign.status);
    const isPaused = campaign.status === 'paused';
    const { tone, label } = statusPresentation(campaign.status);

    return (
        <div className="flex h-screen flex-col overflow-hidden bg-ds-surface-subtle">
            {/* Header */}
            <div className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-ds-3 border-b border-ds-border bg-ds-surface px-ds-6 py-ds-3">
                <div className="flex min-w-0 items-center gap-ds-3">
                    <IconButton label="Back to campaigns" variant="ghost" size="sm" onClick={onClose}>
                        <ArrowLeft size={20} aria-hidden="true" />
                    </IconButton>
                    <div className="min-w-0">
                        <h2 className="truncate text-ds-heading-sm font-bold text-ds-content">{campaign.name || 'Untitled Campaign'}</h2>
                        <div className="mt-ds-1 flex flex-wrap items-center gap-ds-2">
                            <Badge tone={tone}>{label}</Badge>
                            <span className="flex items-center gap-ds-1 text-ds-xs font-medium text-ds-content-muted">
                                <Clock size={12} aria-hidden="true" /> {formatDate(campaign.createdAt)}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap items-center gap-ds-2">
                    {isActive && (
                        <Button variant="secondary" size="sm" onClick={handlePause} loading={pausing}>
                            {!pausing && <Pause size={14} aria-hidden="true" />}
                            {pausing ? 'Pausing...' : 'Pause'}
                        </Button>
                    )}

                    {/* Resume — wired to resumeBulkSession Cloud Function */}
                    {isPaused && (
                        <Button variant="primary" size="sm" onClick={handleResume} loading={resuming}>
                            {!resuming && <Play size={14} aria-hidden="true" />}
                            {resuming ? 'Resuming...' : 'Resume'}
                        </Button>
                    )}

                    {(isActive || isPaused) && (
                        <Button variant="secondary" size="sm" onClick={() => setPendingCancel(true)} loading={cancelling}>
                            {!cancelling && <XCircle size={14} aria-hidden="true" />}
                            {cancelling ? 'Cancelling...' : 'Details & Cancel'}
                        </Button>
                    )}

                    {hasFailures && !isActive && (
                        <Button variant="danger" size="sm" onClick={() => setPendingRetry(true)} loading={retrying}>
                            {!retrying && <RefreshCw size={14} aria-hidden="true" />}
                            {retrying ? 'Starting...' : 'Retry Failed'}
                        </Button>
                    )}
                </div>
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1 overflow-y-auto p-ds-6">
                <div className="mx-auto flex max-w-5xl flex-col gap-ds-6">

                    {/* Failure reason — surface why a session failed so it's diagnosable
                        instead of just showing a red "FAILED" with no explanation. */}
                    {campaign.status === 'failed' && (campaign.error || campaign.failureReason) && (
                        <Card className="border-ds-status-danger-border bg-ds-status-danger-bg">
                            <div className="flex items-start gap-ds-3">
                                <AlertCircle size={20} className="mt-0.5 shrink-0 text-ds-status-danger-fg" aria-hidden="true" />
                                <div className="min-w-0">
                                    <p className="mb-ds-1 text-ds-xs font-bold uppercase tracking-wide text-ds-status-danger-fg">Why this campaign failed</p>
                                    <FieldMessage tone="error" className="[overflow-wrap:anywhere]">
                                        {campaign.error || campaign.failureReason}
                                    </FieldMessage>
                                </div>
                            </div>
                        </Card>
                    )}

                    {/* Stats Cards */}
                    <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-3">
                        <StatCard
                            icon={Users}
                            label="Audience"
                            tone="info"
                            value={campaign.progress ? campaign.progress.totalCount : campaign.matchCount || 0}
                        />
                        <StatCard
                            icon={CheckCircle2}
                            label="Sent"
                            tone="success"
                            value={campaign.progress ? campaign.progress.successCount : 0}
                        />
                        <StatCard
                            icon={AlertCircle}
                            label="Failed"
                            tone="danger"
                            value={campaign.progress ? campaign.progress.failedCount : 0}
                        />
                    </div>

                    {/* Progress Section */}
                    {campaign.progress && (
                        <Card>
                            <h3 className="mb-ds-4 flex items-center gap-ds-2 text-ds-sm font-bold uppercase tracking-wide text-ds-content">
                                <BarChart3 size={16} className="text-ds-action-primary" aria-hidden="true" /> Campaign Progress
                            </h3>
                            <div
                                className="mb-ds-2 h-4 w-full overflow-hidden rounded-full bg-ds-surface-subtle"
                                role="progressbar"
                                aria-label="Campaign progress"
                                aria-valuenow={campaign.progress.processedCount}
                                aria-valuemin={0}
                                aria-valuemax={campaign.progress.totalCount || 1}
                            >
                                <div
                                    className="h-full bg-ds-action-primary transition-all duration-1000 ease-out"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-ds-xs font-medium text-ds-content-muted">
                                <span>{Math.round(progressPercent)}% Complete</span>
                                <span>{campaign.progress.processedCount} / {campaign.progress.totalCount} leads processed</span>
                            </div>
                        </Card>
                    )}

                    {/* Message Configuration */}
                    <Card>
                        <h3 className="mb-ds-4 flex items-center gap-ds-2 text-ds-sm font-bold uppercase tracking-wide text-ds-content">
                            <MessageSquare size={16} className="text-ds-status-accent-fg" aria-hidden="true" /> Message Content
                        </h3>
                        <div className="whitespace-pre-wrap rounded-ds-lg border border-ds-border-subtle bg-ds-surface-subtle p-ds-4 font-medium text-ds-content-secondary [overflow-wrap:anywhere]">
                            {campaign.messageConfig?.message || 'No message content defined.'}
                        </div>
                        <div className="mt-ds-4 flex gap-ds-2">
                            <Badge tone="neutral">{campaign.messageConfig?.method || 'SMS'}</Badge>
                        </div>
                    </Card>

                    {/* Technical Details */}
                    <Card>
                        <h3 className="mb-ds-4 text-ds-sm font-bold uppercase tracking-wide text-ds-content">Details</h3>
                        <dl className="grid grid-cols-1 gap-ds-4 text-ds-sm sm:grid-cols-2">
                            <div className="min-w-0">
                                <dt className="mb-ds-1 text-ds-xs font-bold uppercase text-ds-content-muted">Campaign ID</dt>
                                <dd className="font-mono text-ds-content-secondary [overflow-wrap:anywhere]">{campaign.id}</dd>
                            </div>
                            <div className="min-w-0">
                                <dt className="mb-ds-1 text-ds-xs font-bold uppercase text-ds-content-muted">Created At</dt>
                                <dd className="text-ds-content-secondary">{formatDate(campaign.createdAt)}</dd>
                            </div>
                            <div className="min-w-0">
                                <dt className="mb-ds-1 text-ds-xs font-bold uppercase text-ds-content-muted">Updated At</dt>
                                <dd className="text-ds-content-secondary">{formatDate(campaign.updatedAt)}</dd>
                            </div>
                            {campaign.scheduledFor && (
                                <div className="min-w-0">
                                    <dt className="mb-ds-1 text-ds-xs font-bold uppercase text-ds-content-muted">Scheduled For</dt>
                                    <dd className="text-ds-content-secondary">{formatDate(campaign.scheduledFor)}</dd>
                                </div>
                            )}
                        </dl>
                    </Card>

                    {/* Individual Results Table.
                        campaign.companyId is not stored on the session doc, so
                        effectiveCompanyId resolves it from context. */}
                    <CampaignResultsTable companyId={effectiveCompanyId} campaignId={campaign.id} />

                </div>
            </div>

            {/* Replaces the bare `confirm("Start a new campaign for FAILED recipients only? …")`. */}
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

            {/* Replaces the bare `confirm("Are you sure you want to cancel this campaign? This action cannot be undone.")`. */}
            <ConfirmDialog
                isOpen={pendingCancel}
                tone="warning"
                title="Cancel this campaign?"
                description="This action cannot be undone. Sending stops and no further messages go out; the campaign record is kept for reporting."
                confirmLabel="Cancel campaign"
                cancelLabel="Keep sending"
                loading={cancelling}
                onConfirm={confirmCancel}
                onCancel={() => setPendingCancel(false)}
            />
        </div>
    );
}
