/**
 * What a sent document's details dialog can do, for each place that opens it:
 * the Sent Documents table (`EnvelopeHistory`) and the Overview's Needs
 * attention cards (`DocumentsManager`). `SentDocumentDialogs` renders the
 * dialog, and the dialogs its actions open, from this hook's value.
 *
 * - Copy Link and Download go through the authenticated callables
 *   (`getSigningLink`, `getSignedDocumentUrl`); the link is copied, never shown.
 * - Void asks first. `requestVoid` keeps the document as the dialog showed it:
 *   the lists are live, and re-reading a row on confirm could void another one.
 *   It records who voided it (`voidedBy`, `voidedByName`) and leaves the
 *   delivery errors as they were, as the record of what happened. A
 *   post-application form's own request (`postapp_<application>_<template>`)
 *   is never sent again once voided (`sendPostApplicationDocument`), so its
 *   confirmation says so.
 * - Fix recipient and resend (`fixRecipient`) saves exactly what Correct
 *   Document saves (`saveEnvelope`, with its checks and its message), so the
 *   server's correction trigger sends the new link; the editor never opens.
 * - Remind, Retry seal and Send signed copy keep their own hooks.
 */
import { useRef, useState } from 'react';
import { db, auth } from '@lib/firebase';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback';
import { postApplicationRequestId } from '@features/company-admin/utils/recordSigningDocuments';
import { copySigningLink } from '@features/signing/utils/copySigningLink';
import { useSignedCopySend } from '@features/signing/hooks/useSignedCopySend';
import { useSealRetry } from '@features/signing/hooks/useSealRetry';
import { useSignerReminder } from '@features/signing/hooks/useSignerReminder';

/** Whether `document` is a post-application form's own request, which the server never sends again once voided. */
export function isPostApplicationFormRequest(document) {
    const { id, sourceApplicationId, templateId } = document || {};
    return Boolean(id && sourceApplicationId && templateId)
        && id === postApplicationRequestId(sourceApplicationId, templateId);
}

const noop = () => {};

export function useSentDocumentActions({ companyId, companyName = '', onCorrect }) {
    const { showSuccess, showError, showWarning } = useToast();
    const [detailsDocument, setDetailsDocument] = useState(null);
    const [copyingId, setCopyingId] = useState(null);
    const [voidingId, setVoidingId] = useState(null);
    const [pendingVoid, setPendingVoid] = useState(null);
    const [fixingId, setFixingId] = useState(null);
    const fixingRef = useRef(false);
    const signedCopy = useSignedCopySend({ companyId, showSuccess });
    const sealRetry = useSealRetry({ companyId, showSuccess, showError });
    const reminder = useSignerReminder({ companyId, showSuccess, showError });

    const closeDetails = () => setDetailsDocument(null);

    const requestVoid = (docItem) => {
        if (!docItem?.id) return;
        setPendingVoid({
            id: docItem.id,
            title: docItem.title || 'this document',
            postApplicationForm: isPostApplicationFormRequest(docItem),
        });
    };

    const confirmVoid = async () => {
        if (!pendingVoid) return;
        setVoidingId(pendingVoid.id);
        try {
            const user = auth.currentUser;
            await updateDoc(doc(db, 'companies', companyId, 'signing_requests', pendingVoid.id), {
                status: 'voided',
                voidedAt: serverTimestamp(),
                voidedBy: user?.uid || null,
                voidedByName: user?.displayName || user?.email || null,
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
    const copyLink = async (docItem) => {
        setCopyingId(docItem.id);
        try {
            const functions = getFunctions();
            const getSigningLink = httpsCallable(functions, 'getSigningLink');
            const result = await getSigningLink({ companyId, requestId: docItem.id });
            // A refused clipboard is the browser's, not the link's: say so plainly.
            if (await copySigningLink(result.data.signingLink)) showSuccess('Full signing link copied to clipboard!');
            else showError('The browser blocked copying the link. Try again.');
        } catch (err) {
            console.error('Copy link error:', err);
            showError(err.message || 'Could not retrieve signing link.');
        } finally {
            setCopyingId(null);
        }
    };

    // Secure download via Cloud Function signed URL (bypasses Storage rules)
    const download = async (storagePath) => {
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

    /**
     * Correct Document's save, given what the editor would have loaded: the
     * stored fields as the editor reads them, and the stored PDF in place of
     * the copy it downloads (a correction keeps the request's PDF and never
     * uploads one). It checks the recipient and reports by itself; a success
     * closes the dialog. Loaded on demand, as the editor is.
     */
    const fixRecipient = async (docItem, recipient) => {
        if (!docItem?.id || fixingRef.current) return;
        fixingRef.current = true;
        setFixingId(docItem.id);
        try {
            const [{ saveEnvelope }, { deserializeTemplateField }] = await Promise.all([
                import('@features/signing/utils/envelopePersistence'),
                import('@features/signing/utils/templateFieldSerializer'),
            ]);
            await saveEnvelope({
                file: docItem.storagePath,
                fields: (docItem.fields || []).filter((field) => field != null).map(deserializeTemplateField),
                creatorMode: 'request',
                isEditingTemplate: false,
                isEditingRequest: true,
                editRequestId: docItem.id,
                editTemplateId: null,
                existingStoragePath: docItem.storagePath || '',
                title: docItem.title || '',
                companyId,
                companyName,
                ...recipient,
                onClose: closeDetails,
                showError,
                showSuccess,
                showWarning,
                setLoading: noop,
                setSaveState: noop,
                markSaved: noop,
            });
        } catch (err) {
            // Ids only, never the signer's contact details.
            console.error('[useSentDocumentActions] Fix recipient failed:', { code: err?.code, requestId: docItem.id });
            showError('Could not save the correction. Please try again.');
        } finally {
            fixingRef.current = false;
            setFixingId(null);
        }
    };

    return {
        detailsDocument,
        openDetails: setDetailsDocument,
        closeDetails,
        copyingId,
        copyLink,
        download,
        onCorrect,
        pendingVoid,
        voidingId,
        requestVoid,
        confirmVoid,
        cancelVoid: () => setPendingVoid(null),
        fixingId,
        fixRecipient,
        signedCopy,
        sealRetry,
        reminder,
    };
}

export default useSentDocumentActions;
