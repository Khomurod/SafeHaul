import { useCallback, useEffect, useRef, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    buildSuggestionSet,
    normalizeManualReview,
    normalizeSuggestion,
} from '@features/signing/utils/aiFieldSuggestions';
import { inspectPdfDocument } from '@features/signing/utils/pdfFieldInspector';
import { loadPdfDocument, renderPageToDataUrl } from '@features/signing/utils/pdfPageRasterizer';

/**
 * AI Field Assistant — scan orchestration.
 *
 * Owns the *suggestion* lifecycle only. It never touches the editor's `fields`
 * array, never saves a template and never sends a document: `EnvelopeCreator`
 * applies reviewed suggestions explicitly.
 *
 * Hybrid analysis, in order:
 *   1. deterministic PDF inspection (AcroForm widgets, annotations, ruled
 *      blanks in the text layer) — measured geometry, always trusted first;
 *   2. vision analysis via the authenticated `analyzeEdocFieldPlacement`
 *      callable, only for pages the deterministic pass could not describe from
 *      embedded form data. A page that already carries real widgets does not
 *      need — and must not be overruled by — a visual guess.
 *
 * Every scan carries a `scanId`. A response whose id is not the current one is
 * discarded, so a slow answer can never overwrite a newer scan or a cancelled
 * one.
 */

/** Pages per callable request. The backend hard-caps this at 5. */
export const PAGES_PER_REQUEST = 3;

/**
 * Most pages one scan may cover.
 *
 * The callable allows 12 requests per user per 60 s, and a scan issues one
 * request per `PAGES_PER_REQUEST` pages. Anything beyond this would spend the
 * whole budget and then get rejected mid-scan, so the scan is capped up front
 * and the operator is told, rather than discovering it as a failure halfway
 * through a 60-page packet.
 */
export const MAX_SCAN_PAGES = PAGES_PER_REQUEST * 12;

export const SCAN_SCOPES = Object.freeze(['current', 'selected', 'all']);

const STATUS = Object.freeze({
    IDLE: 'idle',
    SCANNING: 'scanning',
    READY: 'ready',
    ERROR: 'error',
    CANCELLED: 'cancelled',
});

const chunk = (items, size) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
};

/** Resolve a scope + explicit selection into the concrete page list to scan. */
export function resolveScanPages({ scope, selectedPages = [], activePage = 1, numPages = 1 }) {
    const total = Number.isFinite(numPages) && numPages > 0 ? numPages : 1;
    const inRange = (page) => Number.isInteger(page) && page >= 1 && page <= total;

    if (scope === 'all') {
        return Array.from({ length: total }, (_, index) => index + 1).slice(0, MAX_SCAN_PAGES);
    }
    if (scope === 'selected') {
        return [...new Set(selectedPages.filter(inRange))].sort((a, b) => a - b).slice(0, MAX_SCAN_PAGES);
    }
    return inRange(activePage) ? [activePage] : [1];
}

/** Pages the operator asked for, before MAX_SCAN_PAGES is applied. */
export function resolveRequestedPageCount({ scope, selectedPages = [], numPages = 1 }) {
    const total = Number.isFinite(numPages) && numPages > 0 ? numPages : 1;
    if (scope === 'all') return total;
    if (scope === 'selected') {
        return new Set(
            selectedPages.filter((page) => Number.isInteger(page) && page >= 1 && page <= total),
        ).size;
    }
    return 1;
}

const newScanId = () =>
    (globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);

