/**
 * Turning attached files into something the reader can use.
 *
 * Every dependency is injected, so no test here loads PDF.js, a canvas or the
 * WebAssembly OCR engine. What is pinned is the order — text layer, then OCR,
 * then the pages themselves — and the rule that nothing is required and nothing
 * is silently dropped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-pdf', () => ({ pdfjs: { getDocument: vi.fn() } }));
vi.mock('@features/signing/utils/pdfPageRasterizer', () => ({ renderPageToDataUrl: vi.fn() }));

import { DOCUMENT_FIELD_KINDS, extractDocuments, extractOneDocument } from './documentExtractionPipeline';

const PDF = new File(['%PDF'], 'psp.pdf', { type: 'application/pdf' });
const PHOTO = new File(['x'], 'cdl.jpg', { type: 'image/jpeg' });
const LONG_TEXT = 'Inspection record for ACME TRUCKING USDOT 123456. '.repeat(10);

let deps;

beforeEach(() => {
    deps = {
        extractText: vi.fn().mockResolvedValue({ text: LONG_TEXT, pageCount: 2, pagesWithText: 2, sufficient: true }),
        load: vi.fn().mockResolvedValue({ numPages: 2, destroy: vi.fn() }),
        renderPage: vi.fn(async (_doc, page) => `data:image/jpeg;base64,p${page}`),
        readImage: vi.fn().mockResolvedValue('data:image/jpeg;base64,photo'),
        recognize: vi.fn().mockResolvedValue({ text: LONG_TEXT, pages: 1 }),
    };
});

describe('one document at a time', () => {
    it("uses a PDF's own text layer, and does not render or recognise anything", async () => {
        const result = await extractOneDocument({ kind: 'psp', file: PDF }, deps);

        expect(result).toMatchObject({ kind: 'psp', method: 'text' });
        expect(result.text).toContain('ACME TRUCKING');
        expect(deps.renderPage).not.toHaveBeenCalled();
        expect(deps.recognize).not.toHaveBeenCalled();
    });

    it('falls back to recognising the rendered pages when there is no text layer', async () => {
        deps.extractText.mockResolvedValue({ text: '', pageCount: 3, pagesWithText: 0, sufficient: false });

        const result = await extractOneDocument({ kind: 'mvr', file: PDF }, deps);

        expect(result.method).toBe('ocr');
        expect(deps.recognize).toHaveBeenCalledWith(
            ['data:image/jpeg;base64,p1', 'data:image/jpeg;base64,p2'], deps,
        );
    });

    it('recognises a photograph without looking for a text layer first', async () => {
        const result = await extractOneDocument({ kind: 'cdl', file: PHOTO }, deps);

        expect(result.method).toBe('ocr');
        expect(deps.extractText).not.toHaveBeenCalled();
        expect(deps.readImage).toHaveBeenCalledWith(PHOTO);
    });

    it('reads a photo through the built-in reader when none is injected (the production path)', async () => {
        // The panel calls the pipeline with NO `readImage` in deps. If the default
        // is missing, `readImage(file)` throws and every photo is reported `failed`
        // while PDFs work — the exact bug that made a CDL photo unreadable. Injecting
        // only `recognize` here forces the REAL default image reader to run.
        const noReader = { recognize: vi.fn().mockResolvedValue({ text: LONG_TEXT, pages: 1 }) };

        const result = await extractOneDocument({ kind: 'cdl', file: PHOTO }, noReader);

        expect(result.method).toBe('ocr');
        expect(noReader.recognize).toHaveBeenCalled();
        // What it recognised is a real data URL the default reader produced.
        expect(noReader.recognize.mock.calls[0][0][0]).toMatch(/^data:/);
    });

    it('hands the pages on when recognition comes back too thin to trust', async () => {
        deps.recognize.mockResolvedValue({ text: 'sm ll', pages: 1 });

        const result = await extractOneDocument({ kind: 'cdl', file: PHOTO }, deps);

        // Not a failure: a model that reads images for a living gets a turn.
        expect(result.method).toBe('pages');
        expect(result.pages).toEqual(['data:image/jpeg;base64,photo']);
    });

    it('hands the pages on when recognition throws outright', async () => {
        deps.recognize.mockRejectedValue(new Error('wasm refused to load'));

        const result = await extractOneDocument({ kind: 'cdl', file: PHOTO }, deps);
        expect(result.method).toBe('pages');
    });

    it('renders a PDF whose text layer throws, rather than giving up on it', async () => {
        deps.extractText.mockRejectedValue(new Error('corrupt xref'));

        const result = await extractOneDocument({ kind: 'psp', file: PDF }, deps);
        expect(result.method).toBe('ocr');
    });

    it('refuses a file that is neither a PDF nor a photo, and says why', async () => {
        const result = await extractOneDocument(
            { kind: 'psp', file: new File(['x'], 'notes.txt', { type: 'text/plain' }) }, deps,
        );

        expect(result.method).toBe('failed');
        expect(result.reason).toMatch(/PDF, JPG, PNG or WebP/);
    });

    it('reports a file that cannot be opened at all', async () => {
        deps.load.mockRejectedValue(new Error('not a pdf'));
        deps.extractText.mockRejectedValue(new Error('not a pdf'));

        const result = await extractOneDocument({ kind: 'psp', file: PDF }, deps);
        expect(result.method).toBe('failed');
        expect(result.reason).toMatch(/could not be opened/);
    });
});

describe('everything the carrier attached', () => {
    it('reads a single document as readily as several', async () => {
        const result = await extractDocuments([{ kind: 'psp', file: PDF }], deps);

        expect(Object.keys(result.documents)).toEqual(['psp']);
        expect(result.documents.psp.text).toContain('ACME TRUCKING');
        expect(result.methods).toEqual({ psp: 'text' });
    });

    it('mixes routes across documents in one pass', async () => {
        deps.extractText
            .mockResolvedValueOnce({ text: LONG_TEXT, pageCount: 2, pagesWithText: 2, sufficient: true });
        deps.recognize.mockResolvedValue({ text: 'too short', pages: 1 });

        const result = await extractDocuments([
            { kind: 'psp', file: PDF },
            { kind: 'cdl', file: PHOTO },
        ], deps);

        expect(result.methods).toEqual({ psp: 'text', cdl: 'pages' });
        expect(result.documents.psp.text).toBeTruthy();
        expect(result.documents.cdl.pages).toHaveLength(1);
    });

    it('joins two files of one kind rather than letting one replace the other', async () => {
        const result = await extractDocuments([
            { kind: 'cdl', file: PDF },
            { kind: 'cdl', file: PDF },
        ], deps);

        expect(result.documents.cdl.text.split('ACME TRUCKING').length - 1).toBeGreaterThan(10);
    });

    it('keeps going when one document fails, and names the one that did', async () => {
        const result = await extractDocuments([
            { kind: 'psp', file: PDF },
            { kind: 'medical', file: new File(['x'], 'card.txt', { type: 'text/plain' }) },
        ], deps);

        expect(result.documents.psp).toBeTruthy();
        expect(result.documents.medical).toBeUndefined();
        expect(result.failures.medical).toMatch(/PDF, JPG, PNG or WebP/);
    });

    it('ignores empty slots instead of treating them as documents', async () => {
        const result = await extractDocuments([
            { kind: 'psp', file: PDF },
            { kind: 'mvr', file: null },
            null,
        ], deps);

        expect(Object.keys(result.documents)).toEqual(['psp']);
        expect(result.methods.mvr).toBeUndefined();
    });

    it('maps every upload field to the document the reader knows', () => {
        expect(DOCUMENT_FIELD_KINDS).toEqual({
            'cdl-front': 'cdl',
            'cdl-back': 'cdl',
            'medical-card-upload': 'medical',
            'psp-report-upload': 'psp',
            'mvr-upload': 'mvr',
        });
    });
});
