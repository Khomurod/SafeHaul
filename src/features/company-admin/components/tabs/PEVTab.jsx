import React, { useState, useMemo, useCallback, useId } from 'react';
import {
    Briefcase, FileText, CheckCircle2, AlertTriangle, Clock, ShieldCheck,
    Send, ExternalLink, Plus, Info, RefreshCcw, Loader2, X,
} from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';
import { logActivity } from '@shared/utils/activityLogger';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { useData } from '@/context/DataContext';

import { VOEPreviewModal } from '../modals/VOEPreviewModal';
import { PEVRequestModal } from '../modals/PEVRequestModal';
import { db, storage, functions } from '@lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { PaywallMessage } from '@shared/components/feedback/PaywallMessage';
import { Modal } from '@shared/components/modals/Modal';
import { Badge, Button, Card, IconButton, MetricCard } from '@/design-system/components';

/**
 * Previous Employment Verification — initiation and tracking.
 *
 * Presentation migrated to the approved `Card`, `MetricCard`, `Badge`, `Button`
 * and `IconButton` primitives, the shared accessible `Modal`, and `--ds-*`
 * tokens (2026-07-27).
 *
 * DELIBERATELY NOT MIGRATED in this campaign: `VOEPreviewModal`'s generated
 * document layout and its PDF/print rendering, and the external employer
 * response portal. The transition into `VOEPreviewModal` — including the fact
 * that closing it returns to the request modal rather than the list — is
 * unchanged.
 *
 * Frozen contracts: the `features.pev === false` paywall gate; the
 * `sendVerificationRequest` payload; the
 * `logActivity(companyId, collectionName, applicationId, 'PEV_REQUEST', entry, 'pev')`
 * argument list and the exact log-entry string; the Firestore
 * `updateDoc(companies/{companyId}/{collectionName}/{applicationId}, { employers })`
 * write and the verification/history object shapes; the optimistic
 * `localOverrides` merge; the `getSignedPevUrl({ storagePath })` payload and the
 * `http(s)`-opens-directly rule; every `window.open(url, '_blank',
 * 'noopener,noreferrer')` call; the clipboard write; the
 * `companies/{companyId}/{collectionName}/{applicationId}/pev_results/{Date.now()}_{name}`
 * Storage path and the `.pdf,image/*` accept list; the `'email' | 'fax' |
 * 'manual'` delivery values and their `Email | Fax | Manual` labels; the
 * `'Manual Download'` recipient fallback; and every toast string.
 *
 * DEFECTS FIXED (2026-07-27):
 * - **The verification-history overlay was not a dialog.** A bare
 *   `<div class="fixed inset-0">` with no `role="dialog"`, no `aria-modal`, no
 *   focus containment, no focus restoration and no Escape — opened on top of the
 *   driver dossier, which *is* a modal dialog. Keyboard users tabbed straight
 *   through it into the page behind. It now uses the shared accessible `Modal`.
 * - **Its close control had no accessible name** and was a `Plus` icon rotated
 *   45° to fake an X, so assistive technology was offered an unlabelled button
 *   whose icon claimed "add".
 * - **The history dialog was titled "Not Specified" for legacy employers.** It
 *   read `employer.companyName` only, while the list uses
 *   `companyName || name`. The one place that tells you *whose* verification
 *   trail you are reading got it wrong.
 * - **The Resend action had no accessible name** — an icon-only `<button>` whose
 *   only name source was a `title` attribute.
 * - **Interface text at 10 px and 11 px** in the summary cards, the status
 *   badges and the FMCSA notes, below the 12 px floor.
 * - **The employer list was a bare `<div>` grid**, so assistive technology never
 *   announced how many employers there were. It is now a real list.
 * - **The in-flight upload and signed-URL fetches were silent.** Both now
 *   announce through a `role="status"` live region.
 * - **Status was carried by a coloured strip and a colour-only pill.** The pill
 *   is now an approved `Badge` whose tone is layered over its own text.
 */

