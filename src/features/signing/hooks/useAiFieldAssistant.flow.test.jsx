// AI Field Assistant scan orchestration, part 2 of 2: progress, cancellation,
// stale-response rejection, failure handling, and suggestion editing.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `useAiFieldAssistant.support.js`; the registrations below delegate to it.
// The AI provider is never reached; every page, field and label is artificial.
import React from 'react';
import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/functions', async () => (await import('./useAiFieldAssistant.support')).firebaseFunctionsMock());
vi.mock('@features/signing/utils/pdfPageRasterizer', async () => (await import('./useAiFieldAssistant.support')).pdfPageRasterizerMock());
vi.mock('@features/signing/utils/pdfFieldInspector', async (importOriginal) => (await import('./useAiFieldAssistant.support')).pdfFieldInspectorMock(importOriginal));

import { MAX_SCAN_PAGES, useAiFieldAssistant } from './useAiFieldAssistant';
import {
    makeSetup,
    resetHarness,
    callable,
    visionSuggestion,
} from './useAiFieldAssistant.support';

const setup = makeSetup(useAiFieldAssistant);

beforeEach(resetHarness);

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

    /**
     * Two different faults share `failed-precondition`, and telling a recruiter
     * to configure something that is already configured sends them somewhere
     * they cannot help. The server names which it was in `details.category`; a
     * category is the only failure information SafeHaul treats as safe to cross
     * a trust boundary, so it carries no provider, credential or document detail.
     */
    it('distinguishes an unreadable credential from an unconfigured server', async () => {
        const error = new Error('raw provider detail');
        error.code = 'functions/failed-precondition';
        error.details = { category: 'credential_error' };
        callable.mockRejectedValue(error);

        const { result } = setup();
        await act(async () => {
            await result.current.startScan({ scope: 'current' });
        });

        expect(result.current.error).toMatch(/temporarily unavailable/i);
        expect(result.current.error).toMatch(/place fields manually/i);
        // The misleading sentence must not be the one shown.
        expect(result.current.error).not.toMatch(/not configured/i);
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
