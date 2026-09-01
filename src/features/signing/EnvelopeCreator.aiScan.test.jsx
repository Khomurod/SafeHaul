// AI Field Assistant, part 1 of 2: the launcher's disabled state, the scan
// dialog and its disclosure, and the review rail.
// The shared harness — mock state, factories, fixtures and helpers — lives in
// `EnvelopeCreator.aiAssistant.support.jsx`; the registrations below delegate
// to it. The AI provider is never reached; every field and page is artificial.
import React from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@lib/firebase', async () => (await import('./EnvelopeCreator.aiAssistant.support')).libFirebaseMock());
vi.mock('firebase/firestore', async () => (await import('./EnvelopeCreator.aiAssistant.support')).firebaseFirestoreMock());
vi.mock('firebase/storage', async () => (await import('./EnvelopeCreator.aiAssistant.support')).firebaseStorageMock());
vi.mock('firebase/functions', async () => (await import('./EnvelopeCreator.aiAssistant.support')).firebaseFunctionsMock());
vi.mock('uuid', async () => (await import('./EnvelopeCreator.aiAssistant.support')).uuidMock());
vi.mock('@shared/components/feedback', async () => (await import('./EnvelopeCreator.aiAssistant.support')).feedbackMock());
vi.mock('@features/signing/utils/pdfPageRasterizer', async () => (await import('./EnvelopeCreator.aiAssistant.support')).pdfPageRasterizerMock());
vi.mock('@features/signing/utils/pdfFieldInspector', async (importOriginal) => (await import('./EnvelopeCreator.aiAssistant.support')).pdfFieldInspectorMock(importOriginal));
vi.mock('./components/envelope-creator/PageThumbnailRail', async () => (await import('./EnvelopeCreator.aiAssistant.support')).pageThumbnailRailMock());
vi.mock('./components/envelope-creator/PdfFieldWorkbench', async () => (await import('./EnvelopeCreator.aiAssistant.support')).pdfFieldWorkbenchMock());

import EnvelopeCreator from './EnvelopeCreator';
import {
    makeRenderCreator,
    resetHarness,
    loadPdf,
    runScan,
    callable,
    workbenchProps,
} from './EnvelopeCreator.aiAssistant.support';

const renderCreator = makeRenderCreator(EnvelopeCreator);

beforeEach(resetHarness);

describe('launcher', () => {
    it('is disabled until a PDF is loaded, and says why', () => {
        renderCreator();
        const launcher = screen.getByRole('button', { name: /Auto-place fields/ });
        expect(launcher).toBeDisabled();
        expect(screen.getByText(/Upload a PDF to use the AI Field Assistant/)).toBeInTheDocument();
    });

    it('states what the assistant does once a PDF is loaded', async () => {
        renderCreator();
        await loadPdf();
        expect(
            screen.getByText(
                'AI will scan your PDF and suggest signature, initials, dates, checkboxes and text fields. Review all suggestions before applying them.',
            ),
        ).toBeInTheDocument();
    });

    it('never scans without an explicit start', async () => {
        renderCreator();
        await loadPdf();
        expect(callable).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));
        await screen.findByRole('dialog');
        expect(callable).not.toHaveBeenCalled();
    });
});

describe('scan dialog', () => {
    it('discloses that page images are sent to the AI provider', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByText(/sent to the configured AI provider/i)).toBeInTheDocument();
        expect(within(dialog).getByText(/not stored after the scan/i)).toBeInTheDocument();
    });

    it('offers current page, selected pages and all pages', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        expect(within(dialog).getByRole('radio', { name: /Current page/ })).toBeChecked();
        expect(within(dialog).getByRole('radio', { name: 'Selected pages' })).toBeInTheDocument();
        expect(within(dialog).getByRole('radio', { name: /All pages/ })).toBeInTheDocument();
    });

    it('blocks the scan until a valid page range is typed', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('radio', { name: 'Selected pages' }));
        expect(within(dialog).getByRole('button', { name: 'Scan pages' })).toBeDisabled();

        fireEvent.change(within(dialog).getByLabelText('Page numbers'), { target: { value: '1-2' } });
        expect(within(dialog).getByRole('button', { name: 'Scan pages' })).toBeEnabled();
    });

    it('closes without scanning on Cancel', async () => {
        renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));

        const dialog = await screen.findByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(callable).not.toHaveBeenCalled();
    });

    it('has no serious accessibility violations', async () => {
        const { container } = renderCreator();
        await loadPdf();
        fireEvent.click(screen.getByRole('button', { name: /Auto-place fields/ }));
        await screen.findByRole('dialog');

        const results = await axe(container);
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    });
});

describe('review rail', () => {
    it('shows suggestions separately from placed fields and never auto-accepts them', async () => {
        renderCreator();
        await loadPdf();
        await runScan();

        expect(await screen.findByRole('checkbox', { name: 'Apply Sign here' })).not.toBeChecked();
        expect(screen.getByText(/Suggestions are not part of your document until you apply them\./)).toBeInTheDocument();
        // The editor's own field list is still empty.
        expect(screen.queryByText(/^Placed \(/)).not.toBeInTheDocument();
    });

    it('hands the suggestion layer to the workbench, not the fields array', async () => {
        renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        const latest = workbenchProps[workbenchProps.length - 1];
        expect(latest.fields).toEqual([]);
        expect(latest.aiSuggestions).toHaveLength(1);
        expect(latest.aiSuggestions[0]).toMatchObject({ type: 'signature', page: 1 });
    });

    it('warns about a structure that cannot be represented', async () => {
        callable.mockResolvedValue({
            data: {
                suggestions: [],
                manualReview: [{ kind: 'radio_group', page: 1, detail: 'Marital status' }],
            },
        });
        renderCreator();
        await loadPdf();
        await runScan();

        expect(await screen.findByText(/Marital status/)).toBeInTheDocument();
        expect(screen.getByText(/mutually exclusive group/i)).toBeInTheDocument();
    });

    it('surfaces a scan failure with a retry, without provider detail', async () => {
        const error = new Error('groq said 123 Main St');
        error.code = 'functions/unavailable';
        callable.mockRejectedValue(error);

        renderCreator();
        await loadPdf();
        await runScan();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/could not reach the AI service/i);
        expect(alert).not.toHaveTextContent('123 Main St');
        expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();
    });

    it('has no serious accessibility violations while reviewing', async () => {
        const { container } = renderCreator();
        await loadPdf();
        await runScan();
        await screen.findByRole('checkbox', { name: 'Apply Sign here' });

        const results = await axe(container);
        expect(results.violations.filter((v) => ['serious', 'critical'].includes(v.impact))).toEqual([]);
    });
});

