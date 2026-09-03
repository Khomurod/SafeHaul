import { renderPageToDataUrl } from '@features/signing/utils/pdfPageRasterizer';
import { extractPdfText, loadPdf, MIN_CHARS_PER_DOCUMENT } from './pdfTextLayer';
import { recognizePages } from './ocrFallback';

/**
 * Turning whatever the carrier attached into something the reader can use.
 *
 * Per document, in order of what is cheapest and most accurate:
 *
 *  1. a PDF's own text layer — free, exact, and what a PSP report or a motor
 *     vehicle record actually is;
 *  2. failing that, OCR of the rendered pages, in this browser;
 *  3. failing that, the pages themselves, sent to the vision route server-side.
 *
 * A photograph skips straight to 2, and to 3 when recognition comes back thin.
 * Nothing is required: one document or five, in any combination, and a document
 * that produces nothing usable is reported as such rather than silently dropped.
 *
 * PRIVACY: every page rendered here lives in memory for the length of one
 * extraction. Nothing is written to storage, and the text goes to exactly one
 * place — `extractCompanyApplicationDocuments`.
 */

/** How many pages of one document are worth reading. Matches the callable's own cap. */
export const MAX_PAGES_PER_DOCUMENT = 5;
const PDF_TYPES = /^application\/pdf$/;
const IMAGE_TYPES = /^image\/(png|jpe?g|webp)$/;

/** The application's upload fields, mapped to what the reader calls each document. */
export const DOCUMENT_FIELD_KINDS = Object.freeze({
    'cdl-front': 'cdl',
    'cdl-back': 'cdl',
    'medical-card-upload': 'medical',
    'psp-report-upload': 'psp',
    'mvr-upload': 'mvr',
});

function isPdf(file) {
    return PDF_TYPES.test(file?.type || '') || /\.pdf$/i.test(file?.name || '');
}

/** Rendered pages, for OCR here or for the vision route server-side. */
async function renderPages(file, deps) {
    const { load = loadPdf, renderPage = renderPageToDataUrl, readImage } = deps;
    if (!isPdf(file)) {
        const dataUrl = await readImage(file);
        return dataUrl ? [dataUrl] : [];
    }
    const document = await load(file);
    try {
        const count = Math.min(document.numPages, MAX_PAGES_PER_DOCUMENT);
        const pages = [];
        for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
            const dataUrl = await renderPage(document, pageNumber);
            if (dataUrl) pages.push(dataUrl);
        }
        return pages;
    } finally {
        await document.destroy?.();
    }
}

/**
 * One document, read as well as this browser can manage.
 *
 * @returns {Promise<{kind: string, method: 'text'|'ocr'|'pages'|'failed', text?: string, pages?: string[]}>}
 */
export async function extractOneDocument({ kind, file }, deps = {}) {
    const { extractText = extractPdfText, recognize = recognizePages } = deps;

    if (!file) return { kind, method: 'failed' };
    if (!isPdf(file) && !IMAGE_TYPES.test(file.type || '')) {
        return { kind, method: 'failed', reason: 'Only PDFs and photos can be read.' };
    }

    if (isPdf(file)) {
        try {
            const layer = await extractText(file, deps);
            if (layer.sufficient) return { kind, method: 'text', text: layer.text };
        } catch {
            // A PDF whose text layer cannot be read is a PDF to look at instead.
        }
    }

    let pages = [];
    try {
        pages = await renderPages(file, deps);
    } catch {
        return { kind, method: 'failed', reason: 'That file could not be opened.' };
    }
    if (pages.length === 0) return { kind, method: 'failed', reason: 'That file could not be opened.' };

    try {
        const recognised = await recognize(pages, deps);
        if (recognised.text.length >= MIN_CHARS_PER_DOCUMENT) {
            return { kind, method: 'ocr', text: recognised.text };
        }
    } catch {
        // Recognition is the fallback, not the last word — the pages themselves
        // still go to a model that reads images for a living.
    }

    return { kind, method: 'pages', pages };
}

/**
 * Every attached document, read in parallel, in the shape the callable takes.
 *
 * @param {Array<{kind: string, file: File}>} documents any subset; at least one
 * @returns {Promise<{documents: object, methods: object, failures: object}>}
 */
export async function extractDocuments(documents, deps = {}) {
    const attached = (documents || []).filter((entry) => entry?.file && entry?.kind);
    const results = await Promise.all(attached.map((entry) => extractOneDocument(entry, deps)));

    const payload = {};
    const methods = {};
    const failures = {};

    for (const result of results) {
        methods[result.kind] = result.method;
        if (result.method === 'text' || result.method === 'ocr') {
            // Two documents of one kind — a licence front and back — are one
            // document to the reader, so their text is joined rather than one
            // replacing the other.
            payload[result.kind] = payload[result.kind]
                ? `${payload[result.kind]}\n${result.text}`
                : result.text;
        } else if (result.method === 'pages') {
            payload[result.kind] = { pages: [...(payload[result.kind]?.pages || []), ...result.pages] };
        } else {
            failures[result.kind] = result.reason || 'That document could not be read.';
        }
    }

    return {
        documents: Object.fromEntries(Object.entries(payload).map(([kind, value]) => [
            kind,
            typeof value === 'string' ? { text: value } : value,
        ])),
        methods,
        failures,
    };
}

export default extractDocuments;
