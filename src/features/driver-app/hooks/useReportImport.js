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
import { aiReadErrorMessage } from '@shared/utils/aiReadErrors';
import {
    compressImageFile,
    loadPdfDocument,
    renderPageToDataUrl,
} from '@features/signing/utils/pdfPageRasterizer';
import { fileToDataUrl } from '../components/application/publicApplyHelpers';

/** Must match the callable's `MAX_PAGES`. */
export const REPORT_MAX_PAGES = 5;
/** Must match the callable's `MAX_IMAGE_CHARS`: the size of one page as a data URL. */
export const REPORT_MAX_PAGE_CHARS = 4 * 1024 * 1024;
export const REPORT_MAX_FILE_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const PAGE_TOO_LARGE = 'That page is too large to read. Please upload a smaller photo, or a PDF.';

function assertPageFits(dataUrl) {
    if (typeof dataUrl !== 'string' || dataUrl.length > REPORT_MAX_PAGE_CHARS) throw new Error(PAGE_TOO_LARGE);
    return dataUrl;
}

/**
 * A PDF becomes up to `REPORT_MAX_PAGES` JPEG data URLs; a photo becomes one.
 * Every page is held to the callable's own per-page ceiling here, so nothing is
 * sent that the server is certain to refuse. Anything else is refused with a
 * message the applicant can act on.
 *
 * @returns {Promise<{pages: string[], totalPages: number}>}
 */
export async function fileToPageImages(file, deps = {}) {
    const {
        loadPdf = loadPdfDocument,
        renderPage = renderPageToDataUrl,
        readImage = fileToDataUrl,
        compressImage = compressImageFile,
    } = deps;
    if (!file) throw new Error('Choose a file to import.');
    if (file.size > REPORT_MAX_FILE_BYTES) throw new Error('That file is too large. Please upload a file under 15 MB.');

    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
        const document = await loadPdf(file);
        try {
            const count = Math.min(document.numPages, REPORT_MAX_PAGES);
            const pages = [];
            for (let pageNumber = 1; pageNumber <= count; pageNumber += 1) {
                const dataUrl = await renderPage(document, pageNumber);
                if (dataUrl) pages.push(assertPageFits(dataUrl));
            }
            if (pages.length === 0) throw new Error('Could not read any pages from that PDF.');
            return { pages, totalPages: document.numPages };
        } finally {
            await document.destroy?.();
        }
    }
    if (IMAGE_TYPES.has(file.type)) {
        const dataUrl = (await compressImage(file)) || (await readImage(file));
        return { pages: [assertPageFits(dataUrl)], totalPages: 1 };
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
            setError(aiReadErrorMessage(err, 'Reading the report did not finish. You can try again, or continue and enter the details yourself.'));
            setStatus('error');
        }
    }, [companyId, kind]);

    return { status, suggestions, skippedPages, error, importFile, reset };
}
