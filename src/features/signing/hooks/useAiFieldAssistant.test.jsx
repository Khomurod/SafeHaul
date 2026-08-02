// AI Field Assistant scan orchestration: scope resolution, progress,
// cancellation, stale-response rejection, hybrid precedence and editing.
//
// The AI provider is never reached: `analyzeEdocFieldPlacement` is a vitest
// mock and PDF.js is replaced with stubs. Every page, field and label is
// artificial.
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callable = vi.hoisted(() => vi.fn());
const pdfMocks = vi.hoisted(() => ({
    loadPdfDocument: vi.fn(),
    renderPageToDataUrl: vi.fn(),
    inspectPdfDocument: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => callable),
}));
vi.mock('@features/signing/utils/pdfPageRasterizer', () => ({
    loadPdfDocument: (...args) => pdfMocks.loadPdfDocument(...args),
    renderPageToDataUrl: (...args) => pdfMocks.renderPageToDataUrl(...args),
}));
vi.mock('@features/signing/utils/pdfFieldInspector', async (importOriginal) => ({
    ...(await importOriginal()),
    inspectPdfDocument: (...args) => pdfMocks.inspectPdfDocument(...args),
}));

import { MAX_SCAN_PAGES, resolveScanPages, useAiFieldAssistant } from './useAiFieldAssistant';

const FILE = { name: 'artificial.pdf' };

const visionSuggestion = (overrides = {}) => ({
    page: 1,
    category: 'signature',
    type: 'signature',
    bindingKey: '',
    label: 'Sign here',
    required: true,
    confidence: 0.9,
    x: 10,
    y: 10,
    width: 25,
    height: 5,
    ...overrides,
});

const setup = (overrides = {}) =>
    renderHook((props) => useAiFieldAssistant(props), {
        initialProps: {
            companyId: 'co-1',
            file: FILE,
            numPages: 3,
            activePage: 2,
            fields: [],
            ...overrides,
        },
    });

beforeEach(() => {
    vi.clearAllMocks();
    pdfMocks.loadPdfDocument.mockResolvedValue({ destroy: vi.fn() });
    pdfMocks.inspectPdfDocument.mockResolvedValue({
        rawSuggestions: [],
        manualReview: [],
        pagesWithText: [],
    });
    pdfMocks.renderPageToDataUrl.mockResolvedValue('data:image/jpeg;base64,AAA');
    callable.mockResolvedValue({ data: { suggestions: [], manualReview: [] } });
});

describe('resolveScanPages', () => {
    it('scans only the visible page by default', () => {
        expect(resolveScanPages({ scope: 'current', activePage: 3, numPages: 5 })).toEqual([3]);
    });

    it('scans the whole document for the all scope', () => {
        expect(resolveScanPages({ scope: 'all', numPages: 4 })).toEqual([1, 2, 3, 4]);
    });

    it('sorts, de-duplicates and clamps an explicit selection', () => {
        expect(resolveScanPages({ scope: 'selected', selectedPages: [3, 1, 3, 99, 0], numPages: 4 })).toEqual([1, 3]);
    });

    it('falls back to page 1 when the active page is out of range', () => {
        expect(resolveScanPages({ scope: 'current', activePage: 9, numPages: 2 })).toEqual([1]);
    });

    it('caps a scan at the callable rate budget rather than failing mid-way', () => {
        // The callable allows 12 requests per user per minute, and a scan issues
        // one request per batch, so a 200-page packet must not try to spend
        // more than the budget and get rejected part-way through.
        const all = resolveScanPages({ scope: 'all', numPages: 200 });
        expect(all).toHaveLength(MAX_SCAN_PAGES);
        expect(all[0]).toBe(1);

        const selected = resolveScanPages({
            scope: 'selected',
            selectedPages: Array.from({ length: 100 }, (_, i) => i + 1),
            numPages: 200,
        });
        expect(selected).toHaveLength(MAX_SCAN_PAGES);
    });
});

