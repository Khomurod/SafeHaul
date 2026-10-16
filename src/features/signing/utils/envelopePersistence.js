// The envelope editor's Firebase persistence paths, kept apart from
// `EnvelopeCreator.jsx` for the source-size standard. Two functions, both
// React-free:
//
//  - `hydrateEnvelopeForEdit` — the "Correct" / "Edit Template" load: reads
//    the Firestore document, converts stored fields back to editor format,
//    and re-downloads the PDF from Storage. The component's effect passes its
//    own setters in, so state ownership does not move.
//  - `saveEnvelope` — the save/send action: validation, prefill resolution,
//    Storage upload and the template/request writes. A new request is written
//    and announced by `signingRequestWrite.js`, as the template wizard's is.
//
// Neither function holds state; every state change flows back through the
// setters and callbacks the component provides.
import { db, auth } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, doc, getDoc, updateDoc } from 'firebase/firestore';
import {
    buildPrefillContext,
    normalizePrefillPolicy,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import { deserializeTemplateField, serializeTemplateFields } from '@features/signing/utils/templateFieldSerializer';
import { SAVE_STATES } from '@features/signing/utils/editorSaveState';
import { deliveryFields, createSigningRequest, announceSigningRequest } from '@features/signing/utils/signingRequestWrite';
import { normalizePhone } from '@shared/utils/helpers';

/** PHASE 4: Hydrate from existing document for "Correct" / "Edit Template" flows */
export async function hydrateEnvelopeForEdit({
    companyId,
    editingCollection,
    editingEntityId,
    isEditingTemplate,
    showError,
    resetEditorHistory,
    setHydrating,
    setRecipientName,
    setRecipientEmail,
    setRecipientPhone,
    setTitle,
    setDeliveryMethod,
    setCreatorMode,
    setExistingStoragePath,
    setNumPages,
    setFile,
}) {
    setHydrating(true);
    try {
        const docRef = doc(db, 'companies', companyId, editingCollection, editingEntityId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) {
            showError('Document not found.');
            setHydrating(false);
            return;
        }
        const data = snap.data();
        setRecipientName(data.recipientName || '');
        setRecipientEmail(data.recipientEmail || '');
        setRecipientPhone(data.recipientPhone || '');
        setTitle(data.title || '');
        setDeliveryMethod(data.deliveryMethod || 'email');
        setCreatorMode(isEditingTemplate ? 'template' : 'request');
        setExistingStoragePath(data.storagePath || '');

        // Hydrate fields (convert stored format back to editor format)
        if (data.fields) {
            // SAFETY: Filter out null/undefined elements from Firestore before hydrating
            const hydratedFields = (data.fields || []).filter(f => f != null).map(deserializeTemplateField);
            resetEditorHistory(hydratedFields);
        }

        // Hydrate PDF file from storage
        if (data.storagePath) {
            setNumPages(null); // RACE FIX: Reset before fetching new blob
            const fileRef = ref(storage, data.storagePath);
            const url = await getDownloadURL(fileRef);
            const response = await fetch(url);
            const blob = await response.blob();
            const pdfFile = new File([blob], `${data.title || 'document'}.pdf`, { type: 'application/pdf' });
            setFile(pdfFile);
        }
    } catch (err) {
        console.error('Hydration error:', err);
        showError('Failed to load document for editing.');
    } finally {
        setHydrating(false);
    }
}

/**
 * What the server sends for a correction (`functions/shared/signingLink.js`,
 * whose rule this is: change both): a new link, the old one void, when the link
 * went to an email or phone the request no longer has; the link to a contact or
 * channel it has not reached. `linkSentTo` records where it went; a request
 * saved before that record was sent by email unless switched off, and by text
 * only when asked for.
 */
function correctionDelivery(before, after) {
    if (before.status !== 'sent') return null;
    const emailOf = (value) => String(value || '').trim().toLowerCase();
    const sentTo = before.linkSentTo || {
        email: before.sendEmail !== false ? before.recipientEmail : '',
        phone: before.sendSms ? before.recipientPhone : '',
    };
    const [sentEmail, sentPhone] = [emailOf(sentTo.email), normalizePhone(sentTo.phone)];
    const [email, phone] = [emailOf(after.recipientEmail), normalizePhone(after.recipientPhone)];
    const newToken = Boolean((sentEmail && sentEmail !== email) || (sentPhone && sentPhone !== phone));
    const sendsEmail = after.sendEmail !== false && Boolean(email) && (newToken || sentEmail !== email);
    const sendsSms = Boolean(after.sendSms) && Boolean(phone) && (newToken || sentPhone !== phone);
    return newToken || sendsEmail || sendsSms ? { newToken, email: sendsEmail, sms: sendsSms } : null;
}

/** What a saved correction tells its sender. */
function correctionMessage(before, after) {
    const delivery = correctionDelivery(before, after);
    if (!delivery) return 'Document updated successfully!';
    const channels = [delivery.email && 'Email', delivery.sms && 'SMS'].filter(Boolean).join(' + ');
    if (!channels) return 'Document corrected. The old signing link no longer works: copy the new one from Sent Documents.';
    if (delivery.newToken) {
        return `Document corrected. A new signing link is on its way by ${channels}, and the old one no longer works.`;
    }
    return `Document updated. The signing link is on its way by ${channels}.`;
}

/** Only reachable from a completed write. Also a safe history reset point. */
export async function saveEnvelope({
    file,
    fields,
    creatorMode,
    isEditingTemplate,
    isEditingRequest,
    editRequestId,
    editTemplateId,
    existingStoragePath,
    recipientName,
    recipientEmail,
    recipientPhone,
    deliveryMethod,
    title,
    companyId,
    companyName,
    onClose,
    showError,
    showSuccess,
    showWarning,
    setLoading,
    setSaveState,
    markSaved,
}) {
    if (!file || fields.length === 0) {
        showError('Please upload a file and place at least one field.');
        return;
    }

    if (creatorMode === 'request' && !isEditingTemplate) {
        if (!recipientName) {
            showError('Please provide a recipient name.');
            return;
        }
        if ((deliveryMethod === 'email' || deliveryMethod === 'both') && !recipientEmail) {
            showError('Email is required for email delivery.');
            return;
        }
        if ((deliveryMethod === 'sms' || deliveryMethod === 'both') && !recipientPhone) {
            showError('Phone number is required for SMS delivery.');
            return;
        }
    }

    const shouldResolveForDelivery = creatorMode === 'request' || isEditingRequest;
    const prefillContext = buildPrefillContext({
        recipientName,
        recipientEmail,
        recipientPhone,
        companyName,
    });

    let processedFields = [];
    if (shouldResolveForDelivery) {
        const { fields: resolvedFields, missingLockedRequired } = resolveFieldsForSend(fields, prefillContext);
        processedFields = resolvedFields.map((resolvedField, index) => ({
            ...resolvedField,
            bindingKey: fields[index].bindingKey || '',
        }));

        if (missingLockedRequired.length > 0) {
            showError(
                `Cannot send yet. These locked required fields are missing prefill data: ${missingLockedRequired.join(', ')}.`
            );
            return;
        }
    } else {
        // Template save/edit keeps raw placeholder tokens instead of pre-resolving values.
        processedFields = fields.map((field) => {
            const policy = normalizePrefillPolicy(field);
            return {
                ...field,
                prefillPolicy: policy,
                readOnly: policy === 'locked',
                bindingKey: field.bindingKey || '',
            };
        });
    }

    setLoading(true);
    setSaveState(SAVE_STATES.SAVING);

    try {
        const commonData = {
            companyId,
            title: title || 'Untitled Document',
            // Funnel every field through the pure serializer so the payload can
            // never contain `undefined` (which Firestore rejects outright).
            fields: serializeTemplateFields(processedFields),
            updatedAt: serverTimestamp()
        };

        if (isEditingRequest) {
            const docRef = doc(db, 'companies', companyId, 'signing_requests', editRequestId);
            const before = (await getDoc(docRef)).data() || {};
            await updateDoc(docRef, {
                ...commonData,
                recipientEmail: recipientEmail || null,
                recipientName,
                recipientPhone: recipientPhone || null,
                ...deliveryFields(deliveryMethod),
            });
            showSuccess(correctionMessage(before, { recipientEmail, recipientPhone, ...deliveryFields(deliveryMethod) }));
            markSaved();
            if (onClose) onClose();
            return;
        }

        if (isEditingTemplate) {
            if (!existingStoragePath) {
                showError('Template file reference is missing. Please re-upload the PDF as a new template.');
                // Nothing was written, so the work is still unsaved. Leaving
                // the state at SAVING would show "Saving…" forever.
                setSaveState(SAVE_STATES.UNSAVED);
                return;
            }
            const docRef = doc(db, 'companies', companyId, 'templates', editTemplateId);
            await updateDoc(docRef, {
                ...commonData,
                storagePath: existingStoragePath,
            });
            showSuccess('Template updated successfully!');
            markSaved();
            if (onClose) onClose();
            return;
        }

        const folder = creatorMode === 'template' ? 'templates' : 'originals';
        const storagePath = `secure_documents/${companyId}/${folder}/${Date.now()}_${file.name}`;
        const fileRef = ref(storage, storagePath);
        await uploadBytes(fileRef, file);

        commonData.storagePath = storagePath;

        if (creatorMode === 'template') {
            await addDoc(collection(db, 'companies', companyId, 'templates'), {
                ...commonData,
                createdAt: serverTimestamp(),
                createdBy: auth.currentUser.uid
            });
            showSuccess('Template saved successfully!');
        } else {
            const link = await createSigningRequest({
                companyId,
                recipientName,
                recipientEmail,
                recipientPhone,
                deliveryMethod,
                content: commonData,
            });
            await announceSigningRequest({ link, deliveryMethod, showSuccess, showWarning });
        }

        markSaved();
        if (onClose) onClose();
    } catch (err) {
        console.error('Error saving:', err);
        // Never claim "Saved" after a failed write — the edits are still local.
        setSaveState(SAVE_STATES.ERROR);
        // Surface the real reason (e.g. permission-denied, storage/unauthorized,
        // invalid-argument) instead of a generic message. An opaque "Action failed"
        // is undebuggable; a precise code/message means this is never a mystery again.
        const reason = err?.code || err?.message || 'unknown error';
        showError(`Save failed (${reason}). Please try again or contact support.`);
    } finally {
        setLoading(false);
    }
}
