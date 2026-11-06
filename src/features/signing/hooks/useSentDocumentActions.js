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
 *   One transaction voids it only while it still waits for its signer (`sent`):
 *   one signed, or being signed, since the dialog opened keeps that. It records
 *   who voided it (`voidedBy`, `voidedByName`) and leaves the delivery errors
 *   as they were, as the record of what happened. A post-application form's own
 *   request (`postapp_<application>_<template>`) is never sent again once
 *   voided (`sendPostApplicationDocument`), so its confirmation says so.
 * - Fix recipient and resend (`fixRecipient`) saves Correct Document's
 *   correction for the recipient alone (`correctRecipient`, with Correct's
 *   checks and message), so the server's correction trigger sends the new
 *   link; the editor never opens. A success closes the dialog it came from,
 *   not one opened since.
 * - Remind, Retry seal and Send signed copy keep their own hooks.
 */
import { useRef, useState } from 'react';
import { db, auth } from '@lib/firebase';
import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';
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

export function useSentDocumentActions({ companyId, companyName = '', onCorrect }) {
    const { showSuccess, showError } = useToast();
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
            const ref = doc(db, 'companies', companyId, 'signing_requests', pendingVoid.id);
            const voided = await runTransaction(db, async (tx) => {
                const snap = await tx.get(ref);
                if (!snap.exists() || snap.data()?.status !== 'sent') return false;
                tx.update(ref, {
                    status: 'voided',
                    voidedAt: serverTimestamp(),
                    voidedBy: user?.uid || null,
                    voidedByName: user?.displayName || user?.email || null,
                });
                return true;
            });
            if (voided) showSuccess('Document voided successfully.');
            else showError('This document is no longer waiting for a signature, so it was not voided.');
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
     * Correct Document's correction for the recipient alone, on the request as
     * it is when the write lands (`correctRecipient`). It checks and reports by
     * itself; a success closes the dialog it was saved from, and leaves alone
     * one opened since. Loaded on demand, as the editor is.
     */
    const fixRecipient = async (docItem, recipient) => {
        if (!docItem?.id || fixingRef.current) return;
        fixingRef.current = true;
        setFixingId(docItem.id);
        try {
            const { correctRecipient } = await import('@features/signing/utils/envelopePersistence');
            const saved = await correctRecipient({
                companyId,
                companyName,
                requestId: docItem.id,
                ...recipient,
                showError,
                showSuccess,
            });
            if (saved) setDetailsDocument((open) => (open?.id === docItem.id ? null : open));
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