describe('scan gating', () => {
    it('cannot scan before a PDF is loaded', () => {
        const { result } = setup({ file: null });
        expect(result.current.canScan).toBe(false);
    });

    it('does nothing when startScan is called without a PDF', async () => {
        const { result } = setup({ file: null });
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(pdfMocks.loadPdfDocument).not.toHaveBeenCalled();
        expect(callable).not.toHaveBeenCalled();
    });

    it('cannot scan without a company', () => {
        expect(setup({ companyId: '' }).result.current.canScan).toBe(false);
    });
});

describe('hybrid analysis', () => {
    it('sends a scanId and the rendered pages to the callable', async () => {
        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(callable).toHaveBeenCalledTimes(1);
        const payload = callable.mock.calls[0][0];
        expect(payload.companyId).toBe('co-1');
        expect(payload.scanId).toEqual(expect.any(String));
        expect(payload.pages).toEqual([{ pageNumber: 2, imageDataUrl: 'data:image/jpeg;base64,AAA' }]);
    });

    it('skips the vision pass for a page fully described by embedded form widgets', async () => {
        pdfMocks.inspectPdfDocument.mockResolvedValue({
            rawSuggestions: [visionSuggestion({ page: 2, source: 'pdf', origin: 'widget', confidence: 0.97 })],
            manualReview: [],
            pagesWithText: [2],
        });

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(callable).not.toHaveBeenCalled();
        expect(result.current.suggestions).toHaveLength(1);
        expect(result.current.suggestions[0].source).toBe('pdf');
    });

    it('still runs vision on a hybrid page that has a widget AND printed blanks', async () => {
        // One AcroForm widget is not proof the rest of the page is covered: the
        // printed `______` blanks around it still need looking at.
        pdfMocks.inspectPdfDocument.mockResolvedValue({
            rawSuggestions: [
                visionSuggestion({ page: 2, source: 'pdf', origin: 'widget', confidence: 0.97 }),
                visionSuggestion({ page: 2, y: 40, source: 'pdf', origin: 'textRun', confidence: 0.7 }),
            ],
            manualReview: [],
            pagesWithText: [2],
        });

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(callable).toHaveBeenCalledTimes(1);
        expect(result.current.status).toBe('ready');
    });

    it('runs vision on a page with no embedded widgets at all', async () => {
        pdfMocks.inspectPdfDocument.mockResolvedValue({
            rawSuggestions: [visionSuggestion({ page: 2, source: 'pdf', origin: 'textRun', confidence: 0.7 })],
            manualReview: [],
            pagesWithText: [2],
        });

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(callable).toHaveBeenCalledTimes(1);
    });

    it('batches a long page range into several requests', async () => {
        const { result } = setup({ numPages: 7 });
        await act(async () => {
            await result.current.startScan({ scope: 'all' });
        });
        // 7 pages at 3 per request.
        expect(callable).toHaveBeenCalledTimes(3);
    });

    it('discards a suggestion for a page outside the scan', async () => {
        callable.mockResolvedValue({
            data: { suggestions: [visionSuggestion({ page: 3 })], manualReview: [] },
        });
        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.suggestions).toEqual([]);
    });

    it('reports manual-review warnings from both sources', async () => {
        pdfMocks.inspectPdfDocument.mockResolvedValue({
            rawSuggestions: [],
            manualReview: [{ kind: 'radio_group', page: 2, detail: 'Choice group' }],
            pagesWithText: [2],
        });
        callable.mockResolvedValue({
            data: { suggestions: [], manualReview: [{ kind: 'table', page: 2, detail: 'History grid' }] },
        });

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(result.current.manualReview.map((entry) => entry.kind).sort()).toEqual(['radio_group', 'table']);
    });

    it('flags a suggestion overlapping an existing manual field', async () => {
        callable.mockResolvedValue({ data: { suggestions: [visionSuggestion({ page: 2 })], manualReview: [] } });
        const { result } = setup({
            fields: [{ id: 'manual-1', label: 'Kept', page: 2, x: 10, y: 10, width: 25, height: 5 }],
        });
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.suggestions[0].overlapsFieldId).toBe('manual-1');
    });

    it('never marks a suggestion accepted on its own', async () => {
        callable.mockResolvedValue({ data: { suggestions: [visionSuggestion({ page: 2 })], manualReview: [] } });
        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.suggestions.every((item) => item.status === 'pending')).toBe(true);
    });
});

