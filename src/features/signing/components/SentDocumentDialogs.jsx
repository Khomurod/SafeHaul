import React from 'react';
import { ConfirmDialog } from '@design-system/patterns';
import { SentDocumentDetailsDialog } from '@features/company-admin/components/documents/SentDocumentDetailsDialog';
import { SignedCopyDialog } from './SignedCopy';

/**
 * A sent document's details dialog and the dialogs its actions open — Send
 * signed copy's approval and Void's confirmation — from one
 * `useSentDocumentActions` value (`actions`). The Sent Documents table and the
 * Overview's Needs attention cards both render it, so a document offers the
 * same actions wherever it is opened.
 *
 * The details dialog shows the document as it was opened and closes before an
 * action that opens another dialog. It is keyed by the document, so a form left
 * open on one document never appears on the next.
 */
export function SentDocumentDialogs({ actions }) {
    const {
        detailsDocument,
        closeDetails,
        copyingId,
        copyLink,
        download,
        onCorrect,
        pendingVoid,
        voidingId,
        requestVoid,
        confirmVoid,
        cancelVoid,
        fixingId,
        fixRecipient,
        signedCopy,
        sealRetry,
        reminder,
    } = actions;
    const openedId = detailsDocument?.id ?? null;

    return (
        <>
            <SentDocumentDetailsDialog
                key={openedId ?? 'closed'}
                document={detailsDocument}
                copying={openedId !== null && copyingId === openedId}
                onClose={closeDetails}
                onCopyLink={copyLink}
                onCorrect={onCorrect ? (docItem) => { closeDetails(); onCorrect(docItem); } : undefined}
                onVoid={(docItem) => { closeDetails(); requestVoid(docItem); }}
                onDownload={(path) => { closeDetails(); download(path); }}
                onFixRecipient={fixRecipient}
                fixingRecipient={openedId !== null && fixingId === openedId}
                signedCopyRecord={detailsDocument ? signedCopy.recordFor(detailsDocument) : null}
                onSendSignedCopy={(docItem) => { closeDetails(); signedCopy.request(docItem); }}
                {...sealRetry.dialogProps(detailsDocument, closeDetails)}
                {...reminder.dialogProps(detailsDocument, closeDetails)}
            />

            <SignedCopyDialog
                pending={signedCopy.pending}
                sending={signedCopy.sending}
                error={signedCopy.error}
                onApprove={signedCopy.approve}
                onCancel={signedCopy.cancel}
                onViewPdf={download}
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
                description={pendingVoid?.postApplicationForm
                    ? 'This form is sent to the driver after their application. Once voided it cannot be sent to this driver again, and the driver will no longer be able to open or complete it. This cannot be undone.'
                    : 'This cannot be undone. The signer will no longer be able to open or complete this document.'}
                confirmLabel="Void document"
                cancelLabel="Keep document"
                loading={!!pendingVoid && voidingId === pendingVoid.id}
                onConfirm={confirmVoid}
                onCancel={cancelVoid}
            />
        </>
    );
}

export default SentDocumentDialogs;
