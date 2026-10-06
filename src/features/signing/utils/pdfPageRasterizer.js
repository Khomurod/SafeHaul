/**
 * PDF loading + page rasterization for the AI Field Assistant.
 *
 * Isolated in its own module for two reasons: it is the only part of the
 * assistant that needs a browser canvas, and keeping it separate lets the
 * orchestration hook be tested without PDF.js or a real canvas.
 *
 * PRIVACY: rendered images live only in memory for the duration of one scan.
 * Nothing here writes to Storage, IndexedDB, localStorage or the DOM.
 */

import { pdfjs } from 'react-pdf';
import '@lib/pdf/pdfWorker';

/** Rendered width sent to the provider. Enough to read 8pt form labels. */
export const RASTER_MAX_WIDTH = 1300;

/** JPEG quality — small enough to stay inside the callable's payload ceiling. */
export const RASTER_QUALITY = 0.72;

/**
 * Load a File/Blob into a PDF.js document.
 * The caller owns the returned document and must call `destroy()`.
 */
export async function loadPdfDocument(file) {
    const data = await file.arrayBuffer();
    return pdfjs.getDocument({ data }).promise;
}

/**
 * Render one page to a JPEG data URL.
 *
 * @returns {Promise<string|null>} null when the environment has no usable canvas.
 */
export async function renderPageToDataUrl(pdfDocument, pageNumber, options = {}) {
    const maxWidth = options.maxWidth || RASTER_MAX_WIDTH;
    const quality = options.quality || RASTER_QUALITY;

    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, Math.max(0.5, maxWidth / baseViewport.width));
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    await page.render({ canvasContext: context, viewport }).promise;

    const dataUrl = canvas.toDataURL('image/jpeg', quality);

    // Drop the backing bitmap immediately; a full-page render is several MB.
    canvas.width = 0;
    canvas.height = 0;

    return typeof dataUrl === 'string' && dataUrl.startsWith('data:image/') ? dataUrl : null;
}

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
