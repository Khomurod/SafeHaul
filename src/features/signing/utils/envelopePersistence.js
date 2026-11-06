// The envelope editor's Firebase persistence paths, kept apart from
// `EnvelopeCreator.jsx` for the source-size standard. Three functions, all
// React-free:
//
//  - `hydrateEnvelopeForEdit` — the "Correct" / "Edit Template" load: reads
//    the Firestore document, converts stored fields back to editor format,
//    and re-downloads the PDF from Storage. The component's effect passes its
//    own setters in, so state ownership does not move.
//  - `saveEnvelope` — the save/send action: validation, prefill resolution,
//    Storage upload and the template/request writes. A new request is written
//    and announced by `signingRequestWrite.js`, as the template wizard's is.
//  - `correctRecipient` — Fix recipient and resend: Correct's checks and write
//    for a new recipient alone, on the request as it is when the write lands.
//
// None holds state; every state change flows back through the setters and
// callbacks the caller provides.
import { db, auth } from '@lib/firebase';
import { storage } from '@lib/firebase/storage';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, addDoc, serverTimestamp, doc, getDoc, updateDoc, deleteField, runTransaction } from 'firebase/firestore';
import {
    buildPrefillContext,
    normalizePrefillPolicy,
    resolveFieldsForSend,
} from '@features/signing/utils/prefillEngine';
import { deserializeTemplateField, serializeTemplateFields } from '@features/signing/utils/templateFieldSerializer';
import { COMPANY_SIGNATURE_MISSING_MESSAGE, fieldsMissingCompanySignature } from '@features/signing/utils/companySignature';
import { SAVE_STATES } from '@features/signing/utils/editorSaveState';
import { deliveryFields, createSigningRequest, announceSigningRequest } from '@features/signing/utils/signingRequestWrite';
import { normalizePhone } from '@shared/utils/helpers';

/** How long the PDF download for "Correct" / "Edit Template" may take: 20 MB at about 1.4 Mbit/s. */
const PDF_DOWNLOAD_TIMEOUT_MS = 120000;

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
            // A stalled download ends in the load error below, not an endless spinner.
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), PDF_DOWNLOAD_TIMEOUT_MS);
            let blob;
            try {
                const response = await fetch(url, { signal: controller.signal });
                blob = await response.blob();
            } finally {
                clearTimeout(timer);
            }
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

/**
 * The send record a correction drops with each channel it leaves off: the
 * server sends only on the channels still on (`resendSignerOnCorrection`), so
 * a turned-off channel's old failure would otherwise stay on the document for
 * good. A channel left on keeps its record until the server records the new send.
 */
function clearedChannelRecords(delivery) {
    const clear = (fields) => Object.fromEntries(fields.map((field) => [field, deleteField()]));
    return {
        ...(!delivery.sendEmail && clear(['emailStatus', 'emailError'])),
        ...(!delivery.sendSms && clear(['smsStatus', 'smsError', 'smsNote'])),
    };
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

/** A correction refused for its reason, which its sender is shown. Nothing was written. */
class CorrectionRefused extends Error {}

const NO_LONGER_SENT = 'This document is no longer waiting for a signature: it was signed, voided or is being signed. The correction was not saved.';

/**
 * Writes a correction to request `docRef` in one transaction, refused unless
 * the request still waits for its signer (`sent`) as the write lands: a signer
 * who submitted since the editor or form opened keeps what they signed, and a
 * voided request stays voided. `updateFor(current)` builds the update from the
 * request as it is now. Answers that request.
 */
function writeCorrection(docRef, updateFor) {
    return runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        const current = (snap.exists() && snap.data()) || {};
        if (current.status !== 'sent') throw new CorrectionRefused(NO_LONGER_SENT);
        tx.update(docRef, updateFor(current));
        return current;
    });
}

/** Who a corrected request goes to and how, and the send records of the channels it turns off. */
function recipientUpdate({ recipientName, recipientEmail, recipientPhone }, delivery) {
    return {
        recipientEmail: recipientEmail || null,
        recipientName,
        recipientPhone: recipientPhone || null,
        ...delivery,
        ...clearedChannelRecords(delivery),
    };
}

/** Why a request cannot go to this recipient, or null: it needs a name, and an email or phone for each channel. */
function recipientProblem({ recipientName, recipientEmail, recipientPhone, deliveryMethod }) {
    if (!recipientName) return 'Please provide a recipient name.';
    if ((deliveryMethod === 'email' || deliveryMethod === 'both') && !recipientEmail) {
        return 'Email is required for email delivery.';
    }
    if ((deliveryMethod === 'sms' || deliveryMethod === 'both') && !recipientPhone) {
        return 'Phone number is required for SMS delivery.';
    }
    return null;
}

/**
 * `fields` resolved for the recipient in `prefillContext`, as a document goes
 * out, or `error`: a company signature without its image (a template may leave
 * it for each document, a document never goes out without it), or a locked
 * required field the prefill leaves empty.
 */
