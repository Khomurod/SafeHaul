/**
 * Copies a signing link to the clipboard: true once it is there, false when the
 * browser refuses. A page that lost focus, a browser that wants a fresh click
 * after the wait for the save, or a page without a clipboard at all refuses.
 * By then the request exists, so a refusal is a link still to copy from Sent
 * Documents, never a failed send.
 */
export async function copySigningLink(link) {
    try {
        await navigator.clipboard.writeText(link);
        return true;
    } catch {
        return false;
    }
}

/** What a sender reads when the link of a request just created could not be copied. */
export const LINK_NOT_COPIED = 'Document created, but the browser blocked copying its link. Copy it from Sent Documents.';
