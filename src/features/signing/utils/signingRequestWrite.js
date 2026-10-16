/**
 * Writing a new signing request, for both places that send one: the template
 * wizard (`useTemplateSendFlow`) and the envelope editor (`saveEnvelope`). Each
 * sender checks its recipient and builds what the request is (its title,
 * fields and PDF); these write who it goes to, who sent it, how it is delivered
 * and when its link expires, and tell the sender it went.
 */
import { db, auth } from '@lib/firebase';
import { collection, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { copySigningLink, LINK_NOT_COPIED } from '@features/signing/utils/copySigningLink';

/** How long a signing link works. */
const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** How a sent request's delivery is named in its confirmation. */
const DELIVERY_LABELS = { email: 'Email', sms: 'SMS', both: 'Email + SMS' };

/** The delivery a request records, which the server's senders follow. */
export function deliveryFields(deliveryMethod) {
    return {
        sendEmail: deliveryMethod === 'email' || deliveryMethod === 'both',
        sendSms: deliveryMethod === 'sms' || deliveryMethod === 'both',
        deliveryMethod,
    };
}

/**
 * Writes a new signing request and its access token in one batch, so no
 * request exists without the token its link carries. The token is kept in the
 * request's `secrets/token`, which only the server reads. `content` is the
 * sender's part of the request; the recipient is written as given. Returns the
 * request's signing link.
 */
export async function createSigningRequest({
    companyId,
    recipientName,
    recipientEmail,
    recipientPhone,
    deliveryMethod,
    content,
}) {
    const accessToken = uuidv4();
    const signingRef = doc(collection(db, 'companies', companyId, 'signing_requests'));
    const batch = writeBatch(db);
    batch.set(signingRef, {
        ...content,
        companyId,
        recipientEmail: recipientEmail || null,
        recipientName,
        recipientPhone: recipientPhone || null,
        status: 'sent',
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + LINK_LIFETIME_MS),
        senderId: auth.currentUser.uid,
        senderName: auth.currentUser?.displayName || auth.currentUser?.email || 'Your Employer',
        ...deliveryFields(deliveryMethod),
        // The sender's domain, which the server's links to this request use.
        appBaseUrl: window.location.origin,
    });
    batch.set(doc(signingRef, 'secrets', 'token'), { accessToken });
    await batch.commit();
    return `${window.location.origin}/sign/${companyId}/${signingRef.id}?token=${accessToken}`;
}

/**
 * Tells the sender a request just created is on its way, or copies its link
 * for Copy Link. The request is saved by now: a refused clipboard must not read
 * as a failed send, or sending again would create a second request.
 */
export async function announceSigningRequest({ link, deliveryMethod, showSuccess, showWarning }) {
    if (deliveryMethod === 'copy') {
        if (await copySigningLink(link)) showSuccess('Signing link copied to clipboard!');
        else showWarning(LINK_NOT_COPIED);
        return;
    }
    // The server emails and texts the link (`notifySigner`, `notifySignerSMS`),
    // as the request's `sendEmail` and `sendSms` say, whoever sent it.
    showSuccess(`Document created! ${DELIVERY_LABELS[deliveryMethod] || 'Email'} delivery in progress...`);
}
