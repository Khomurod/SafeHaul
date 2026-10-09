/**
 * A phone photo made small enough to send quickly from the road.
 *
 * A phone camera's photo of a licence is often 4 to 12 MB, which on a weak
 * connection is a minute or more of upload for a document that reads perfectly
 * well at a fraction of the size, and which the CDL reader refuses above 8 MB. A
 * photo over `PHOTO_TARGET_BYTES` is redrawn with its longest side at most
 * `PHOTO_MAX_SIDE` pixels as a JPEG; a PDF, a small photo, one the browser cannot
 * decode (HEIC outside Safari) or one that would not come out smaller is sent as
 * it is. Transparent areas are drawn on white, as on paper.
 */

export const PHOTO_TARGET_BYTES = 2.5 * 1024 * 1024;
export const PHOTO_MAX_SIDE = 2400;
const SHRINKABLE = /^image\/(jpeg|png|webp|heic|heif)$/;

/** `file`, or a smaller JPEG of it. Never throws: a photo that cannot be redrawn goes as it is. */
export async function shrinkPhoto(file) {
    if (!file || !SHRINKABLE.test(file.type) || file.size <= PHOTO_TARGET_BYTES) return file;
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    try {
        const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return file;
        context.fillStyle = 'white';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
        if (!blob || blob.size >= file.size) return file;
        const name = `${file.name.replace(/\.[^./]+$/, '') || 'photo'}.jpg`;
        return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
    } catch {
        return file;
    }
}
