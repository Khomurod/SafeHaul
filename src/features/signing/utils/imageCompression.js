/**
 * Re-encoding a photo for an AI read, apart from the PDF rasterizer so that a
 * photo never fetches pdf.js (about 116 KB gzipped): the driver's report import
 * loads the rasterizer only for a PDF.
 *
 * PRIVACY: the image lives only in memory for the duration of one read.
 */

/** Rendered width sent to the provider. Enough to read 8pt form labels. */
export const RASTER_MAX_WIDTH = 1300;

/** JPEG quality — small enough to stay inside the callable's payload ceiling. */
export const RASTER_QUALITY = 0.72;

/**
 * Re-encode a photo the way PDF pages are rendered: at most `RASTER_MAX_WIDTH`
 * wide, JPEG, in memory. A phone photo is several megabytes and base64 grows it
 * by a third, so sent raw it is refused by an AI callable's per-page ceiling
 * (4 MiB of data URL) every time. Returns null where the environment has no
 * bitmap or canvas support, and the caller falls back to the raw file.
 */
export async function compressImageFile(file) {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch {
        return null;
    }
    try {
        const scale = Math.min(1, RASTER_MAX_WIDTH / bitmap.width);
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return null;
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', RASTER_QUALITY);
        canvas.width = 0;
        canvas.height = 0;
        return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
    } finally {
        bitmap.close?.();
    }
}
