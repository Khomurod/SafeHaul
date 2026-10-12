// The envelope editor's Firebase persistence paths, split out of
// `EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard. Two
// functions, both React-free, bodies verbatim from the component:
//
//  - `hydrateEnvelopeForEdit` — the "Correct" / "Edit Template" load: reads
//    the Firestore document, converts stored fields back to editor format,
//    and re-downloads the PDF from Storage. The component's effect passes its
//    own setters in, so state ownership does not move.
//  - `saveEnvelope` — the save/send action: validation, prefill resolution,
//    Storage upload, template/request writes, the signing-request batch with
//    its token secret, and the copy-link/SMS/email delivery tail.
//
// Neither function holds state; every state change flows back through the
// setters and callbacks the component provides.
import { db, storage, auth } from '@lib/firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, Timestamp, writeBatch, doc, getDoc, updateDoc } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import {
    buildPrefillContext,
    normalizePrefillPolicy,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import { serializeTemplateFields } from '@features/signing/utils/templateFieldSerializer';
import { SAVE_STATES } from '@features/signing/utils/editorSaveState';
import { copySigningLink, LINK_NOT_COPIED } from '@features/signing/utils/copySigningLink';
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
            const hydratedFields = (data.fields || []).filter(f => f != null).map(f => ({
                id: f.id,
                type: f.type,
                label: f.label || f.type,
                page: f?.pageNumber || f?.page || 1,
                x: f.xPosition ?? f.x ?? 10,
                y: f.yPosition ?? f.y ?? 10,
                width: f.width || 25,
                height: f.height || 5,
                required: f.required ?? true,
                readOnly: f.readOnly ?? false,
                prefillPolicy: f.prefillPolicy || (f.readOnly ? 'locked' : 'editable'),
                bindingKey: f.bindingKey || '',
                prefillGroupKey: f.prefillGroupKey || '',
                defaultValue: f.defaultValue || '',
                fontSize: f.fontSize || 'Auto',
            }));
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

/** How a sent request's delivery is named in its confirmation. */
const DELIVERY_LABELS = { email: 'Email', sms: 'SMS', both: 'Email + SMS' };

/** The delivery a request records, which the server's senders follow. */
function deliveryFields(deliveryMethod) {
    return {
        sendEmail: deliveryMethod === 'email' || deliveryMethod === 'both',
        sendSms: deliveryMethod === 'sms' || deliveryMethod === 'both',
        deliveryMethod,
    };
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
            const accessToken = uuidv4();
            const expiresAt = Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000);
            const senderName = auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer';

            const signingRef = doc(collection(db, 'companies', companyId, 'signing_requests'));
            const batch = writeBatch(db);
            batch.set(signingRef, {
                ...commonData,
                recipientEmail: recipientEmail || null,
                recipientName,
                recipientPhone: recipientPhone || null,
                status: 'sent',
                createdAt: serverTimestamp(),
                expiresAt,
                senderId: auth.currentUser.uid,
                senderName,
                ...deliveryFields(deliveryMethod),
                appBaseUrl: window.location.origin
            });
            batch.set(doc(signingRef, 'secrets', 'token'), { accessToken });
            await batch.commit();

            if (deliveryMethod === 'copy') {
                const baseUrl = window.location.origin;
                const link = `${baseUrl}/sign/${companyId}/${signingRef.id}?token=${accessToken}`;
                // The request is saved by now: a refused clipboard must not read
                // as a failed save, or a second Send would create a second request.
                if (await copySigningLink(link)) showSuccess('Signing link copied to clipboard!');
                else showWarning(LINK_NOT_COPIED);
            } else {
                // The server texts and emails the link (`notifySignerSMS`,
                // `notifySigner`), as this request's `sendSms` and `sendEmail` say.
                const methodLabel = DELIVERY_LABELS[deliveryMethod] || 'Email';
                showSuccess(`Document created! ${methodLabel} delivery in progress...`);
            }
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
