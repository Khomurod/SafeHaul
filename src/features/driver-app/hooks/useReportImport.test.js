import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callableMocks = vi.hoisted(() => ({
    extract: vi.fn(),
    httpsCallable: vi.fn(),
}));
const rasterMocks = vi.hoisted(() => ({
    loadPdfDocument: vi.fn(),
    renderPageToDataUrl: vi.fn(),
}));

vi.mock('firebase/functions', () => ({ httpsCallable: callableMocks.httpsCallable }));
vi.mock('@lib/firebase', () => ({ functions: {} }));
vi.mock('@features/signing/utils/pdfPageRasterizer', () => ({
    loadPdfDocument: rasterMocks.loadPdfDocument,
    renderPageToDataUrl: rasterMocks.renderPageToDataUrl,
}));

import { REPORT_MAX_PAGES, REPORT_MAX_PAGE_CHARS, fileToPageImages, useReportImport } from './useReportImport';

const PNG = new File(['x'], 'record.png', { type: 'image/png' });

function fakePdf(numPages) {
    return { numPages, destroy: vi.fn().mockResolvedValue(undefined) };
}

describe('fileToPageImages', () => {
    it('renders a PDF page by page, up to the callable ceiling, and destroys the document', async () => {
        const document = fakePdf(8);
        const loadPdf = vi.fn().mockResolvedValue(document);
        const renderPage = vi.fn().mockImplementation((_doc, n) => Promise.resolve(`data:image/jpeg;base64,p${n}`));
        const file = new File(['%PDF'], 'psp.pdf', { type: 'application/pdf' });

        const result = await fileToPageImages(file, { loadPdf, renderPage });

        expect(result.totalPages).toBe(8);
        expect(result.pages).toHaveLength(REPORT_MAX_PAGES);
        expect(result.pages[0]).toBe('data:image/jpeg;base64,p1');
        expect(renderPage).toHaveBeenCalledTimes(REPORT_MAX_PAGES);
        expect(document.destroy).toHaveBeenCalled();
    });

    it('destroys the document even when rendering fails', async () => {
        const document = fakePdf(2);
        const loadPdf = vi.fn().mockResolvedValue(document);
        const renderPage = vi.fn().mockRejectedValue(new Error('canvas'));
        await expect(fileToPageImages(new File([''], 'x.pdf', { type: 'application/pdf' }), { loadPdf, renderPage })).rejects.toThrow('canvas');
        expect(document.destroy).toHaveBeenCalled();
    });

    it('refuses a PDF with no renderable page', async () => {
        const loadPdf = vi.fn().mockResolvedValue(fakePdf(1));
        const renderPage = vi.fn().mockResolvedValue(null);
        await expect(fileToPageImages(new File([''], 'x.pdf', { type: 'application/pdf' }), { loadPdf, renderPage })).rejects.toThrow(/Could not read any pages/);
    });

    it('re-encodes a photo the way PDF pages are rendered, and sends that', async () => {
        const compressImage = vi.fn().mockResolvedValue('data:image/jpeg;base64,SMALL');
        const readImage = vi.fn().mockResolvedValue('data:image/png;base64,RAW');
        await expect(fileToPageImages(PNG, { compressImage, readImage })).resolves.toEqual({ pages: ['data:image/jpeg;base64,SMALL'], totalPages: 1 });
        expect(readImage).not.toHaveBeenCalled();
    });

    it('falls back to the raw photo where re-encoding is unavailable', async () => {
        const compressImage = vi.fn().mockResolvedValue(null);
        const readImage = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
        await expect(fileToPageImages(PNG, { compressImage, readImage })).resolves.toEqual({ pages: ['data:image/png;base64,AAAA'], totalPages: 1 });
    });

    it('refuses a page the callable would refuse, instead of sending it to fail', async () => {
        // The server caps one page at MAX_IMAGE_CHARS of data URL; a 5 MB phone
        // photo passes the 15 MB file check and is a certain server rejection.
        const oversized = 'data:image/png;base64,' + 'A'.repeat(REPORT_MAX_PAGE_CHARS);
        const compressImage = vi.fn().mockResolvedValue(null);
        const readImage = vi.fn().mockResolvedValue(oversized);
        await expect(fileToPageImages(PNG, { compressImage, readImage })).rejects.toThrow(/too large to read/);

        const loadPdf = vi.fn().mockResolvedValue(fakePdf(1));
        const renderPage = vi.fn().mockResolvedValue(oversized);
        await expect(fileToPageImages(new File([''], 'x.pdf', { type: 'application/pdf' }), { loadPdf, renderPage })).rejects.toThrow(/too large to read/);
    });

    it('refuses other types and oversized files with a message the applicant can act on', async () => {
        await expect(fileToPageImages(new File(['x'], 'notes.txt', { type: 'text/plain' }))).rejects.toThrow(/PDF or a photo/);
        const big = new File(['x'], 'big.png', { type: 'image/png' });
        Object.defineProperty(big, 'size', { value: 16 * 1024 * 1024 });
        await expect(fileToPageImages(big)).rejects.toThrow(/too large/);
        await expect(fileToPageImages(null)).rejects.toThrow(/Choose a file/);
    });
});

