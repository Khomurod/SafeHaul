// AI Field Assistant scan orchestration, part 1 of 2: scope resolution, the
// scan gates, and hybrid text/vision precedence.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `useAiFieldAssistant.support.js`; the registrations below delegate to it.
// The AI provider is never reached; every page, field and label is artificial.
import React from 'react';
import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./useAiFieldAssistant.support')).firebaseFunctionsMock());
vi.mock('@features/signing/utils/pdfPageRasterizer', async () => (await import('./useAiFieldAssistant.support')).pdfPageRasterizerMock());
vi.mock('@features/signing/utils/pdfFieldInspector', async (importOriginal) => (await import('./useAiFieldAssistant.support')).pdfFieldInspectorMock(importOriginal));

import { MAX_SCAN_PAGES, resolveScanPages, useAiFieldAssistant } from './useAiFieldAssistant';
import {
    makeSetup,
    resetHarness,
    callable,
    pdfMocks,
    visionSuggestion,
} from './useAiFieldAssistant.support';

const setup = makeSetup(useAiFieldAssistant);

beforeEach(resetHarness);

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

