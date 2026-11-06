/**
 * sendSignedDocumentCopy — a company user's explicit approval to email the
 * signer their signed copy: the sealed PDF, carrying the signer's signature and
 * the company's. Nothing sends it on its own; sealing only finishes the document.
 *
 * Only the company's team (`assertCompanyAccessForRequest`) or a Super Admin may
 * approve, and only a signed document with a company signature and a signer's
 * signature. The PDF is read from the path the seal writes, never the request's
 * client-writable `signedPdfUrl`, and must match the checksum the seal recorded.
 *
 * It goes only to the address the approval showed (`recipientEmail`): if a
 * correction has changed it since, the call is refused before the claim, so a
 * new address is reviewed again instead of being sent to unseen.
 *
 * One email per document: `signedCopy` on the request is claimed in a
 * transaction before the one send, so a second press, tab or person is refused.
 * A claim left at `sending` for ten minutes (a crashed attempt) may be taken
 * over; a failed send is recorded and may be approved again. The call never
 * retries a send. `signedCopy` is also the record of who approved it and when:
 * there is no company activity log for documents.
 */
const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { admin, db, storage } = require('./firebaseAdmin');
const { sendDynamicEmail } = require('./emailService');
const { assertCompanyAccessForRequest } = require('./shared/companyAccess');
const { isCompanySignatureField } = require('./shared/companySignature');
const { isValidEmail } = require('./shared/isValidEmail');
const { clipText, escapeHtml } = require('./shared/plainText');
const { cleanString, nameFromProfile } = require('./shared/userIdentity');

// A claim older than this is a crashed attempt, not one still sending.
const CLAIM_LIFETIME_MS = 10 * 60 * 1000;
const FALLBACK_FILENAME = 'signed-document';

const notReady = (message) => new HttpsError('failed-precondition', message);

function documentId(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
        throw new HttpsError('invalid-argument', `${name} is required.`);
    }
    return value;
}

/** The address the approval showed, which the document must still carry. */
function approvedAddress(value) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new HttpsError('invalid-argument', 'recipientEmail is required.');
    }
    return value.trim();
}

/** Refuses unless the document's address is the one the approver saw, in any case. */
function refuseChangedAddress(address, approved) {
    if (address.toLowerCase() !== approved.toLowerCase()) {
        throw new HttpsError('aborted', 'The signer\'s email changed after you opened this. Close it and review the document again.');
    }
}

function millisOf(value) {
    if (value && typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return null;
}

const dayOf = (value) => {
    const millis = millisOf(value);
    return millis === null ? '' : new Date(millis).toLocaleDateString('en-US', {
        timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric',
    });
};

/** Refuses a document whose copy was sent, or is being sent by an approval under ten minutes old. */
function refuseClaimed(signedCopy) {
    if (signedCopy?.state === 'sent') {
        const on = dayOf(signedCopy.sentAt);
        throw new HttpsError('already-exists', `A signed copy was already sent to ${signedCopy.sentTo || 'the signer'}${on ? ` on ${on}` : ''}.`);
    }
    if (signedCopy?.state === 'sending') {
        const approvedAt = millisOf(signedCopy.approvedAt);
        if (approvedAt !== null && Date.now() - approvedAt < CLAIM_LIFETIME_MS) {
            const by = signedCopy.approvedByName ? ` by ${signedCopy.approvedByName}` : '';
            throw new HttpsError('aborted', `Already being sent${by}. Refresh in a minute to see whether it went.`);
        }
    }
}

/** The address to send to, once the document is one a signed copy may be sent for. */
function addressReadyToSend(data) {
    if (data.status !== 'signed') throw notReady('This document is not signed and sealed yet.');
    const fields = Array.isArray(data.fields) ? data.fields.filter(Boolean) : [];
    if (!fields.some(isCompanySignatureField)) {
        throw notReady('This document has no company signature, so no signed copy is sent for it.');
    }
    const values = data.fieldValues || {};
    const signed = fields.some((field) => (field.type === 'signature' || field.type === 'initial')
        && typeof values[field.id] === 'string' && values[field.id].trim() !== '');
    if (!signed) throw notReady('This document has no signer\'s signature.');
    const address = typeof data.recipientEmail === 'string' ? data.recipientEmail.trim() : '';
    if (!isValidEmail(address)) throw notReady('This document has no valid email address for the signer.');
    return address;
}

/** The sealed PDF the seal wrote for this request, refused unless it is the one it recorded. */
async function readSealedPdf(companyId, requestId, checksum) {
    if (typeof checksum !== 'string' || !checksum) {
        throw notReady('This document has no recorded checksum, so its sealed PDF cannot be checked.');
    }
    const file = storage.bucket().file(`secure_documents/${companyId}/completed/${requestId}_signed.pdf`);
    let bytes;
    try {
        const [exists] = await file.exists();
        if (!exists) throw notReady('The sealed PDF of this document is missing.');
        [bytes] = await file.download();
    } catch (err) {
        if (err instanceof HttpsError) throw err;
        console.error(`[sendSignedDocumentCopy] Could not read the sealed PDF of ${requestId}:`, err.message);
        throw new HttpsError('unavailable', 'The sealed PDF could not be read. Try again in a moment.');
    }
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== checksum) {
        throw notReady('The sealed PDF does not match the checksum recorded when it was sealed, so it was not sent.');
    }
    return Buffer.from(bytes);
}

