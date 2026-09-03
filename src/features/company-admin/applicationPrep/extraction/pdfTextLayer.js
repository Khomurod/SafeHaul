import { pdfjs } from 'react-pdf';

/**
 * A PDF's own text, where it has any.
 *
 * A PSP report and a motor vehicle record are generated documents: their text
 * layer IS the text, exactly as the agency wrote it, with no recognition step to
 * be wrong about. Reading it costs nothing and beats OCR of the same page every
 * time — so this is tried first, and OCR is what happens when it comes back empty.
 *
 * Uses the same `pdfjs` react-pdf already configures for the signing room's
 * rasterizer, so there is one PDF.js in the bundle and one worker on disk.
 */

/**
 * When a page's text layer counts as read rather than missing.
 *
 * A scanned page usually yields nothing at all; a few stray characters is what a
 * page of images with a headline in real text looks like. The threshold is
 * deliberately low and deliberately named: erring towards OCR costs a few seconds
 * of a recruiter's time, and erring away from it silently loses the document.
 */
export const MIN_CHARS_PER_PAGE = 40;
export const MIN_CHARS_PER_DOCUMENT = 200;

/** Load a File/Blob into a PDF.js document. The caller owns it and must `destroy()`. */
export async function loadPdf(file) {
    const data = await file.arrayBuffer();
    return pdfjs.getDocument({ data }).promise;
}

/** One page's text, items joined in the order the document lists them. */
export async function extractPageText(pdfDocument, pageNumber) {
    const page = await pdfDocument.getPage(pageNumber);
    const content = await page.getTextContent();
    return (content?.items || [])
        .map((item) => (typeof item?.str === 'string' ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Every page's text, and whether it is worth sending.
 *
 * @returns {Promise<{text: string, pageCount: number, pagesWithText: number, sufficient: boolean}>}
 */
export async function extractPdfText(file, deps = {}) {
    const { load = loadPdf, pageText = extractPageText } = deps;
    const document = await load(file);
    try {
        const pageCount = document.numPages;
        const pages = [];
        for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
            pages.push(await pageText(document, pageNumber));
        }
        const text = pages.join('\n').trim();
        const pagesWithText = pages.filter((page) => page.length >= MIN_CHARS_PER_PAGE).length;
        return {
            text,
            pageCount,
            pagesWithText,
            // Both bars, because they catch different documents: a long scan with
            // one real-text cover page passes the per-page test and fails this, and
            // a genuine one-page certificate passes this and would fail a
            // per-page-average test.
            sufficient: text.length >= MIN_CHARS_PER_DOCUMENT && pagesWithText > 0,
        };
    } finally {
        await document.destroy?.();
    }
}

export default extractPdfText;