describe('progress, cancellation and staleness', () => {
    it('reports progress and lands on ready', async () => {
        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.status).toBe('ready');
        expect(result.current.progress).toMatchObject({ phase: 'done', completed: 1, total: 1 });
    });

    it('drops the answer to a cancelled scan', async () => {
        let release;
        callable.mockImplementation(
            () =>
                new Promise((resolve) => {
                    release = () => resolve({ data: { suggestions: [visionSuggestion({ page: 2 })], manualReview: [] } });
                }),
        );

        const { result } = setup();
        let scanPromise;
        await act(async () => {
            scanPromise = result.current.startScan({ scope: 'current' });
        });
        await waitFor(() => expect(callable).toHaveBeenCalled());

        act(() => result.current.cancelScan());
        expect(result.current.status).toBe('cancelled');

        await act(async () => {
            release();
            await scanPromise;
        });

        expect(result.current.suggestions).toEqual([]);
        expect(result.current.status).toBe('cancelled');
    });

    it('drops the answer to a superseded scan so a slow reply cannot overwrite a newer one', async () => {
        const pending = [];
        callable.mockImplementation(
            () => new Promise((resolve) => { pending.push(resolve); }),
        );

        const { result } = setup();
        let firstScan;
        await act(async () => {
            firstScan = result.current.startScan({ scope: 'current' });
        });
        await waitFor(() => expect(pending).toHaveLength(1));

        let secondScan;
        await act(async () => {
            secondScan = result.current.startScan({ scope: 'current' });
        });
        await waitFor(() => expect(pending).toHaveLength(2));

        await act(async () => {
            // The FIRST (stale) request answers last, with different content.
            pending[1]({ data: { suggestions: [visionSuggestion({ page: 2, label: 'Newer' })], manualReview: [] } });
            await secondScan;
            pending[0]({
                data: {
                    suggestions: [
                        visionSuggestion({ page: 2, label: 'Stale A' }),
                        visionSuggestion({ page: 2, y: 60, label: 'Stale B' }),
                    ],
                    manualReview: [],
                },
            });
            await firstScan;
        });

        expect(result.current.suggestions.map((item) => item.label)).toEqual(['Newer']);
    });

    it('ignores a response whose scanId does not match the current scan', async () => {
        callable.mockResolvedValue({
            data: {
                scanId: 'some-other-scan',
                suggestions: [visionSuggestion({ page: 2 })],
                manualReview: [],
            },
        });
        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.suggestions).toEqual([]);
    });

    it('clears suggestions when a different PDF is loaded', async () => {
        callable.mockResolvedValue({ data: { suggestions: [visionSuggestion({ page: 2 })], manualReview: [] } });
        const { result, rerender } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.suggestions).toHaveLength(1);

        await act(async () => {
            rerender({ companyId: 'co-1', file: { name: 'other.pdf' }, numPages: 3, activePage: 2, fields: [] });
        });
        expect(result.current.suggestions).toEqual([]);
        expect(result.current.status).toBe('idle');
    });
});

