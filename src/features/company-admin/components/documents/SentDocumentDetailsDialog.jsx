import React, { useId, useRef } from 'react';
import { Ban, Copy, Download, Edit3, X } from 'lucide-react';
import { Modal } from '@shared/components/modals/Modal';
import { Badge, Button, IconButton } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { formatTimestamp } from '@features/company-admin/utils/documentsWorkspace';

/**
 * Sent-document details.
 *
 * Read-only summary plus the same four actions the table row offers, so the
 * dialog never becomes a second source of truth for what can be done.
 *
 * SECURITY: the signing token is never rendered here. "Copy Link" calls the
 * authenticated `getSigningLink` callable exactly as the row action does; the
 * link is written to the clipboard and never into the DOM.
 */

const DELIVERY_LABEL = {
    email: 'Email',
    sms: 'SMS',
    both: 'Email + SMS',
    copy: 'Copy link',
    in_app_post_submit: 'After application',
};

function DetailRow({ label, children }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-ds-2 border-b border-ds-border-subtle py-ds-2 last:border-b-0">
            <dt className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">{label}</dt>
            <dd className="min-w-0 max-w-[60%] text-right text-ds-sm text-ds-content [overflow-wrap:anywhere]">
                {children}
            </dd>
        </div>
    );
}

export function SentDocumentDetailsDialog({
    document,
    onClose,
    onCopyLink,
    onCorrect,
    onVoid,
    onDownload,
    copying = false,
}) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `sent-document-title-${rawId}`;
    const closeRef = useRef(null);

    if (!document) return null;

    const title = document.title || 'Untitled';
    const status = String(document.status || 'unknown');
    const deliveryFailed = document.emailStatus === 'failed';
    const sealFailed = status === 'error_sealing';

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            initialFocusRef={closeRef}
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface shadow-ds-lg"
        >
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <h2 id={titleId} className="min-w-0 text-ds-heading-sm font-bold text-ds-content [overflow-wrap:anywhere]">
                    {title}
                </h2>
                <IconButton label="Close" variant="ghost" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                <Stack gap="md">
                    <dl className="flex flex-col">
                        <DetailRow label="Recipient">{document.recipientName || '—'}</DetailRow>
                        <DetailRow label="Email">{document.recipientEmail || '—'}</DetailRow>
                        <DetailRow label="Phone">{document.recipientPhone || '—'}</DetailRow>
                        <DetailRow label="Delivery">
                            {DELIVERY_LABEL[document.deliveryMethod] || document.deliveryMethod || '—'}
                        </DetailRow>
                        <DetailRow label="Sent">{formatTimestamp(document.createdAt)}</DetailRow>
                        <DetailRow label="Expires">{formatTimestamp(document.expiresAt)}</DetailRow>
                        <DetailRow label="Status">
                            <Badge tone={deliveryFailed || sealFailed ? 'danger' : 'neutral'}>{status}</Badge>
                        </DetailRow>
                    </dl>

                    {(deliveryFailed || sealFailed) && (
                        <div
                            role="alert"
                            className="rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3"
                        >
                            <h3 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content">
                                {deliveryFailed ? 'Delivery error' : 'Sealing error'}
                            </h3>
                            <p className="mt-ds-1 text-ds-xs text-ds-status-danger-fg [overflow-wrap:anywhere]">
                                {(deliveryFailed ? document.emailError : document.errorLog) ||
                                    'No further detail was recorded.'}
                            </p>
                        </div>
                    )}
                </Stack>
            </div>

            <div className="flex flex-wrap justify-end gap-ds-2 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button ref={closeRef} variant="ghost" onClick={onClose}>Close</Button>
                {status === 'signed' ? (
                    <Button
                        variant="secondary"
                        onClick={() => onDownload(document.signedPdfUrl || document.storagePath)}
                    >
                        <Download size={14} aria-hidden="true" /> Download
                    </Button>
                ) : status === 'voided' ? null : (
                    <>
                        <Button variant="secondary" loading={copying} onClick={() => onCopyLink(document)}>
                            {!copying && <Copy size={14} aria-hidden="true" />} Copy Link
                        </Button>
                        {status === 'sent' && onCorrect && (
                            <Button variant="secondary" onClick={() => onCorrect(document)}>
                                <Edit3 size={14} aria-hidden="true" /> Correct
                            </Button>
                        )}
                        {status === 'sent' && (
                            <Button variant="danger" onClick={() => onVoid(document)}>
                                <Ban size={14} aria-hidden="true" /> Void
                            </Button>
                        )}
                    </>
                )}
            </div>
        </Modal>
    );
}

export default SentDocumentDetailsDialog;
