// The envelope editor's document and viewport controls, split out of
// `EnvelopeCreator.jsx` on 2026-09-01 for the source-size standard (SG-1c).
// This hook owns the PDF itself and how it is shown: the selected file, the
// page count, which page is visible (IntersectionObserver), the page refs and
// dimensions, the viewport width with its wheel-zoom and fit handlers, and
// the upload picker with its size ceiling. Bodies verbatim from the
// component; field placement and history stay outside and reach the document
// only through the values returned here.
import { useState, useRef, useEffect, useCallback } from 'react';
import {
    PDF_VIEWPORT_WIDTH_DEFAULT,
    adjustPdfViewportWidth,
    clampPdfViewportWidth,
} from '@features/signing/utils/envelopePdfZoom';
import { SAVE_STATES } from '@features/signing/utils/editorSaveState';

// Upload ceiling. MUST stay <= the storage-rule limit (isValidFile in
// src/storage.rules), otherwise the client accepts files the server rejects.
const MAX_UPLOAD_MB = 20;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export function useEnvelopeDocumentControls({
    hydrating,
    showError,
    setTitle,
    setSaveState,
    resetEditorHistory,
    setSelectedFieldId,
}) {
    const [file, setFile] = useState(null);
    const [numPages, setNumPages] = useState(null);

    // FEAT-1: Track the currently visible page for multi-page field placement
    const [activePage, setActivePage] = useState(1);
    const pageRefs = useRef({});

    const [pageDimensions, setPageDimensions] = useState({});
    const [pdfViewportWidth, setPdfViewportWidth] = useState(PDF_VIEWPORT_WIDTH_DEFAULT);

    const pdfWorkbenchRef = useRef(null);
    const canvasRef = useRef(null);
    const fileRef = useRef(null);

    useEffect(() => {
        fileRef.current = file;
    }, [file]);

    useEffect(() => {
        if (!file) {
            setPdfViewportWidth(PDF_VIEWPORT_WIDTH_DEFAULT);
        }
    }, [file]);

    useEffect(() => {
        if (hydrating) return undefined;
        const el = pdfWorkbenchRef.current;
        if (!el) return undefined;

        const onWheel = (e) => {
            if (!fileRef.current) return;
            if (!(e.ctrlKey || e.metaKey)) return;
            if (!el.contains(e.target)) return;
            e.preventDefault();
            setPdfViewportWidth((w) => adjustPdfViewportWidth(w, e.deltaY, e.deltaMode));
        };

        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, [hydrating]);

    // FEAT-1: IntersectionObserver to track which page is visible
    useEffect(() => {
        if (!numPages) return;
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        const pageNum = parseInt(entry.target.dataset.pageNum);
                        if (pageNum) setActivePage(pageNum);
                    }
                });
            },
            { threshold: 0.5 }
        );
        Object.values(pageRefs.current).forEach((el) => {
            if (el) observer.observe(el);
        });
        return () => observer.disconnect();
    }, [numPages, file]);

    /** Scroll a page into view; the IntersectionObserver then updates activePage. */
    const goToPage = useCallback((page) => {
        const target = pageRefs.current?.[page];
        if (target?.scrollIntoView) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
        setActivePage(page);
    }, []);

    /**
     * Fit Width / Fit Page.
     *
     * Both express themselves as a viewport WIDTH, because that is the single
     * dimension the workbench renders from — so fitting cannot desynchronise
     * the field overlays from the page.
     */
    const handleFitWidth = useCallback(() => {
        const available = canvasRef.current?.clientWidth;
        if (!available) return;
        // Leave the canvas gutter so the page is not flush against the rails.
        setPdfViewportWidth(clampPdfViewportWidth(available - 64));
    }, []);

    const handleFitPage = useCallback(() => {
        const availableHeight = canvasRef.current?.clientHeight;
        const availableWidth = canvasRef.current?.clientWidth;
        if (!availableHeight || !availableWidth) return;
        const dims = pageDimensions[activePage];
        const ratio = dims && dims.width > 0 ? dims.height / dims.width : 11 / 8.5;
        const widthThatFitsHeight = (availableHeight - 64) / ratio;
        setPdfViewportWidth(clampPdfViewportWidth(Math.min(availableWidth - 64, widthThatFitsHeight)));
    }, [pageDimensions, activePage]);

    const handleFileChange = (e) => {
        const selected = e.target.files[0];
        if (selected && selected.type === 'application/pdf') {
            // Keep this limit in lock-step with the storage rule (isValidFile in
            // storage.rules, currently < 20MB). If the client accepts a file the
            // rule rejects, the upload fails server-side and surfaces as an opaque
            // error — so the two limits MUST match.
            if (selected.size >= MAX_UPLOAD_BYTES) {
                showError(`File too large. Maximum size is ${MAX_UPLOAD_MB}MB.`);
                return;
            }
            setFile(selected);
            setNumPages(null); // RACE FIX: Wipe stale page count before new document loads
            setTitle(selected.name.replace('.pdf', ''));
            // A different document invalidates every placement, so the history
            // starts again rather than letting undo reach fields that belonged
            // to the previous PDF.
            resetEditorHistory([], { markClean: false });
            setSelectedFieldId(null);
            setSaveState(SAVE_STATES.UNSAVED);
        } else {
            showError('Please upload a valid PDF file.');
        }
    };

    const onPageLoadSuccess = (page) => {
        setPageDimensions(prev => ({ ...prev, [page.pageNumber]: { width: page.width, height: page.height } }));
    };

    return {
        file,
        setFile,
        fileRef,
        numPages,
        setNumPages,
        activePage,
        pageRefs,
        pageDimensions,
        pdfViewportWidth,
        setPdfViewportWidth,
        pdfWorkbenchRef,
        canvasRef,
        goToPage,
        handleFitWidth,
        handleFitPage,
        handleFileChange,
        onPageLoadSuccess,
    };
}
