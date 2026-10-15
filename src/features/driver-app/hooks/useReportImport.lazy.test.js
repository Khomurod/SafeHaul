/**
 * pdf.js is about 116 KB gzipped. Every driver opens the application page and few
 * import a report, so the page must not fetch it until a report PDF is chosen; a
 * photo of a report needs no pdf.js at all.
 */
import { describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ rasterizer: 0 }));

vi.mock('@features/signing/utils/pdfPageRasterizer', () => {
    loaded.rasterizer += 1;
    return {
        loadPdfDocument: vi.fn(async () => ({ numPages: 1, destroy: vi.fn() })),
        renderPageToDataUrl: vi.fn(async () => 'data:image/jpeg;base64,PAGE'),
        compressImageFile: vi.fn(async () => 'data:image/jpeg;base64,PHOTO'),
    };
});
vi.mock('@features/signing/utils/imageCompression', () => ({
    compressImageFile: vi.fn(async () => 'data:image/jpeg;base64,PHOTO'),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));
vi.mock('@lib/firebase', () => ({ functions: {} }));

import { fileToPageImages } from './useReportImport';

describe('pdf.js only when a report PDF is chosen', () => {
    it('is not fetched with the application, nor for a photo of a report', async () => {
        expect(loaded.rasterizer).toBe(0);

        await expect(fileToPageImages(new File(['x'], 'record.png', { type: 'image/png' })))
            .resolves.toEqual({ pages: ['data:image/jpeg;base64,PHOTO'], totalPages: 1 });
        expect(loaded.rasterizer).toBe(0);
    });

    it('is fetched for a PDF, and reads it', async () => {
        await expect(fileToPageImages(new File(['%PDF'], 'psp.pdf', { type: 'application/pdf' })))
            .resolves.toEqual({ pages: ['data:image/jpeg;base64,PAGE'], totalPages: 1 });
        expect(loaded.rasterizer).toBe(1);
    });
});