describe('useReportImport', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        callableMocks.httpsCallable.mockReturnValue(callableMocks.extract);
        callableMocks.extract.mockResolvedValue({ data: { success: true, suggestions: { carriers: [{ name: 'Acme' }], violations: [] } } });
    });

    it('sends the pages to extractApplicationReport for the company and kind, then holds the suggestions', async () => {
        const { result } = renderHook(() => useReportImport({ companyId: 'co-1', kind: 'psp' }));
        expect(result.current.status).toBe('idle');

        await act(async () => { await result.current.importFile(PNG); });

        expect(callableMocks.httpsCallable).toHaveBeenCalledWith({}, 'extractApplicationReport', { timeout: 60000 });
        const payload = callableMocks.extract.mock.calls[0][0];
        expect(payload.companyId).toBe('co-1');
        expect(payload.kind).toBe('psp');
        expect(payload.pages).toHaveLength(1);
        expect(payload.pages[0]).toMatch(/^data:image\/png;base64,/);
        expect(result.current.status).toBe('ready');
        expect(result.current.suggestions).toEqual({ carriers: [{ name: 'Acme' }], violations: [] });
        expect(result.current.skippedPages).toBe(0);
    });

    it('surfaces the callable message as an error state and never throws', async () => {
        callableMocks.extract.mockRejectedValue(new Error('This carrier has not enabled report import.'));
        const { result } = renderHook(() => useReportImport({ companyId: 'co-1', kind: 'mvr' }));
        await act(async () => { await result.current.importFile(PNG); });
        expect(result.current.status).toBe('error');
        expect(result.current.error).toBe('This carrier has not enabled report import.');
        expect(result.current.suggestions).toBeNull();
    });

    it('refuses to call without a company', async () => {
        const { result } = renderHook(() => useReportImport({ companyId: undefined, kind: 'mvr' }));
        await act(async () => { await result.current.importFile(PNG); });
        expect(callableMocks.extract).not.toHaveBeenCalled();
        expect(result.current.status).toBe('error');
    });

    it('drops a result that a newer request or a reset has superseded', async () => {
        let resolveFirst;
        callableMocks.extract.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
        const { result } = renderHook(() => useReportImport({ companyId: 'co-1', kind: 'psp' }));

        let first;
        act(() => { first = result.current.importFile(PNG); });
        // The file is read asynchronously before the callable is reached; wait
        // until the request is actually in flight before superseding it.
        await waitFor(() => expect(callableMocks.extract).toHaveBeenCalled());
        expect(result.current.status).toBe('reading');
        act(() => result.current.reset());
        expect(result.current.status).toBe('idle');

        await act(async () => {
            resolveFirst({ data: { suggestions: { carriers: [{ name: 'Stale' }], violations: [] } } });
            await first;
        });
        expect(result.current.status).toBe('idle');
        expect(result.current.suggestions).toBeNull();
    });
});
