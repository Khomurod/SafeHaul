import React from 'react';
import {
    Briefcase, FileText, CheckCircle2, AlertTriangle, Clock, ShieldCheck,
    Send, ExternalLink, Plus, RefreshCcw, X,
} from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';
import { Modal } from '@design-system/patterns';
import { Badge, Button, Card, IconButton } from '@/design-system/components';

/**
 * The PEV tab's presentational pieces, extracted verbatim from `PEVTab.jsx`:
 * one employer's verification card with its status-driven action set, and the
 * verification-history dialog. All state, handlers and frozen contracts stay
 * in the tab — see its header — and arrive here as props, so every action
 * closes over exactly the values it closed over inline.
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

export function PEVEmployerCard({
    emp,
    index,
    vStatus,
    handleInitiate,
    handleViewResult,
    loadingResultUrl,
    uploadingResult,
    uploadTargetIndex,
    setUploadTargetIndex,
    setHistoryTargetIndex,
    fileRef,
    showSuccess,
}) {
        const employerName = getFieldValue(emp.companyName || emp.name);
    return (
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
    );
}

export function PEVHistoryModal({
    historyTitleId,
    closeHistoryRef,
    setHistoryTargetIndex,
    historyEmployer,
    historyEntries,
    handleViewResult,
    loadingResultUrl,
}) {
    return (
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
                            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-ds-full bg-ds-action-primary" />
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
    );
}