/** The approver's name: from their sign-in, else their profile, else their email. */
async function approverName(auth) {
    const fromToken = cleanString(auth.token?.name);
    if (fromToken) return fromToken;
    try {
        const profile = await db.collection('users').doc(auth.uid).get();
        const fromProfile = nameFromProfile(profile.exists ? profile.data() : null);
        if (fromProfile) return fromProfile;
    } catch (err) {
        console.warn('[sendSignedDocumentCopy] Could not read the approver\'s profile:', err.message);
    }
    return cleanString(auth.token?.email) || 'Company user';
}

/** An attachment name from the title: letters, digits, spaces, dots, dashes and underscores only. */
function pdfFilename(title) {
    const base = String(title ?? '')
        .normalize('NFKD')
        .replace(/\s+/g, ' ')
        .replace(/[^A-Za-z0-9 ._-]+/g, '')
        .replace(/\.pdf$/i, '')
        .replace(/^[\s.-]+|[\s.-]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 100)
        .trim();
    return `${base || FALLBACK_FILENAME}.pdf`;
}

function emailHtml(title, recipientName) {
    return `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #374151; font-size: 15px;">
            <p>Hello ${escapeHtml(recipientName || 'there')},</p>
            <p>Attached is your signed copy of <strong>${escapeHtml(title)}</strong>,
               with your signature and the company's. Please keep it for your records.</p>
        </div>
    `;
}

// The secret decrypts an SMTP password stored encrypted (emailService.js).
exports.sendSignedDocumentCopy = onCall({ cors: true, secrets: ['SMS_ENCRYPTION_KEY'] }, async (request) => {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to send a signed copy.');
    const companyId = documentId(request.data?.companyId, 'companyId');
    const requestId = documentId(request.data?.requestId, 'requestId');
    const approved = approvedAddress(request.data?.recipientEmail);
    await assertCompanyAccessForRequest(request, companyId, 'sendSignedDocumentCopy');

    const ref = db.collection('companies').doc(companyId).collection('signing_requests').doc(requestId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Document not found.');
    const data = snap.data() || {};
    refuseChangedAddress(addressReadyToSend(data), approved);
    refuseClaimed(data.signedCopy);

    const pdf = await readSealedPdf(companyId, requestId, data.sha256Checksum);
    const approvedByName = await approverName(request.auth);

    // Claimed as the document stands now: two approvals at once cannot both pass.
    const { sentTo, title, recipientName } = await db.runTransaction(async (tx) => {
        const current = await tx.get(ref);
        if (!current.exists) throw new HttpsError('not-found', 'Document not found.');
        const now = current.data() || {};
        const address = addressReadyToSend(now);
        refuseChangedAddress(address, approved);
        if (now.sha256Checksum !== data.sha256Checksum) {
            throw new HttpsError('aborted', 'This document changed while it was being sent. Try again.');
        }
        refuseClaimed(now.signedCopy);
        tx.update(ref, {
            signedCopy: {
                state: 'sending',
                approvedBy: request.auth.uid,
                approvedByName,
                approvedAt: admin.firestore.FieldValue.serverTimestamp(),
                sentTo: address,
            },
        });
        return { sentTo: address, title: now.title, recipientName: now.recipientName };
    });

    const shownTitle = clipText(title, 200) || 'Untitled Document';
    let sent;
    try {
        sent = await sendDynamicEmail(companyId, sentTo, `Your signed copy: "${shownTitle}"`, emailHtml(shownTitle, recipientName), {
            attachments: [{ filename: pdfFilename(title), content: pdf, contentType: 'application/pdf' }],
        });
    } catch (err) {
        const reason = err?.message || String(err);
        // The code only: a mail server's reply can name the signer's address. The reason is recorded below.
        console.error(`[sendSignedDocumentCopy] Send failed for ${requestId} (${err?.code || err?.responseCode || 'error'})`);
        try {
            await ref.update({ 'signedCopy.state': 'failed', 'signedCopy.error': reason });
        } catch (recordErr) {
            console.error(`[sendSignedDocumentCopy] Could not record the failed send of ${requestId}:`, recordErr.message);
        }
        throw new HttpsError('unavailable', `The signed copy could not be sent. ${reason}`);
    }

    const sentAt = new Date();
    try {
        await ref.update({
            'signedCopy.state': 'sent',
            'signedCopy.sentAt': admin.firestore.Timestamp.fromDate(sentAt),
            'signedCopy.messageId': sent?.messageId || null,
        });
    } catch (err) {
        console.error(`[sendSignedDocumentCopy] Sent ${requestId} but could not record it:`, err.message);
        throw new HttpsError('internal', `The signed copy was sent to ${sentTo}, but it could not be recorded. Do not send it again.`);
    }
    console.log(`[sendSignedDocumentCopy] companyId=${companyId} requestId=${requestId} approvedBy=${request.auth.uid}`);
    return { success: true, sentTo, sentAt: sentAt.toISOString() };
});