export function useAiFieldAssistant({ companyId, file, numPages, activePage, fields = [] }) {
    const [status, setStatus] = useState(STATUS.IDLE);
    const [progress, setProgress] = useState({ phase: 'idle', completed: 0, total: 0 });
    const [suggestions, setSuggestions] = useState([]);
    const [manualReview, setManualReview] = useState([]);
    const [stats, setStats] = useState(null);
    const [error, setError] = useState(null);
    const [lastScan, setLastScan] = useState(null);
    // True when a scan failed but had already produced usable suggestions.
    const [partial, setPartial] = useState(false);
    // Set when the requested page range was larger than one scan may cover.
    const [truncatedPages, setTruncatedPages] = useState(0);

    // The id of the scan whose results the UI is currently willing to accept.
    const activeScanRef = useRef(null);
    const abortRef = useRef(null);
    // Latest fields, so a long scan flags overlaps against the current editor
    // state rather than the state at scan start.
    const fieldsRef = useRef(fields);
    fieldsRef.current = fields;

    const canScan = Boolean(companyId && file && numPages > 0);

    const cancelScan = useCallback(() => {
        if (!activeScanRef.current) return;
        abortRef.current?.abort();
        activeScanRef.current = null;
        abortRef.current = null;
        setStatus(STATUS.CANCELLED);
        setProgress({ phase: 'idle', completed: 0, total: 0 });
    }, []);

    // A different document invalidates every suggestion on screen.
    useEffect(() => {
        activeScanRef.current = null;
        abortRef.current?.abort();
        abortRef.current = null;
        setSuggestions([]);
        setManualReview([]);
        setStats(null);
        setError(null);
        setPartial(false);
        setTruncatedPages(0);
        setStatus(STATUS.IDLE);
        setProgress({ phase: 'idle', completed: 0, total: 0 });
    }, [file]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const startScan = useCallback(
        async ({ scope = 'current', selectedPages = [] } = {}) => {
            if (!canScan) return;

            const pages = resolveScanPages({ scope, selectedPages, activePage, numPages });
            const requestedCount = resolveRequestedPageCount({ scope, selectedPages, activePage, numPages });
            setTruncatedPages(Math.max(0, requestedCount - pages.length));
            if (pages.length === 0) {
                setError('Choose at least one page to scan.');
                setStatus(STATUS.ERROR);
                return;
            }

            const scanId = newScanId();
            const controller = new AbortController();
            abortRef.current?.abort();
            abortRef.current = controller;
            activeScanRef.current = scanId;

            /** True only while this scan is still the one the user is waiting for. */
            const isCurrent = () => activeScanRef.current === scanId && !controller.signal.aborted;

            setStatus(STATUS.SCANNING);
            setError(null);
            setPartial(false);
            setSuggestions([]);
            setManualReview([]);
            setStats(null);
            setProgress({ phase: 'inspecting', completed: 0, total: pages.length });

            const rawSuggestions = [];
            const rawManualReview = [];
            let pdfDocument = null;

            /**
             * Turn whatever has been collected so far into reviewable state.
             * Called on success and on failure, so a scan that dies partway
             * still surfaces the pages it did analyse.
             *
             * @returns {number} how many suggestions were published
             */
            const publishResults = () => {
                const built = buildSuggestionSet({
                    rawSuggestions,
                    existingFields: fieldsRef.current,
                    allowedPages: new Set(pages),
                });

                const seenWarning = new Set();
                const warnings = rawManualReview
                    .map(normalizeManualReview)
                    .filter(Boolean)
                    .filter((entry) => {
                        const key = `${entry.page}:${entry.kind}`;
                        if (seenWarning.has(key)) return false;
                        seenWarning.add(key);
                        return true;
                    });

                setSuggestions(built.suggestions);
                setStats(built.stats);
                setManualReview(warnings);
                return built.suggestions.length;
            };

            try {
                pdfDocument = await loadPdfDocument(file);
                if (!isCurrent()) return;

                const inspection = await inspectPdfDocument(pdfDocument, pages, {
                    signal: controller.signal,
                });
                if (!isCurrent()) return;

                rawSuggestions.push(...inspection.rawSuggestions);
                rawManualReview.push(...inspection.manualReview);

                // A page is skipped only when its embedded AcroForm widgets
                // describe the WHOLE page — that is, it has widget-derived
                // suggestions and no ruled blanks left over. A hybrid page (one
                // widget plus printed `______` blanks) still gets the vision
                // pass, because one widget is not proof the rest is covered.
                // Precedence is not at stake either way: `buildSuggestionSet`
                // already lets a measured `pdf` suggestion win over a visual one.
                const widgetPages = new Set();
                const textRunPages = new Set();
                for (const item of inspection.rawSuggestions) {
                    if (item.origin === 'widget') widgetPages.add(item.page);
                    else if (item.origin === 'textRun') textRunPages.add(item.page);
                }
                const visionPages = pages.filter(
                    (page) => !widgetPages.has(page) || textRunPages.has(page),
                );

                if (visionPages.length > 0) {
                    const functions = getFunctions();
                    const analyze = httpsCallable(functions, 'analyzeEdocFieldPlacement');
                    const batches = chunk(visionPages, PAGES_PER_REQUEST);
                    let completed = pages.length - visionPages.length;

                    for (const batch of batches) {
                        if (!isCurrent()) return;
                        setProgress({ phase: 'rendering', completed, total: pages.length });

                        const rendered = [];
                        for (const pageNumber of batch) {
                            if (!isCurrent()) return;
                            const imageDataUrl = await renderPageToDataUrl(pdfDocument, pageNumber);
                            if (imageDataUrl) rendered.push({ pageNumber, imageDataUrl });
                        }
                        if (!isCurrent()) return;
                        if (rendered.length === 0) {
                            completed += batch.length;
                            continue;
                        }

                        setProgress({ phase: 'analyzing', completed, total: pages.length });

                        const response = await analyze({ companyId, scanId, pages: rendered });
                        // A response for a scan that is no longer current is
                        // dropped outright — this is the staleness guard.
                        if (!isCurrent()) return;
                        const payload = response?.data || {};
                        if (payload.scanId && payload.scanId !== scanId) continue;

                        for (const item of payload.suggestions || []) {
                            rawSuggestions.push({ ...item, source: 'vision' });
                        }
                        rawManualReview.push(...(payload.manualReview || []));

                        completed += batch.length;
                        setProgress({ phase: 'analyzing', completed, total: pages.length });
                    }
                }

                if (!isCurrent()) return;

                publishResults();
                setLastScan({ scanId, scope, pages });
                setStatus(STATUS.READY);
                setProgress({ phase: 'done', completed: pages.length, total: pages.length });
            } catch (err) {
                if (!isCurrent()) return;
                // Never surface raw provider/document detail to the operator.
                const code = err?.code || '';
                if (code === 'functions/resource-exhausted') {
                    setError('Too many scans right now. Please wait a moment and try again.');
                } else if (code === 'functions/permission-denied') {
                    setError('You do not have access to run the AI Field Assistant for this company.');
                } else if (code === 'functions/failed-precondition') {
                    setError('The AI Field Assistant is not configured on the server yet.');
                } else if (code === 'functions/unavailable') {
                    setError('Could not reach the AI service. Please try again.');
                } else {
                    setError('The scan could not be completed. Please try again.');
                }
                // Keep whatever the scan already produced. Throwing away pages
                // that were successfully analysed — and paid for — because a
                // later page failed would make a partial failure worse than no
                // scan at all. The error banner sits above the partial results.
                const kept = publishResults();
                if (kept > 0) {
                    setPartial(true);
                    setLastScan({ scanId, scope, pages });
                }
                setStatus(STATUS.ERROR);
                setProgress({ phase: 'idle', completed: 0, total: 0 });
            } finally {
                if (activeScanRef.current === scanId) {
                    activeScanRef.current = null;
                    abortRef.current = null;
                }
                try {
                    await pdfDocument?.destroy?.();
                } catch (_) {
                    // A document that is already gone is not an error.
                }
            }
        },
        [canScan, companyId, file, numPages, activePage],
    );

    /** Edit one suggestion in place. Re-validated so an edit cannot break it. */
    const updateSuggestion = useCallback((suggestionId, patch) => {
        setSuggestions((prev) =>
            prev.map((item) => {
                if (item.suggestionId !== suggestionId) return item;
                const merged = { ...item, ...patch };
                const revalidated = normalizeSuggestion(merged, {
                    idFactory: () => item.suggestionId,
                });
                if (!revalidated) return item;
                return {
                    ...revalidated,
                    suggestionId: item.suggestionId,
                    status: merged.status || item.status,
                    overlapsFieldId: item.overlapsFieldId,
                    overlapsFieldLabel: item.overlapsFieldLabel,
                };
            }),
        );
    }, []);

    const setSuggestionStatus = useCallback((suggestionId, nextStatus) => {
        setSuggestions((prev) =>
            prev.map((item) => (item.suggestionId === suggestionId ? { ...item, status: nextStatus } : item)),
        );
    }, []);

    const removeSuggestions = useCallback((suggestionIds) => {
        const ids = new Set(suggestionIds);
        setSuggestions((prev) => prev.filter((item) => !ids.has(item.suggestionId)));
    }, []);

    const discardAll = useCallback(() => {
        activeScanRef.current = null;
        abortRef.current?.abort();
        abortRef.current = null;
        setSuggestions([]);
        setManualReview([]);
        setStats(null);
        setError(null);
        setPartial(false);
        setTruncatedPages(0);
        setStatus(STATUS.IDLE);
        setProgress({ phase: 'idle', completed: 0, total: 0 });
    }, []);

    return {
        status,
        isScanning: status === STATUS.SCANNING,
        canScan,
        progress,
        suggestions,
        manualReview,
        stats,
        error,
        partial,
        truncatedPages,
        lastScan,
        startScan,
        cancelScan,
        updateSuggestion,
        setSuggestionStatus,
        removeSuggestions,
        discardAll,
    };
}

export default useAiFieldAssistant;