function fieldsForDelivery(fields, prefillContext) {
    if (fieldsMissingCompanySignature(fields).length > 0) return { error: COMPANY_SIGNATURE_MISSING_MESSAGE };
    const { fields: resolvedFields, missingLockedRequired } = resolveFieldsForSend(fields, prefillContext);
    if (missingLockedRequired.length > 0) {
        return {
            error: `Cannot send yet. These locked required fields are missing prefill data: ${missingLockedRequired.join(', ')}.`,
        };
    }
    return {
        fields: resolvedFields.map((resolvedField, index) => ({ ...resolvedField, bindingKey: fields[index].bindingKey || '' })),
    };
}

const SENT_NOWHERE_AGAIN = {
    email: 'Not saved: nothing would be sent again. The email failed to this address, and Save and resend sends '
        + 'only to a changed one: change it, or press Cancel, then Resend to send to it again.',
    sms: 'Not saved: nothing would be sent again. The text failed to this number, and Save and resend sends '
        + 'only to a changed one: change it, or press Cancel, then Resend to text it again.',
};

/**
 * Why Save and resend would send nothing while a failed send stays on, or
 * null. The correction trigger sends only where the link has not been
 * (`correctionDelivery`), so a correction that keeps the address or number a
 * send failed to (a new name, a channel turned off beside it) sends nothing
 * there. Resend (Remind) is what sends there again.
 */
function failedSendLeft(before, after) {
    const delivery = correctionDelivery(before, after);
    if (delivery?.email || delivery?.sms) return null;
    if (before.emailStatus === 'failed' && after.sendEmail) return SENT_NOWHERE_AGAIN.email;
    if (before.smsStatus === 'failed' && after.sendSms) return SENT_NOWHERE_AGAIN.sms;
    return null;
}

/**
 * Fix recipient and resend (`useSentDocumentActions`): Correct Document's
 * checks and write for a new recipient and channels, and nothing else. One
 * transaction applies it to request `requestId` as it is when the write lands
 * (`writeCorrection`): the request's own fields, resolved again for the new
 * recipient, and its own title, so an edit saved since the dialog opened is
 * kept. Refused, writing nothing, when it would send nothing while a failed
 * send stays on (`failedSendLeft`). It reports by itself, as `saveEnvelope`
 * does, and answers whether it saved.
 */
export async function correctRecipient({
    companyId,
    companyName,
    requestId,
    recipientName,
    recipientEmail,
    recipientPhone,
    deliveryMethod,
    showError,
    showSuccess,
}) {
    const recipient = { recipientName, recipientEmail, recipientPhone };
    const problem = recipientProblem({ ...recipient, deliveryMethod });
    if (problem) {
        showError(problem);
        return false;
    }
    const prefillContext = buildPrefillContext({ ...recipient, companyName });
    const delivery = deliveryFields(deliveryMethod);
    const after = { recipientEmail, recipientPhone, ...delivery };
    try {
        const before = await writeCorrection(doc(db, 'companies', companyId, 'signing_requests', requestId), (current) => {
            const left = failedSendLeft(current, after);
            if (left) throw new CorrectionRefused(left);
            const stored = (current.fields || []).filter((field) => field != null).map(deserializeTemplateField);
            const resolved = fieldsForDelivery(stored, prefillContext);
            if (resolved.error) throw new CorrectionRefused(resolved.error);
            return {
                fields: serializeTemplateFields(resolved.fields),
                updatedAt: serverTimestamp(),
                ...recipientUpdate(recipient, delivery),
            };
        });
        showSuccess(correctionMessage(before, after));
        return true;
    } catch (err) {
        if (!(err instanceof CorrectionRefused)) throw err;
        showError(err.message);
        return false;
    }
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
    // A correction keeps the request's own PDF and uploads none, so it needs no file.
    if ((!file && !isEditingRequest) || fields.length === 0) {
        showError('Please upload a file and place at least one field.');
        return;
    }

    if (creatorMode === 'request' && !isEditingTemplate) {
        const problem = recipientProblem({ recipientName, recipientEmail, recipientPhone, deliveryMethod });
        if (problem) {
            showError(problem);
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

    let processedFields;
    if (shouldResolveForDelivery) {
        const resolved = fieldsForDelivery(fields, prefillContext);
        if (resolved.error) {
            showError(resolved.error);
            return;
        }
        processedFields = resolved.fields;
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
            const delivery = deliveryFields(deliveryMethod);
            const before = await writeCorrection(doc(db, 'companies', companyId, 'signing_requests', editRequestId), () => ({
                ...commonData,
                ...recipientUpdate({ recipientName, recipientEmail, recipientPhone }, delivery),
            }));
            showSuccess(correctionMessage(before, { recipientEmail, recipientPhone, ...delivery }));
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
        // Never claim "Saved" after a failed write — the edits are still local.
        setSaveState(SAVE_STATES.ERROR);
        if (err instanceof CorrectionRefused) {
            showError(err.message);
            return;
        }
        console.error('Error saving:', err);
        // Surface the real reason (e.g. permission-denied, storage/unauthorized,
        // invalid-argument) instead of a generic message. An opaque "Action failed"
        // is undebuggable; a precise code/message means this is never a mystery again.
        const reason = err?.code || err?.message || 'unknown error';
        showError(`Save failed (${reason}). Please try again or contact support.`);
    } finally {
        setLoading(false);
    }
}