/** Status → approved Badge tone. Text always accompanies the tone. */
const STATUS_TONES = {
    'Completed': 'success',
    'Sent': 'info',
    'Requested': 'info',
    'Discrepancy': 'danger',
    'No Response (Good Faith Documented)': 'warning',
};

/** Status → the icon Badge renders beside the status text. */
const STATUS_ICONS = {
    'Completed': CheckCircle2,
    'Sent': Clock,
    'Requested': Clock,
    'Discrepancy': AlertTriangle,
    'No Response (Good Faith Documented)': AlertTriangle,
};

function statusTone(status) {
    return STATUS_TONES[status] || 'neutral';
}

function statusIcon(status) {
    return STATUS_ICONS[status] || Plus;
}

export function PEVTab({ companyId, applicationId, appData, collectionName = 'applications' }) {
    const { showSuccess, showError } = useToast();
    const { currentCompanyProfile } = useData();
    const [selectedEmployer, setSelectedEmployer] = useState(null);
    const [showInitiateModal, setShowInitiateModal] = useState(false);
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const historyTitleId = `pev-history-title-${useId().replace(/:/g, '')}`;
    const closeHistoryRef = React.useRef(null);

    // Base statuses derived from Firestore data (reactive to parent appData refreshes)
    const baseStatuses = useMemo(() => {
        const result = {};
        (appData?.employers || []).forEach((emp, idx) => {
            result[idx] = emp.verification || { status: 'Not Started', history: [] };
        });
        return result;
    }, [appData]);

    // Local overrides for instant optimistic UI updates (merged over base)
    const [localOverrides, setLocalOverrides] = useState({});

    // Merged view: base from Firestore + any local optimistic changes
    const verificationStatuses = useMemo(() => ({
        ...baseStatuses,
        ...localOverrides
    }), [baseStatuses, localOverrides]);

    const [uploadingResult, setUploadingResult] = useState(false);
    const fileRef = React.useRef(null);
    const [uploadTargetIndex, setUploadTargetIndex] = useState(null);
    const [historyTargetIndex, setHistoryTargetIndex] = useState(null);
    const [loadingResultUrl, setLoadingResultUrl] = useState(null); // Track which index is loading a signed URL

    const employers = useMemo(() => appData?.employers || [], [appData]);

    /**
     * Opens a PEV result file. Handles both:
     *  - Cloud Storage paths (from portal submissions) → calls getSignedPevUrl for a fresh signed URL
     *  - Full URLs (from manual uploads via getDownloadURL) → opens directly
     */
    const handleViewResult = useCallback(async (urlOrPath, index = null) => {
        if (!urlOrPath) return;

        // If it's already a full URL (https://...), open directly (manual upload case)
        if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')) {
            window.open(urlOrPath, '_blank', 'noopener,noreferrer');
            return;
        }

        // Otherwise it's a Cloud Storage path — need to get a signed URL
        setLoadingResultUrl(index);
        try {
            const getSignedUrl = httpsCallable(functions, 'getSignedPevUrl');
            const result = await getSignedUrl({ storagePath: urlOrPath });
            if (result.data?.url) {
                window.open(result.data.url, '_blank', 'noopener,noreferrer');
            } else {
                showError('Could not retrieve the document URL.');
            }
        } catch (error) {
            console.error('Error fetching signed URL:', error);
            if (error?.code === 'functions/not-found') {
                showError('The result file was not found in storage. It may have been deleted.');
            } else {
                showError('Failed to open the verification result.');
            }
        } finally {
            setLoadingResultUrl(null);
        }
    }, [showError]);

    const stats = useMemo(() => {
        const total = employers.length;
        const completed = Object.values(verificationStatuses).filter(s => s.status === 'Completed').length;
        const pending = Object.values(verificationStatuses).filter(s => ['Sent', 'Requested'].includes(s.status)).length;
        return { total, completed, pending };
    }, [employers, verificationStatuses]);

    const handleInitiate = (employer, index) => {
        setSelectedEmployer({ ...employer, index });
        setShowInitiateModal(true);
    };

    const handleProceedToPreview = (method, contactInfo) => {
        setShowInitiateModal(false);
        setSelectedEmployer(prev => ({ ...prev, deliveryMethod: method, contactInfo }));
        setShowPreviewModal(true);
    };

    const handleFinalSend = async () => {
        try {
            const emp = selectedEmployer;
            const method = emp.deliveryMethod === 'email' ? 'Email' : emp.deliveryMethod === 'fax' ? 'Fax' : 'Manual';
            const recipient = emp.contactInfo?.email || emp.contactInfo?.fax || 'Manual Download';

            const applicantName = `${getFieldValue(appData?.firstName)} ${getFieldValue(appData?.lastName)}`.trim();
            const employerName = getFieldValue(emp.companyName || emp.name);
            const startDate = getFieldValue(emp.startDate);
            const endDate = getFieldValue(emp.endDate);

            // Use the new token-based verification system
            const sendVerificationFn = httpsCallable(functions, 'sendVerificationRequest');
            const result = await sendVerificationFn({
                companyId,
                applicationId,
                collectionName,
                employerIndex: emp.index,
                employerName,
                employerEmail: emp.deliveryMethod === 'email' ? emp.contactInfo?.email : null,
                applicantName,
                employmentStartDate: startDate,
                employmentEndDate: endDate,
                deliveryMethod: emp.deliveryMethod,
            });

            if (!result.data?.success) {
                showError(`Verification request failed: ${result.data?.error || 'Unknown error'}. Please check your email settings.`);
                return;
            }

            const verificationUrl = result.data.verificationUrl;
            const logEntry = `Initiated ${method} verification for ${employerName} (Sent to: ${recipient})${verificationUrl ? ` | Portal: ${verificationUrl}` : ''}`;

            // Log Activity
            await logActivity(
                companyId,
                collectionName,
                applicationId,
                'PEV_REQUEST',
                logEntry,
                'pev'
            );

            // Update appData directly since verifications are usually stored alongside employers
            const updatedEmployers = [...employers];
            if (!updatedEmployers[emp.index].verification) {
                updatedEmployers[emp.index].verification = { history: [] };
            }
            updatedEmployers[emp.index].verification.status = 'Sent';
            updatedEmployers[emp.index].verification.method = method;
            updatedEmployers[emp.index].verification.token = result.data.token;
            updatedEmployers[emp.index].verification.verificationUrl = verificationUrl;
            updatedEmployers[emp.index].verification.history.push({
                action: 'Sent via Portal',
                method,
                recipient,
                verificationUrl,
                token: result.data.token,
                timestamp: new Date().toISOString()
            });

            const appRef = doc(db, 'companies', companyId, collectionName, applicationId);
            await updateDoc(appRef, { employers: updatedEmployers });

            setLocalOverrides(prev => ({
                ...prev,
                [emp.index]: updatedEmployers[emp.index].verification
            }));

            showSuccess(`Verification request sent to ${getFieldValue(emp.companyName || emp.name)} via ${method} (${recipient})`);
            setShowPreviewModal(false);
            setSelectedEmployer(null);
        } catch (error) {
            console.error("PEV Send Error:", error);
            showError("Failed to initiate verification.");
        }
    };

    const handleUploadResult = async (e, index) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploadingResult(true);
        try {
            const storagePath = `companies/${companyId}/${collectionName}/${applicationId}/pev_results/${Date.now()}_${file.name}`;
            const fileRefObj = ref(storage, storagePath);
            await uploadBytes(fileRefObj, file);
            const downloadUrl = await getDownloadURL(fileRefObj);

            // Update DB
            const updatedEmployers = [...employers];
            if (!updatedEmployers[index].verification) {
                updatedEmployers[index].verification = { history: [] };
            }
            updatedEmployers[index].verification.status = 'Completed';
            updatedEmployers[index].verification.resultUrl = downloadUrl;
            updatedEmployers[index].verification.history.push({
                action: 'Result Uploaded',
                fileName: file.name,
                url: downloadUrl,
                timestamp: new Date().toISOString()
            });

            const appRef = doc(db, 'companies', companyId, collectionName, applicationId);
            await updateDoc(appRef, { employers: updatedEmployers });

            setLocalOverrides(prev => ({
                ...prev,
                [index]: updatedEmployers[index].verification
            }));

            showSuccess('Verification result uploaded successfully.');
        } catch (error) {
            console.error("Upload Error:", error);
            showError("Failed to upload verification result.");
        } finally {
            setUploadingResult(false);
            if (fileRef.current) fileRef.current.value = null;
            setUploadTargetIndex(null);
        }
    };

    if (currentCompanyProfile?.features?.pev === false) {
        return (
            <div className="p-ds-8">
                <PaywallMessage
                    // `<h4>` under the dossier header's `<h3>` section title.
                    headingLevel="h4"
                    title="PEV Module Unavailable"
                    message="The Previous Employment Verification module is currently turned off for your company. Please contact our Sales Team to enable automated VOE."
                />
            </div>
        );
    }

    const historyEmployer = historyTargetIndex === null ? null : employers[historyTargetIndex];
    const historyEntries = historyTargetIndex === null
        ? []
        : (verificationStatuses[historyTargetIndex]?.history || []);

    return (
        <div className="mx-auto max-w-6xl space-y-ds-6">
            {/* Summary */}
            <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-3">
                <MetricCard
                    label="Total Employers"
                    value={stats.total}
                    tone="info"
                    icon={<Briefcase size={24} />}
                />
                <MetricCard
                    label="Completed"
                    value={stats.completed}
                    tone="success"
                    icon={<CheckCircle2 size={24} />}
                />
                <MetricCard
                    label="Compliance Status"
                    value="Audit in Progress"
                    tone="warning"
                    icon={<ShieldCheck size={24} />}
                />
            </div>

            {/* Verification Center */}
            <Card padding="lg">
                {/* `<h4>` sits under the dossier header's `<h3>` section title. */}
                <h4 className="mb-ds-4 border-b border-ds-border-subtle pb-ds-2 text-ds-body-lg font-bold text-ds-content">
                    Verification Center (DOT Compliance)
                </h4>

                <div className="space-y-ds-4">
                    <p className="flex items-start gap-ds-2 rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3 text-ds-xs font-medium text-ds-content-secondary">
                        <Info size={14} className="mt-0.5 shrink-0 text-ds-action-primary" aria-hidden="true" />
                        FMCSA 391.23(a)(2) requires investigation of employment history for the previous 3 years from the date of the application.
                    </p>

                    {/*
                      One live region for both asynchronous actions in this tab.
                      Previously the upload and the signed-URL fetch showed only a
                      spinning icon, so neither was announced at all.
                    */}
                    <p role="status" className="ds-visually-hidden">
                        {uploadingResult
                            ? 'Uploading verification result…'
                            : loadingResultUrl !== null
                                ? 'Opening the verification result…'
                                : ''}
                    </p>

                    {employers.length === 0 ? (
                        <div className="rounded-ds-lg border-2 border-dashed border-ds-border p-ds-12 text-center">
                            <Briefcase size={40} className="mx-auto mb-ds-3 text-ds-content-muted" aria-hidden="true" />
                            <p className="italic text-ds-content-secondary">No historical employers detected in this application.</p>
                        </div>
                    ) : (
                        <ul className="grid gap-ds-4">
                            {employers.map((emp, index) => {
                                const vStatus = verificationStatuses[index] || { status: 'Not Started' };
                                const employerName = getFieldValue(emp.companyName || emp.name);
                                return (
                                    <li key={index}>
                                        <Card padding="md" className="h-full">
                                            <div className="flex flex-col justify-between gap-ds-4 md:flex-row md:items-center">
                                                <div className="flex min-w-0 items-start gap-ds-4">
                                                    <span
                                                        aria-hidden="true"
                                                        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-ds-md ${vStatus.status === 'Completed'
                                                            ? 'bg-ds-status-success-bg text-ds-status-success-fg'
                                                            : 'bg-ds-surface-subtle text-ds-content-secondary'
                                                            }`}
                                                    >
                                                        <Briefcase size={24} />
                                                    </span>
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-ds-2">
                                                            <h5 className="font-bold leading-tight text-ds-content [overflow-wrap:anywhere]">{employerName}</h5>
                                                            <Badge tone={statusTone(vStatus.status)} icon={statusIcon(vStatus.status)}>
                                                                {vStatus.status}
                                                            </Badge>
                                                        </div>
                                                        <div className="mt-ds-1 flex flex-wrap items-center gap-x-ds-4 gap-y-ds-1">
                                                            <span className="flex items-center gap-ds-1 text-ds-xs font-medium text-ds-content-secondary">
                                                                <Clock size={12} aria-hidden="true" /> {getFieldValue(emp.startDate)} to {getFieldValue(emp.endDate)}
                                                            </span>
                                                            <span className="text-ds-xs font-medium text-ds-content-secondary">
                                                                {getFieldValue(emp.city)}, {getFieldValue(emp.state)}
                                                            </span>
                                                            {vStatus.method && (
                                                                <span className="flex items-center gap-ds-1 text-ds-xs font-semibold text-ds-content-link">
                                                                    <Send size={12} aria-hidden="true" /> Sent via {vStatus.method}
                                                                </span>
                                                            )}
                                                            {vStatus.respondentName && (
                                                                <span className="flex items-center gap-ds-1 text-ds-xs font-semibold text-ds-status-success-fg">
                                                                    <CheckCircle2 size={12} aria-hidden="true" /> Responded by: {vStatus.respondentName}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex flex-wrap items-center gap-ds-2 md:justify-end">
                                                    {vStatus.status === 'Not Started' ? (
                                                        <Button
                                                            variant="primary"
                                                            size="sm"
                                                            onClick={() => handleInitiate(emp, index)}
                                                        >
                                                            <ShieldCheck size={14} aria-hidden="true" /> Initiate PEV
                                                        </Button>
                                                    ) : (
                                                        <>
                                                            {vStatus.resultUrl && (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => handleViewResult(vStatus.resultUrl, index)}
                                                                    disabled={loadingResultUrl === index}
                                                                    loading={loadingResultUrl === index}
                                                                >
                                                                    {loadingResultUrl === index ? null : <FileText size={14} aria-hidden="true" />}
                                                                    View Result
                                                                </Button>
                                                            )}
                                                            {vStatus.verificationUrl && vStatus.status !== 'Completed' && (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        navigator.clipboard.writeText(vStatus.verificationUrl);
                                                                        showSuccess('Verification link copied to clipboard!');
                                                                    }}
                                                                >
                                                                    <ExternalLink size={14} aria-hidden="true" /> Copy Link
                                                                </Button>
                                                            )}
                                                            {vStatus.status === 'Sent' && (
                                                                <Button
                                                                    variant="secondary"
                                                                    size="sm"
                                                                    onClick={() => {
                                                                        setUploadTargetIndex(index);
                                                                        if (fileRef.current) fileRef.current.click();
                                                                    }}
                                                                    disabled={uploadingResult}
                                                                    loading={uploadingResult && uploadTargetIndex === index}
                                                                >
                                                                    {uploadingResult && uploadTargetIndex === index ? null : <Plus size={14} aria-hidden="true" />}
                                                                    Upload Result
                                                                </Button>
                                                            )}
                                                            <Button
                                                                variant="secondary"
                                                                size="sm"
                                                                onClick={() => setHistoryTargetIndex(index)}
                                                            >
                                                                <FileText size={14} aria-hidden="true" /> View History
                                                            </Button>
                                                            {/* Named, not `title`-only: this was an unlabelled
                                                                icon-only button. */}
                                                            <IconButton
                                                                variant="ghost"
                                                                size="sm"
                                                                label={`Resend verification request to ${employerName}`}
                                                                onClick={() => handleInitiate(emp, index)}
                                                            >
                                                                <RefreshCcw size={16} aria-hidden="true" />
                                                            </IconButton>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </Card>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>
            </Card>

            {/* VOE Modals */}
            {showInitiateModal && selectedEmployer && (
                <PEVRequestModal
                    employer={selectedEmployer}
                    applicant={appData}
                    onClose={() => {
                        setShowInitiateModal(false);
                        setSelectedEmployer(null);
                    }}
                    onProceed={handleProceedToPreview}
                />
            )}

            {showPreviewModal && selectedEmployer && (
                <VOEPreviewModal
                    employer={selectedEmployer}
                    applicant={appData}
                    onClose={() => {
                        setShowPreviewModal(false);
                        setShowInitiateModal(true); // Go back to choice
                    }}
                    onSend={handleFinalSend}
                />
            )}

            {/*
              Hidden file input, driven by the per-employer "Upload Result"
              button.

              DOCUMENTED EXCEPTION — feature-owned file input; the design system
              has no approved file-input contract yet (Phase 4, recorded in the
              roadmap), the same gap the public application's `UploadField`
              documents.

              DEFECT FIX: it carried no accessible name and was hidden by a CSS
              class alone. Any environment that does not apply the stylesheet
              exposed an unlabelled file control (axe `label`, critical). It now
              names itself and is hidden by the native attribute as well, so it
              leaves the accessibility tree without depending on CSS.
            */}
            <input
                type="file"
                ref={fileRef}
                hidden
                className="hidden"
                accept=".pdf,image/*"
                aria-label="Upload verification result file"
                onChange={(e) => handleUploadResult(e, uploadTargetIndex)}
            />

            {/* History */}
            {historyTargetIndex !== null && (
                <Modal
                    labelledBy={historyTitleId}
                    onClose={() => setHistoryTargetIndex(null)}
                    initialFocusRef={closeHistoryRef}
                    // z-[100] preserves this dialog's stacking above the dossier
                    // and the request modal.
                    overlayClassName="fixed inset-0 z-[100] flex items-center justify-center bg-ds-overlay p-ds-4 backdrop-blur-sm"
                    className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-ds-xl bg-ds-surface shadow-ds-lg"
                >
                    <div className="flex shrink-0 items-center justify-between gap-ds-3 border-b border-ds-border-subtle bg-ds-surface-subtle px-ds-4 py-ds-3">
                        <h4 id={historyTitleId} className="font-bold text-ds-content">Verification History</h4>
                        <IconButton
                            ref={closeHistoryRef}
                            variant="ghost"
                            size="sm"
                            label="Close verification history"
                            onClick={() => setHistoryTargetIndex(null)}
                        >
                            <X size={20} aria-hidden="true" />
                        </IconButton>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-ds-6">
                        {/* Falls back to the legacy `name` exactly like the list does. */}
                        <h5 className="mb-ds-4 text-ds-body-lg font-bold text-ds-content [overflow-wrap:anywhere]">
                            {getFieldValue(historyEmployer?.companyName || historyEmployer?.name)}
                        </h5>

                        {historyEntries.length > 0 ? (
                            <ol className="space-y-ds-4">
                                {historyEntries.map((log, i) => (
                                    <li key={i} className="flex gap-ds-3 text-ds-sm">
                                        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ds-action-primary" />
                                        <div className="min-w-0">
                                            <p className="font-bold text-ds-content">{log.action}</p>
                                            <p className="text-ds-xs text-ds-content-secondary">
                                                {new Date(log.timestamp).toLocaleString()}
                                            </p>
                                            {log.recipient && (
                                                <p className="mt-ds-1 text-ds-xs text-ds-content-secondary [overflow-wrap:anywhere]">
                                                    Sent to: {log.recipient} ({log.method})
                                                </p>
                                            )}
                                            {log.url && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleViewResult(log.url, `history-${i}`)}
                                                    disabled={loadingResultUrl === `history-${i}`}
                                                    loading={loadingResultUrl === `history-${i}`}
                                                >
                                                    View Uploaded Document
                                                </Button>
                                            )}
                                        </div>
                                    </li>
                                ))}
                            </ol>
                        ) : (
                            <p className="italic text-ds-content-secondary">No history available yet.</p>
                        )}
                    </div>
                </Modal>
            )}
        </div>
    );
}
