import React, { useState } from 'react';
import { db } from '@lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FileText, CheckCircle, Clock, Download, Loader2, AlertCircle, Copy, MessageSquare, Mail, Ban, Info } from 'lucide-react';
import { useToast } from '@shared/components/feedback';
import { useIsMobile } from '@shared/hooks/useIsMobile';
import { ConfirmDialog } from '@shared/components/modals/ConfirmDialog';
import { Badge, Button, DataTable, defineTableColumns } from '@/design-system/components';
import { useSigningRequests } from '@features/signing/hooks/useSigningRequests';
import { SentDocumentDetailsDialog } from '@features/company-admin/components/documents/SentDocumentDetailsDialog';

/**
 * Feature-owned domain → visual mapping for a signing-request status.
 *
 * The design system only knows generic Badge tones; this feature owns which
 * status maps to which tone, icon and label. Tones preserve the previous
 * appearance: signed=success (green), sent=info (blue), voided/seal-failed=
 * danger (red), sealing/processing=warning (yellow/amber), unknown=neutral.
 * Every badge pairs its tone with an icon and text, so status is never
 * communicated by colour alone.
 */
const STATUS_PRESENTATION = {
    signed: { tone: 'success', label: 'Signed', icon: CheckCircle },
    sent: { tone: 'info', label: 'Sent', icon: Clock },
    voided: { tone: 'danger', label: 'Voided', icon: Ban },
    pending_seal: { tone: 'warning', label: 'Sealing...', icon: Loader2, spin: true },
    error_sealing: { tone: 'danger', label: 'Seal Failed', icon: AlertCircle },
    processing: { tone: 'warning', label: 'Processing', icon: Loader2, spin: true },
};

/**
 * Rows per page. The live subscription regularly returns 100+ documents; the
 * table stays a single live list, sliced for display only, so real-time
 * updates keep flowing into whichever page is visible.
 */
const PAGE_SIZE = 25;

/**
 * Company-side sent-documents table.
 *
 * The live subscription is unchanged — it lives in `useSigningRequests`,
 * which this component uses when no `documents` prop is supplied. The Documents
 * workspace passes its already-filtered documents in instead, so the workspace
 * and this table never open two listeners on the same collection.
 *
 * Action hierarchy (2026-07-29 redesign): every row is activatable and opens
 * the details dialog, and the Actions column holds exactly one status-specific
 * quick action — Download when signed, Copy Link when sent, Review/View
 * details otherwise. Correct and Void moved out of the rows into the details
 * dialog; their callable/Firestore contracts, confirmation dialog, toasts and
 * per-document busy states are unchanged.
 */
