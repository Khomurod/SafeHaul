/**
 * A PDF's own text layer, and the judgement about whether it is worth using.
 *
 * The threshold is the whole point of the file: below it the document goes to
 * OCR, and getting it wrong in the generous direction silently loses a document
 * while getting it wrong in the cautious direction costs a few seconds.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-pdf', () => ({ pdfjs: { getDocument: vi.fn() } }));

import { MIN_CHARS_PER_DOCUMENT, extractPdfText } from './pdfTextLayer';

const REAL_PAGE = 'Inspection record for ACME TRUCKING USDOT 123456 dated 2024-03-12. '.repeat(4);

let deps;

beforeEach(() => {
    deps = {
        load: vi.fn().mockResolvedValue({ numPages: 2, destroy: vi.fn() }),
        pageText: vi.fn().mockResolvedValue(REAL_PAGE),
    };
});

describe('reading the text layer', () => {
    it('joins every page and calls a generated document sufficient', async () => {
        const result = await extractPdfText({}, deps);

        expect(deps.pageText).toHaveBeenCalledTimes(2);
        expect(result.pageCount).toBe(2);
        expect(result.pagesWithText).toBe(2);
        expect(result.sufficient).toBe(true);
        expect(result.text.length).toBeGreaterThan(MIN_CHARS_PER_DOCUMENT);
    });

    it('calls a scan insufficient rather than sending a page of nothing', async () => {
        deps.pageText.mockResolvedValue('');

        const result = await extractPdfText({}, deps);
        expect(result.sufficient).toBe(false);
        expect(result.pagesWithText).toBe(0);
    });

    it('refuses a long document whose pages each hold a stray word', async () => {
        // A scan with a real-text headline per page: enough characters in total,
        // no page anyone could read.
        deps.load.mockResolvedValue({ numPages: 40, destroy: vi.fn() });
        deps.pageText.mockResolvedValue('Page 3');

        const result = await extractPdfText({}, deps);
        expect(result.sufficient).toBe(false);
    });

    it('refuses a one-page document with a line of text on it', async () => {
        deps.load.mockResolvedValue({ numPages: 1, destroy: vi.fn() });
        deps.pageText.mockResolvedValue('MEDICAL EXAMINER CERTIFICATE');

        const result = await extractPdfText({}, deps);
        expect(result.sufficient).toBe(false);
    });

    it('destroys the document whatever happens', async () => {
        const document = { numPages: 1, destroy: vi.fn() };
        deps.load.mockResolvedValue(document);
        deps.pageText.mockRejectedValue(new Error('corrupt page'));

        await expect(extractPdfText({}, deps)).rejects.toThrow('corrupt page');
        expect(document.destroy).toHaveBeenCalled();
    });
});