describe('failure handling', () => {
    it.each([
        ['functions/resource-exhausted', /wait a moment/i],
        ['functions/permission-denied', /do not have access/i],
        ['functions/failed-precondition', /not configured/i],
        ['functions/unavailable', /could not reach/i],
    ])('maps %s to an operator-safe message', async (code, expected) => {
        const error = new Error('raw provider detail');
        error.code = code;
        callable.mockRejectedValue(error);

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.error).toMatch(expected);
        expect(result.current.error).not.toContain('raw provider detail');
    });

    it('does not surface raw provider detail for an unmapped failure', async () => {
        callable.mockRejectedValue(new Error('SSN 000-00-0000 leaked'));
        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });
        expect(result.current.error).toBe('The scan could not be completed. Please try again.');
    });

    it('keeps the pages it already analysed when a later batch fails', async () => {
        // Batch 1 succeeds, batch 2 is rejected. Throwing away the first
        // batch's results — which the company has already paid for — would
        // make a partial failure worse than no scan at all.
        const exhausted = new Error('rate limited');
        exhausted.code = 'functions/resource-exhausted';
        callable
            .mockResolvedValueOnce({
                data: { suggestions: [visionSuggestion({ page: 1, label: 'From batch one' })], manualReview: [] },
            })
            .mockRejectedValueOnce(exhausted);

        const { result } = setup({ numPages: 6 });
        await act(async () => {
            await result.current.startScan({ scope: 'all' });
        });

        expect(result.current.status).toBe('error');
        expect(result.current.partial).toBe(true);
        expect(result.current.suggestions.map((item) => item.label)).toEqual(['From batch one']);
    });

    it('does not claim a partial result when nothing was analysed', async () => {
        const error = new Error('down');
        error.code = 'functions/unavailable';
        callable.mockRejectedValue(error);

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(result.current.partial).toBe(false);
        expect(result.current.suggestions).toEqual([]);
    });

    it('reports how many selected pages the cap left out', async () => {
        const { result } = setup({ numPages: MAX_SCAN_PAGES + 5 });
        await act(async () => {
            await result.current.startScan({ scope: 'all' });
        });
        expect(result.current.truncatedPages).toBe(5);
    });

    it('reports no truncation for a scan inside the cap', async () => {
        const { result } = setup({ numPages: 3 });
        await act(async () => {
            await result.current.startScan({ scope: 'all' });
        });
        expect(result.current.truncatedPages).toBe(0);
    });
});

describe('suggestion editing', () => {
    const withOneSuggestion = async () => {
        callable.mockResolvedValue({ data: { suggestions: [visionSuggestion({ page: 2 })], manualReview: [] } });
        const hook = setup();
        await act(async () => {
            await hook.result.current.startScan({ scope: 'current' });
        });
        return hook;
    };

    it('edits label, category, binding and required state', async () => {
        const { result } = await withOneSuggestion();
        const id = result.current.suggestions[0].suggestionId;

        act(() => result.current.updateSuggestion(id, { category: 'email', bindingKey: 'email', label: 'Work email', required: false }));

        expect(result.current.suggestions[0]).toMatchObject({
            category: 'email',
            type: 'text',
            bindingKey: 'email',
            label: 'Work email',
            required: false,
        });
    });

    it('keeps the suggestion id stable across edits', async () => {
        const { result } = await withOneSuggestion();
        const id = result.current.suggestions[0].suggestionId;
        act(() => result.current.updateSuggestion(id, { label: 'Renamed' }));
        expect(result.current.suggestions[0].suggestionId).toBe(id);
    });

    it('rejects an edit that would make the suggestion invalid', async () => {
        const { result } = await withOneSuggestion();
        const id = result.current.suggestions[0].suggestionId;
        act(() => result.current.updateSuggestion(id, { width: 0 }));
        expect(result.current.suggestions[0].width).toBe(25);
    });

    it('moves and resizes within the page', async () => {
        const { result } = await withOneSuggestion();
        const id = result.current.suggestions[0].suggestionId;
        act(() => result.current.updateSuggestion(id, { x: 40, y: 55 }));
        expect(result.current.suggestions[0]).toMatchObject({ x: 40, y: 55 });
    });

    it('marks and unmarks a suggestion as accepted', async () => {
        const { result } = await withOneSuggestion();
        const id = result.current.suggestions[0].suggestionId;
        act(() => result.current.setSuggestionStatus(id, 'accepted'));
        expect(result.current.suggestions[0].status).toBe('accepted');
        act(() => result.current.setSuggestionStatus(id, 'pending'));
        expect(result.current.suggestions[0].status).toBe('pending');
    });

    it('removes rejected suggestions and discards everything on demand', async () => {
        const { result } = await withOneSuggestion();
        const id = result.current.suggestions[0].suggestionId;
        act(() => result.current.removeSuggestions([id]));
        expect(result.current.suggestions).toEqual([]);

        act(() => result.current.discardAll());
        expect(result.current.status).toBe('idle');
        expect(result.current.manualReview).toEqual([]);
    });
});
