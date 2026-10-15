// The VOE preview loads html2canvas and jsPDF when Download PDF is pressed, not
// when the Previous Employment tab or the preview opens: the two make up most
// of that tab's download. The shared harness lives in
// `VOEPreviewModal.contract.support.jsx`.
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

const fx = vi.hoisted(() => ({ loaded: [] }));

vi.mock('@/context/DataContext', async () => (await import('./VOEPreviewModal.contract.support')).dataContextMock());
vi.mock('@shared/utils/sanitizeUserContent', async (importOriginal) => (await import('./VOEPreviewModal.contract.support')).sanitizeUserContentMock(importOriginal));
vi.mock('html2canvas', async () => {
    fx.loaded.push('html2canvas');
    return (await import('./VOEPreviewModal.contract.support')).html2canvasMock();
});
vi.mock('jspdf', async () => {
    fx.loaded.push('jspdf');
    return (await import('./VOEPreviewModal.contract.support')).jspdfMock();
});

import { VOEPreviewModal } from './VOEPreviewModal';
import { h2cMock, makeRenderModal, pdfMock, resetHarness } from './VOEPreviewModal.contract.support';

const renderModal = makeRenderModal(VOEPreviewModal);

beforeEach(() => {
    resetHarness();
    h2cMock.fn.mockResolvedValue({ width: 816, height: 1056, toDataURL: () => 'data:image/png;base64,PDFIMAGE' });
});
afterEach(cleanup);

describe('the VOE preview’s PDF tooling', () => {
    it('is not loaded by opening the preview', () => {
        renderModal();

        expect(screen.getByRole('button', { name: /Download PDF/i })).toBeInTheDocument();
        expect(fx.loaded).toEqual([]);
    });

    it('is loaded by Download PDF, which then saves the file', async () => {
        renderModal();
        fireEvent.click(screen.getByRole('button', { name: /Download PDF/i }));

        await waitFor(() => expect(pdfMock.save).toHaveBeenCalled());
        expect([...fx.loaded].sort()).toEqual(['html2canvas', 'jspdf']);
    });
});
