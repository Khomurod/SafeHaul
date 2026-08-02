import React, { useState, useRef, useId } from 'react';
import { Rocket, AlertTriangle, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { getE2EQueryParam, isE2ETestMode } from '@lib/runtime/e2eMode';
import { Badge, Button, Card } from '@/design-system/components';
import { Modal } from '@shared/components/modals/Modal';

export function LaunchPad({ companyId, campaign, onLaunchSuccess }) {
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();
    const [isLaunching, setIsLaunching] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const launchLockRef = useRef(false);
    const isE2ECampaignMock = isE2ETestMode && getE2EQueryParam('e2eCampaign', '') === 'mock';

    const rawId = useId().replace(/:/g, '');
    const confirmTitleId = `launchpad-confirm-title-${rawId}`;
    const confirmDescId = `launchpad-confirm-desc-${rawId}`;

    const handleLaunch = async () => {
        if (!companyId) return showError("Company ID missing");
        if (launchLockRef.current || isLaunching) return;

        launchLockRef.current = true;
        setIsLaunching(true);
        try {
            if (isE2ECampaignMock) {
                showSuccess(`Campaign launched! Targeting ${campaign.matchCount || 0} drivers.`);
                if (onLaunchSuccess) onLaunchSuccess();
                return;
            }

            const initBulkSession = httpsCallable(functions, 'initBulkSession');

            // Extract rawData if present in filters (passed from AudienceBuilder)
            const { rawData, ...cleanFilters } = campaign.filters || {};

            const payload = {
                companyId,
                sessionName: campaign.name,
                filters: cleanFilters,
                rawData: rawData || null,
                config: campaign.messageConfig,
                scheduledFor: null // User requested removal of scheduling ("action and shot")
            };

            const result = await initBulkSession(payload);

            if (result.data.success) {
                const filteredMsg = result.data.filteredCount > 0
                    ? ` (${result.data.filteredCount} excluded — already messaged)`
                    : '';
                showSuccess(`Campaign launched! Targeting ${result.data.targetCount} drivers${filteredMsg}. Session: ${result.data.sessionId?.slice(0, 8)}...`);
                if (onLaunchSuccess) onLaunchSuccess();
            } else {
                showError(result.data.message || "Launch failed");
            }
        } catch (err) {
            // Only the failure reason is logged — never the audience or message body.
            console.error("Launch Error:", err);
            // Extract user-friendly message from Firebase error
            const msg = err.message || '';
            const friendlyMsg = msg.includes('bulk-actions-queue')
                ? "Campaign infrastructure not ready. Please contact support."
                : msg.includes('PROCESS_BULK_BATCH_URL')
                    ? "Campaign worker URL is not configured on the server. Please contact support."
                    : (msg || "Failed to launch campaign");
            showError(friendlyMsg);
        } finally {
            setIsLaunching(false);
            launchLockRef.current = false;
            setShowConfirm(false);
        }
    };


    // Validation
    const errors = [];
    if (!campaign.matchCount || campaign.matchCount === 0) errors.push("No audience selected");
    if (!campaign.messageConfig?.message) errors.push("Message content is empty");

    const isValid = errors.length === 0;

    // Time Estimation (Sequential: 3s per lead)
    const estimatedMinutes = Math.ceil(((campaign.matchCount || 0) * 3) / 60);

    const methodLabel = campaign.messageConfig?.method === 'email' ? 'Email' : 'SMS';
    const previewMessage = campaign.messageConfig?.message || '';

    return (
        <div className="mx-auto max-w-2xl pt-ds-12 text-center">
            <Card padding="lg">
                <span aria-hidden="true" className="mx-auto mb-ds-4 flex h-16 w-16 items-center justify-center rounded-full bg-ds-status-info-bg text-ds-status-info-fg">
                    <Rocket size={32} />
                </span>

                <h2 className="mb-ds-2 text-ds-heading-lg font-bold text-ds-content">Ready for Liftoff?</h2>
                <p className="mx-auto mb-ds-8 max-w-md text-ds-body text-ds-content-secondary">
                    You are about to message <strong>{campaign.matchCount || 0}</strong> recipients via <strong>{methodLabel}</strong>.
                </p>

                {errors.length > 0 ? (
                    /* Failure is stated by an icon + heading text, never colour alone. */
                    <div role="alert" className="mb-ds-8 rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-6 text-left">
                        <h3 className="mb-ds-3 flex items-center gap-ds-2 font-bold text-ds-status-danger-fg">
                            <AlertTriangle size={18} aria-hidden="true" /> Pre-Flight Checks Failed
                        </h3>
                        <ul className="flex flex-col gap-ds-2">
                            {errors.map((err, i) => (
                                <li key={i} className="flex items-center gap-ds-2 text-ds-sm text-ds-status-danger-fg">
                                    <AlertCircle size={14} aria-hidden="true" className="shrink-0" /> {err}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div role="status" className="mb-ds-8 flex flex-col items-center justify-center gap-ds-2 rounded-ds-lg border border-ds-status-success-border bg-ds-status-success-bg p-ds-6 font-bold text-ds-status-success-fg">
                        <div className="flex items-center gap-ds-2">
                            <CheckCircle size={20} aria-hidden="true" /> All Systems Go
                        </div>
                        {campaign.matchCount > 0 && (
                            <Badge tone="success" icon={Clock}>Est. Duration: ~{estimatedMinutes} min</Badge>
                        )}
                    </div>
                )}

                <div className="flex gap-ds-4">
                    <Button
                        variant="primary"
                        size="lg"
                        fullWidth
                        disabled={!isValid}
                        loading={isLaunching}
                        onClick={() => setShowConfirm(true)}
                    >
                        {!isLaunching && <Rocket size={24} aria-hidden="true" />}
                        Launch Immediately
                    </Button>
                </div>

                {/* Announce the in-flight launch to assistive technology. */}
                <p role="status" className="ds-visually-hidden">
                    {isLaunching ? 'Launching campaign…' : ''}
                </p>
            </Card>

            {showConfirm && (
                <Modal
                    onClose={() => setShowConfirm(false)}
                    labelledBy={confirmTitleId}
                    describedBy={confirmDescId}
                    // A launch is in flight and cannot be recalled, so casual
                    // dismissal is blocked while the callable is pending: losing
                    // the dialog would hide the in-progress state while the
                    // campaign still sends. Before launch both routes behave
                    // normally, and the `finally` block closes the dialog on
                    // success and on failure alike.
                    closeOnEscape={!isLaunching}
                    closeOnBackdrop={!isLaunching}
                    className="w-full max-w-md overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface p-ds-6 text-left shadow-ds-lg"
                >
                    <h3 id={confirmTitleId} className="mb-ds-2 text-ds-heading-sm font-bold text-ds-content">Confirm campaign launch</h3>
                    <p id={confirmDescId} className="mb-ds-4 text-ds-sm text-ds-content-secondary">
                        Send to <strong>{campaign.matchCount || 0}</strong> recipients via{' '}
                        <strong>{methodLabel}</strong>?
                    </p>
                    <p className="mb-ds-4 rounded-ds-md bg-ds-surface-subtle p-ds-3 text-ds-xs text-ds-content-secondary line-clamp-4">
                        {previewMessage.slice(0, 280)}
                        {previewMessage.length > 280 ? '…' : ''}
                    </p>
                    <div className="flex flex-col gap-ds-3 sm:flex-row">
                        <Button
                            variant="secondary"
                            fullWidth
                            onClick={() => setShowConfirm(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant="primary"
                            fullWidth
                            loading={isLaunching}
                            onClick={handleLaunch}
                        >
                            Confirm Launch
                        </Button>
                    </div>
                </Modal>
            )}
        </div>
    );
}