export default function EnvelopeHistory({
    companyId,
    onCorrect,
    documents,
    isLoading,
    loadError: loadErrorProp,
    onRetry,
    emptyState,
}) {
    const [copyingId, setCopyingId] = useState(null);
    const [voidingId, setVoidingId] = useState(null);
    // Replaces the blocking `window.confirm` on the destructive void.
    const [pendingVoid, setPendingVoid] = useState(null);
    const [detailsDocument, setDetailsDocument] = useState(null);
    const [page, setPage] = useState(1);
    const { showSuccess, showError } = useToast();
    // Quick actions stay `sm` on desktop for row density but grow to the 44px
    // `lg` control on touch layouts, where the row is reached by horizontal
    // scroll and a 36px target is too small.
    const isMobile = useIsMobile();
    const quickActionSize = isMobile ? 'lg' : 'sm';

    // Only subscribes when the parent is not already supplying the data.
    const ownSubscription = useSigningRequests(documents ? null : companyId);

    const docs = documents ?? ownSubscription.documents;
    const loading = documents ? Boolean(isLoading) : ownSubscription.isLoading;
    const loadError = documents ? loadErrorProp : ownSubscription.loadError;
    const retry = documents ? onRetry : ownSubscription.retry;

    // PHASE 4: Void a signing request
    /**
     * The blocking `window.confirm` that guarded this is now the shared accessible
     * `ConfirmDialog`.
     *
     * `pendingVoid` holds the envelope captured when the dialog opened. This list
     * is driven by a live `onSnapshot`, so re-reading the row at confirm time could
     * void a *different* envelope if the ordering shifted underneath an open
     * dialog. The envelope title is interpolated into React text, never markup, so
     * an untrusted document title cannot inject anything.
     */
    const requestVoid = (docItem) => {
        if (!docItem?.id) return;
        setPendingVoid({ id: docItem.id, title: docItem.title || 'this document' });
    };

    const confirmVoid = async () => {
        if (!pendingVoid) return;
        setVoidingId(pendingVoid.id);
        try {
            await updateDoc(doc(db, 'companies', companyId, 'signing_requests', pendingVoid.id), {
                status: 'voided',
                voidedAt: serverTimestamp()
            });
            showSuccess('Document voided successfully.');
            setPendingVoid(null);
        } catch (err) {
            console.error('Void error:', err);
            showError('Failed to void document.');
        } finally {
            setVoidingId(null);
        }
    };

    // ADV-1 FIX: Use callable Cloud Function to securely retrieve full signing link
    const handleCopyLink = async (docItem) => {
        setCopyingId(docItem.id);
        try {
            const functions = getFunctions();
            const getSigningLink = httpsCallable(functions, 'getSigningLink');
            const result = await getSigningLink({ companyId, requestId: docItem.id });
            await navigator.clipboard.writeText(result.data.signingLink);
            showSuccess('Full signing link copied to clipboard!');
        } catch (err) {
            console.error('Copy link error:', err);
            showError(err.message || 'Could not retrieve signing link.');
        } finally {
            setCopyingId(null);
        }
    };

    // Secure download via Cloud Function signed URL (bypasses Storage rules)
    const handleDownload = async (storagePath) => {
        try {
            // Clean gs:// prefix if present
            let path = storagePath;
            if (storagePath.startsWith('gs://')) {
                const bucketEnd = storagePath.indexOf('/', 5);
                if (bucketEnd !== -1) path = storagePath.substring(bucketEnd + 1);
            }

            const functions = getFunctions();
            const getSignedDocumentUrl = httpsCallable(functions, 'getSignedDocumentUrl');
            const result = await getSignedDocumentUrl({ storagePath: path });
            window.open(result.data.url, '_blank');
        } catch (err) {
            console.error("Download Error:", err);
            if (err?.code === 'functions/not-found') {
                showError("File not found. It may have been deleted or moved.");
            } else {
                showError("Could not download file. Please try again.");
            }
        }
    };

    const renderStatus = (docItem) => {
        if (docItem.emailStatus === 'failed') {
            // Truncate error for operator debugging without exposing sensitive internals
            const errorDetail = docItem.emailError
                ? (docItem.emailError.length > 80 ? docItem.emailError.substring(0, 80) + '…' : docItem.emailError)
                : 'Email delivery failed';
            return (
                <div className="flex flex-col items-start gap-ds-1">
                    <span title={docItem.emailError || "Email Delivery Failed"}>
                        <Badge tone="danger" icon={AlertCircle}>Delivery Failed</Badge>
                    </span>
                    {/* One clamped line; the complete safe detail lives in the details dialog. */}
                    <span
                        className="line-clamp-1 max-w-[220px] text-ds-xs text-ds-status-danger-fg [overflow-wrap:anywhere]"
                        title={docItem.emailError || ''}
                    >
                        {errorDetail}
                    </span>
                </div>
            );
        }

        const s = (docItem.status || '').toLowerCase();
        const preset = STATUS_PRESENTATION[s];
        if (preset) {
            const Icon = preset.icon;
            const badge = (
                <Badge tone={preset.tone}>
                    <Icon size={12} aria-hidden="true" className={preset.spin ? 'animate-spin' : undefined} />
                    {preset.label}
                </Badge>
            );
            // Preserve the sealing-failure tooltip.
            return s === 'error_sealing'
                ? <span title={docItem.errorLog || 'Sealing failed'}>{badge}</span>
                : badge;
        }
        return <Badge tone="neutral">{docItem.status}</Badge>;
    };

    const renderDeliveryMethods = (docItem) => (
        <span className="inline-flex flex-wrap items-center gap-ds-1">
            {docItem.sendEmail && <Badge tone="info" icon={Mail}>Email</Badge>}
            {docItem.sendSms && <Badge tone="success" icon={MessageSquare}>SMS</Badge>}
            {docItem.sendEmail === false && docItem.sendSms !== true && (
                <Badge tone="neutral">Manual</Badge>
            )}
        </span>
    );

    /**
     * Exactly one status-specific quick action per row. The row itself opens the
     * details dialog, where every other permitted operation (Copy Link, Correct,
     * Void, Download) remains available with its original contract.
     */
    const renderQuickAction = (docItem) => {
        const title = docItem.title || 'Untitled';

        let action;
        if (docItem.emailStatus === 'failed' || docItem.status === 'error_sealing') {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    aria-label={`Review details for ${title}`}
                    title="Review the delivery or sealing failure"
                    onClick={() => setDetailsDocument(docItem)}
                >
                    <AlertCircle size={14} aria-hidden="true" /> Review
                </Button>
            );
        } else if (docItem.status === 'signed') {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    aria-label={`Download ${title}`}
                    title="Download the signed document"
                    onClick={() => handleDownload(docItem.signedPdfUrl || docItem.storagePath)}
                >
                    <Download size={14} aria-hidden="true" /> Download
                </Button>
            );
        } else if (docItem.status === 'sent') {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    loading={copyingId === docItem.id}
                    aria-label={`Link for ${title}`}
                    title="Copy full signing link"
                    onClick={() => handleCopyLink(docItem)}
                >
                    {copyingId !== docItem.id && <Copy size={14} aria-hidden="true" />} Copy link
                </Button>
            );
        } else {
            action = (
                <Button
                    variant="secondary"
                    size={quickActionSize}
                    aria-label={`View details for ${title}`}
                    title="Open document details"
                    onClick={() => setDetailsDocument(docItem)}
                >
                    <Info size={14} aria-hidden="true" /> View details
                </Button>
            );
        }

        /*
         * -mr-ds-4 pulls the quick action toward the table's right border. The
         * scroll region reserves a scrollbar gutter and every cell carries the
         * shared ds-space-5 inline padding, which left the right-aligned action
         * ~36px from the border while the left edge sits at ~21px. Offsetting
         * the feature's own content by ds-space-4 restores the symmetry without
         * touching the DataTable padding contract other tables rely on.
         */
        return <div className="-mr-ds-4 flex items-center justify-end gap-ds-2">{action}</div>;
    };

    const columns = defineTableColumns([
        {
            key: 'title',
            header: 'Document Title',
            rowHeader: true,
            // 'auto' lets the document name take the width the fixed columns leave.
            render: (docItem) => {
                const title = docItem.title || 'Untitled';
                return (
                    <span className="flex items-start gap-ds-2 font-medium text-ds-content" title={title}>
                        <FileText size={16} className="mt-0.5 shrink-0 text-ds-action-primary" aria-hidden="true" />
                        <span className="line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{title}</span>
                    </span>
                );
            },
        },
        {
            key: 'recipient',
            header: 'Recipient',
            // 'auto', like the title: the two identity columns share the spare
            // width, so a typical email plus its delivery badge stays on one
            // line and the row stays compact.
            render: (docItem) => (
                <div className="min-w-0">
                    <div
                        className="line-clamp-1 font-medium text-ds-content [overflow-wrap:anywhere]"
                        title={docItem.recipientName || undefined}
                    >
                        {docItem.recipientName}
                    </div>
                    <div className="mt-ds-1 flex flex-wrap items-center gap-ds-2">
                        <span className="text-ds-xs text-ds-content-muted [overflow-wrap:anywhere]">
                            {docItem.recipientEmail || docItem.recipientPhone || 'No email or phone'}
                        </span>
                        {/* FEAT-4: Delivery method badge */}
                        {renderDeliveryMethods(docItem)}
                    </div>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            width: 'md',
            render: renderStatus,
        },
        {
            key: 'createdAt',
            header: 'Sent Date',
            align: 'end',
            width: 'sm',
            render: (docItem) => (
                <span className="font-mono text-ds-sm text-ds-content-secondary">
                    {docItem.createdAt?.seconds ? new Date(docItem.createdAt.seconds * 1000).toLocaleDateString() : '--'}
                </span>
            ),
        },
        {
            key: 'actions',
            // The same -mr-ds-4 offset as the quick-action cells, so the
            // heading stays exactly above its buttons.
            header: <span className="-mr-ds-4 inline-block">Actions</span>,
            align: 'end',
            // 'lg', not 'actions': one labelled quick action needs a real column,
            // and the old 64px 'actions' width is what stacked buttons vertically.
            width: 'lg',
            priority: 'actions',
            // A quick action must never also activate the row.
            stopPropagation: true,
            render: renderQuickAction,
        },
    ]);

    /**
     * Display-only pagination over the live list. The page is clamped against
     * the current document count, so a filter change or live deletion that
     * shrinks the list can never leave the table on a page that no longer
     * exists. 25 or fewer documents render exactly as before, unpaged.
     */
    const totalPages = Math.max(1, Math.ceil(docs.length / PAGE_SIZE));
    const currentPage = Math.min(page, totalPages);
    // Persist the clamp (render-time state adjustment, not an effect): if it
    // only derived `currentPage`, a list that shrinks below a page and later
    // grows again would resurrect the stale page and silently skip the first
    // 25 documents.
    if (currentPage !== page) setPage(currentPage);
    const paged = docs.length > PAGE_SIZE;
    const visibleDocs = paged ? docs.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE) : docs;
    const pagination = paged
        ? {
            label: `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, docs.length)} of ${docs.length} documents`,
            currentPage,
            totalPages,
            hasPrev: currentPage > 1,
            hasNext: currentPage < totalPages,
            onPrev: () => setPage(Math.max(1, currentPage - 1)),
            onNext: () => setPage(Math.min(totalPages, currentPage + 1)),
        }
        : undefined;

    return (
        <>
            <DataTable
                ariaLabel="Document history"
                data={visibleDocs}
                columns={columns}
                isLoading={loading}
                loadingLabel="Loading document history"
                error={loadError ? { message: loadError, onRetry: retry } : undefined}
                empty={emptyState || { title: 'No documents sent yet.' }}
                getRowLabel={(docItem) => `Details for ${docItem.title || 'Untitled'}`}
                onRowActivate={setDetailsDocument}
                pagination={pagination}
            />

            {/*
              Row-level details. Read-only summary plus every permitted secondary
              action — the signing token is never rendered, only copied to the
              clipboard through the authenticated callable.
            */}
            <SentDocumentDetailsDialog
                document={detailsDocument}
                copying={Boolean(detailsDocument) && copyingId === detailsDocument.id}
                onClose={() => setDetailsDocument(null)}
                onCopyLink={handleCopyLink}
                onCorrect={onCorrect ? (docItem) => { setDetailsDocument(null); onCorrect(docItem); } : undefined}
                onVoid={(docItem) => { setDetailsDocument(null); requestVoid(docItem); }}
                onDownload={(path) => { setDetailsDocument(null); handleDownload(path); }}
            />

            {/*
              Replaces `window.confirm('Are you sure you want to void "{title}"?
              This cannot be undone.')`. The title is rendered as React text, so an
              untrusted document title cannot inject markup.
            */}
            <ConfirmDialog
                isOpen={!!pendingVoid}
                tone="danger"
                title={`Void "${pendingVoid?.title ?? ''}"?`}
                description="This cannot be undone. The signer will no longer be able to open or complete this document."
                confirmLabel="Void document"
                cancelLabel="Keep document"
                loading={!!pendingVoid && voidingId === pendingVoid.id}
                onConfirm={confirmVoid}
                onCancel={() => setPendingVoid(null)}
            />
        </>
    );
}
