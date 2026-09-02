/**
 * Report import workflow for the public application (PSP report or MVR).
 *
 * One responsibility: turn the applicant's file into page images, ask the
 * secure callable to read them, and hold the suggestions until the applicant
 * decides what to do with each. Applying a suggestion belongs to the panel and
 * `reportSuggestions.js`; this hook never touches form data.
 *
 * PRIVACY: the pages are rendered in memory and sent only to
 * `extractApplicationReport`. Nothing is written to Storage — unlike the CDL
 * auto-fill, there is no audit copy, because a driving record is not a document
 * the application keeps.
 */
import { useCallback, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { loadPdfDocument, renderPageToDataUrl } from '@features/signing/utils/pdfPageRasterizer';
import { fileToDataUrl } from '../components/application/publicApplyHelpers';

/** Must match the callable's `MAX_PAGES`. */
export const REPORT_MAX_PAGES = 5;
export const REPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/**
 * A PDF becomes up to `REPORT_MAX_PAGES` JPEG data URLs; a photo becomes one.
 * Anything else is refused with a message the applicant can act on.
 *
 * @returns {Promise<{pages: string[], totalPages: number}>}
 */
export async function fileToPageImages(file, deps = {}) {
    const { loadPdf = loadPdfDocument, renderPage = renderPageToDataUrl, readImage = fileToDataUrl } = deps;
    if (!file) throw new Error('Choose a file to import.');
    if (file.size > REPORT_MAX_FILE_BYTES) throw new Error('That file is too large. Please upload a file under 15 MB.');

    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        const document = await loadPdf(file);
        try {
            const count = Math.min(document.numPages, REPORT_MAX_PAGES);
            const pages = [];
            for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
                const dataUrl = await renderPage(document, pageNumber);
                if (dataUrl) pages.push(dataUrl);
            }
            if (pages.length === 0) throw new Error('Could not read any pages from that PDF.');
            return { pages, totalPages: document.numPages };
        } finally {
            await document.destroy?.();
        }
    }
    if (IMAGE_TYPES.has(file.type)) {
        return { pages: [await readImage(file)], totalPages: 1 };
    }
    throw new Error('Please upload a PDF or a photo (JPG, PNG or WebP).');
}

export function useReportImport({ companyId, kind }) {
    const [status, setStatus] = useState('idle'); // idle | reading | ready | error
    const [suggestions, setSuggestions] = useState(null);
    const [skippedPages, setSkippedPages] = useState(0);
    const [error, setError] = useState('');
    // A second file chosen while the first is still being read wins; the first
    // result is dropped rather than shown over the newer one.
    const requestRef = useRef(0);

    const reset = useCallback(() => {
        requestRef.current += 1;
        setStatus('idle');
        setSuggestions(null);
        setSkippedPages(0);
        setError('');
    }, []);

    const importFile = useCallback(async (file) => {
        const request = requestRef.current + 1;
        requestRef.current = request;
        setStatus('reading');
        setError('');
        setSuggestions(null);
        try {
            if (!companyId) throw new Error('Company is missing. Please refresh and try again.');
            const { pages, totalPages } = await fileToPageImages(file);
            const extract = httpsCallable(functions, 'extractApplicationReport', { timeout: 60000 });
            const { data } = await extract({ companyId, kind, pages });
            if (requestRef.current !== request) return;
            setSuggestions(data?.suggestions || null);
            setSkippedPages(Math.max(0, totalPages - pages.length));
            setStatus('ready');
        } catch (err) {
            if (requestRef.current !== request) return;
            setError(err?.message || 'Could not read that file. You can continue and enter the details yourself.');
            setStatus('error');
        }
    }, [companyId, kind]);

    return { status, suggestions, skippedPages, error, importFile, reset };
}
