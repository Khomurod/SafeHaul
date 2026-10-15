/**
 * The document reader (pdf.js, the page rasterizer, OCR) loads when a read
 * starts, not with the Unfinished applications page: most visits read nothing.
 *
 * All names and paths below are artificial.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fx = vi.hoisted(() => ({ loaded: false, extract: vi.fn(), call: vi.fn() }));

vi.mock('./extraction/documentExtractionPipeline', () => {
    fx.loaded = true;
    return { extractDocuments: fx.extract };
});
vi.mock('firebase/functions', () => ({ httpsCallable: () => fx.call }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { ApplicationAiPrepPanel } from './ApplicationAiPrepPanel';

describe('the document reader', () => {
    it('loads when a read starts', async () => {
        fx.extract.mockResolvedValue({ documents: { psp: { text: 'PSP body' } }, methods: { psp: 'text' }, failures: {} });
        fx.call.mockResolvedValue({ data: { success: true, extracted: { carriers: [], violations: [], unreadable: [] }, methods: { psp: 'text' } } });
        render(
            <ApplicationAiPrepPanel
                companyId="co-1"
                files={{ 'psp-report-upload': { name: 'psp.pdf', storagePath: 'companies/co-1/applications/psp.pdf' } }}
                blobs={{ 'psp-report-upload': new File(['%PDF-1.4'], 'psp.pdf', { type: 'application/pdf' }) }}
                applicantKey="key-1"
                onApplyExtraction={vi.fn(() => ({ formData: {}, filled: [], kept: [] }))}
                onBusyChange={vi.fn()}
            />,
        );

        expect(screen.getByTestId('read-documents')).toHaveTextContent('Read 1 document');
        expect(fx.loaded).toBe(false);

        fireEvent.click(screen.getByTestId('read-documents'));

        await waitFor(() => expect(fx.call).toHaveBeenCalled());
        expect(fx.loaded).toBe(true);
        expect(fx.extract).toHaveBeenCalled();
    });
});
