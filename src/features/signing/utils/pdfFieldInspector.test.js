// Deterministic PDF inspection for the AI Field Assistant. The PDF.js document
// is a hand-built stub; no real PDF, template or recipient data is used.
import { describe, expect, it, vi } from 'vitest';
import {
    annotationToSuggestion,
    blankRunsFromTextItems,
    categoryFromLabel,
    inspectPdfDocument,
    rectToPercent,
} from './pdfFieldInspector';

// US Letter at 72dpi, origin at (0, 0).
const VIEW = [0, 0, 612, 792];
const GEOMETRY = { pageNumber: 1, view: VIEW };

describe('categoryFromLabel', () => {
    it('recognises the supported semantic labels', () => {
        expect(categoryFromLabel('Signature')).toBe('signature');
        expect(categoryFromLabel('Driver Initials')).toBe('initials');
        expect(categoryFromLabel('First Name')).toBe('first_name');
        expect(categoryFromLabel('Last Name')).toBe('last_name');
        expect(categoryFromLabel('Printed Name')).toBe('full_name');
        expect(categoryFromLabel('E-mail address')).toBe('email');
        expect(categoryFromLabel('Cell Phone')).toBe('phone');
        expect(categoryFromLabel('ZIP')).toBe('zip');
        expect(categoryFromLabel('City')).toBe('city');
        expect(categoryFromLabel('State')).toBe('state');
        expect(categoryFromLabel('Street Address')).toBe('address');
        expect(categoryFromLabel('Employer')).toBe('company');
        expect(categoryFromLabel('Date')).toBe('date');
    });

    it('prefers the more specific rule when labels overlap', () => {
        expect(categoryFromLabel('First Name')).not.toBe('full_name');
        expect(categoryFromLabel('Business Name')).toBe('company');
    });

    it('never binds a date of birth to the signing date', () => {
        expect(categoryFromLabel('Date of Birth')).toBe('text');
        expect(categoryFromLabel('DOB')).toBe('text');
    });

    it('falls back to a plain text blank', () => {
        expect(categoryFromLabel('Trailer number')).toBe('text');
        expect(categoryFromLabel('')).toBe('text');
        expect(categoryFromLabel(undefined)).toBe('text');
    });
});

describe('rectToPercent', () => {
    it('converts bottom-left PDF space to top-left percentages', () => {
        // A box spanning the top-left quarter of the page.
        const rect = rectToPercent([0, 396, 306, 792], VIEW);
        expect(rect).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    });

    it('tolerates a reversed rectangle', () => {
        expect(rectToPercent([306, 792, 0, 396], VIEW)).toEqual({ x: 0, y: 0, width: 50, height: 50 });
    });

    it('honours a non-zero page origin', () => {
        expect(rectToPercent([100, 100, 200, 200], [100, 100, 200, 200])).toEqual({
            x: 0,
            y: 0,
            width: 100,
            height: 100,
        });
    });

    it('returns null for unusable input', () => {
        expect(rectToPercent(null, VIEW)).toBeNull();
        expect(rectToPercent([0, 0, 10, 10], null)).toBeNull();
        expect(rectToPercent([0, 0, 10, 10], [0, 0, 0, 0])).toBeNull();
        expect(rectToPercent(['a', 0, 10, 10], VIEW)).toBeNull();
    });

    it('measures a rotated page on the axes it is displayed on', () => {
        // A /Rotate 90 page: PDF.js hands back a viewport whose width/height are
        // swapped and whose convertToViewportRectangle already applies the
        // rotation. Measuring against the unrotated `view` would put the box on
        // the wrong axis entirely.
        const rotatedViewport = {
            width: 792,
            height: 612,
            // Landscape viewport: the PDF-space rect [50,500,250,540] lands in
            // the upper-left quadrant once rotated.
            convertToViewportRectangle: () => [252, 50, 292, 250],
        };
        const rect = rectToPercent([50, 500, 250, 540], VIEW, rotatedViewport);
        expect(rect.x).toBeCloseTo((252 / 792) * 100, 5);
        expect(rect.y).toBeCloseTo((50 / 612) * 100, 5);
        expect(rect.width).toBeCloseTo((40 / 792) * 100, 5);
        expect(rect.height).toBeCloseTo((200 / 612) * 100, 5);
    });

    it('normalises a viewport rectangle given in either corner order', () => {
        const viewport = {
            width: 100,
            height: 200,
            convertToViewportRectangle: () => [60, 120, 20, 40],
        };
        expect(rectToPercent([0, 0, 1, 1], VIEW, viewport)).toEqual({
            x: 20,
            y: 20,
            width: 40,
            height: 40,
        });
    });

    it('falls back to the unrotated view when the viewport is unusable', () => {
        const broken = { width: 0, height: 0, convertToViewportRectangle: () => [1, 2, 3, 4] };
        expect(rectToPercent([0, 396, 306, 792], VIEW, broken)).toEqual({
            x: 0,
            y: 0,
            width: 50,
            height: 50,
        });
        expect(rectToPercent([0, 396, 306, 792], VIEW, {})).toEqual({
            x: 0,
            y: 0,
            width: 50,
            height: 50,
        });
    });

    it('is independent of the pixel size the page is rendered at', () => {
        // The same PDF rectangle, whatever zoom the editor happens to use.
        const atOneScale = rectToPercent([50, 500, 250, 540], VIEW);
        const atAnotherScale = rectToPercent([50, 500, 250, 540], VIEW);
        expect(atOneScale).toEqual(atAnotherScale);
    });
});

describe('annotationToSuggestion', () => {
    const widget = (overrides) => ({
        subtype: 'Widget',
        rect: [50, 500, 250, 540],
        ...overrides,
    });

    it('ignores non-widget and read-only annotations', () => {
        expect(annotationToSuggestion({ subtype: 'Link', rect: [0, 0, 1, 1] }, GEOMETRY)).toEqual({});
        expect(annotationToSuggestion(widget({ fieldType: 'Tx', readOnly: true }), GEOMETRY)).toEqual({});
        expect(annotationToSuggestion(null, GEOMETRY)).toEqual({});
    });

    it('turns a signature widget into a high-confidence signature suggestion', () => {
        const { suggestion } = annotationToSuggestion(
            widget({ fieldType: 'Sig', fieldName: 'driver_signature' }),
            GEOMETRY,
        );
        expect(suggestion).toMatchObject({ category: 'signature', source: 'pdf', origin: 'widget', page: 1 });
        expect(suggestion.confidence).toBeGreaterThan(0.9);
    });

    it('turns a checkbox widget into a checkbox suggestion', () => {
        const { suggestion } = annotationToSuggestion(
            widget({ fieldType: 'Btn', checkBox: true, fieldName: 'agree' }),
            GEOMETRY,
        );
        expect(suggestion.category).toBe('checkbox');
    });

    it('warns about a radio group instead of emitting loose checkboxes', () => {
        const result = annotationToSuggestion(
            widget({ fieldType: 'Btn', radioButton: true, fieldName: 'marital_status' }),
            GEOMETRY,
        );
        expect(result.suggestion).toBeUndefined();
        expect(result.manualReview).toMatchObject({ kind: 'radio_group', page: 1 });
    });

    it('warns about a dropdown instead of guessing a text field', () => {
        const result = annotationToSuggestion(widget({ fieldType: 'Ch', fieldName: 'state_list' }), GEOMETRY);
        expect(result.suggestion).toBeUndefined();
        expect(result.manualReview.kind).toBe('dropdown');
    });

    it('ignores a push button, which takes no signer input', () => {
        expect(annotationToSuggestion(widget({ fieldType: 'Btn' }), GEOMETRY)).toEqual({});
    });

    it('reads a text widget name for its semantic category', () => {
        const { suggestion } = annotationToSuggestion(
            widget({ fieldType: 'Tx', fieldName: 'applicant_email' }),
            GEOMETRY,
        );
        expect(suggestion.category).toBe('email');
    });

    it('prefers the accessible alternative text over the raw field name', () => {
        const { suggestion } = annotationToSuggestion(
            widget({ fieldType: 'Tx', fieldName: 'f1_04', alternativeText: 'ZIP code' }),
            GEOMETRY,
        );
        expect(suggestion.category).toBe('zip');
    });

    it('flags a multi-line text area while still suggesting the field', () => {
        const result = annotationToSuggestion(
            widget({ fieldType: 'Tx', multiLine: true, fieldName: 'comments' }),
            GEOMETRY,
        );
        expect(result.suggestion.category).toBe('text');
        expect(result.manualReview.kind).toBe('multiline');
    });

    it('drops a widget with an unusable rectangle', () => {
        expect(annotationToSuggestion(widget({ fieldType: 'Sig', rect: null }), GEOMETRY)).toEqual({});
    });
});

describe('blankRunsFromTextItems', () => {
    const item = (str, x, y, width, height = 10) => ({
        str,
        transform: [1, 0, 0, height, x, y],
        width,
        height,
    });

    it('reads an underscore run as a blank labelled by the text before it', () => {
        const found = blankRunsFromTextItems(
            [item('Driver Signature:', 50, 600, 110), item('____________', 170, 600, 150)],
            GEOMETRY,
        );
        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({
            category: 'signature',
            label: 'Driver Signature',
            source: 'pdf',
            origin: 'textRun',
            page: 1,
        });
        expect(found[0].width).toBeGreaterThan(0);
    });

    it('ignores printed text that merely contains an underscore run', () => {
        const found = blankRunsFromTextItems([item('see page __3__ for details', 50, 600, 200)], GEOMETRY);
        expect(found).toEqual([]);
    });

    it('separates rows by baseline', () => {
        const found = blankRunsFromTextItems(
            [
                item('City:', 50, 600, 40),
                item('__________', 100, 600, 120),
                item('ZIP:', 50, 560, 40),
                item('__________', 100, 560, 120),
            ],
            GEOMETRY,
        );
        expect(found.map((f) => f.category)).toEqual(['city', 'zip']);
    });

    it('is less confident about an unlabelled blank', () => {
        const [labelled] = blankRunsFromTextItems(
            [item('Name:', 50, 600, 40), item('_______', 100, 600, 100)],
            GEOMETRY,
        );
        const [unlabelled] = blankRunsFromTextItems([item('_______', 100, 500, 100)], GEOMETRY);
        expect(unlabelled.confidence).toBeLessThan(labelled.confidence);
    });

    it('returns nothing for unusable input', () => {
        expect(blankRunsFromTextItems(null, GEOMETRY)).toEqual([]);
        expect(blankRunsFromTextItems([{ str: '____' }], GEOMETRY)).toEqual([]);
        expect(blankRunsFromTextItems([item('____', 0, 0, 0)], GEOMETRY)).toEqual([]);
    });
});

describe('inspectPdfDocument', () => {
    const stubPage = ({ annotations = [], items = [], viewport } = {}) => ({
        view: VIEW,
        getViewport: vi.fn(() => viewport ?? null),
        getAnnotations: vi.fn(async () => annotations),
        getTextContent: vi.fn(async () => ({ items })),
    });

    const stubDocument = (pages) => ({
        getPage: vi.fn(async (n) => {
            const page = pages[n];
            if (!page) throw new Error('no such page');
            return page;
        }),
    });

    it('collects annotation and text-run suggestions for the requested pages only', async () => {
        const document = stubDocument({
            1: stubPage({
                annotations: [{ subtype: 'Widget', fieldType: 'Sig', fieldName: 'sig', rect: [50, 500, 250, 540] }],
            }),
            2: stubPage({
                annotations: [{ subtype: 'Widget', fieldType: 'Ch', fieldName: 'state', rect: [50, 500, 250, 540] }],
            }),
        });

        const result = await inspectPdfDocument(document, [1]);
        expect(result.rawSuggestions).toHaveLength(1);
        expect(result.manualReview).toEqual([]);
        expect(document.getPage).toHaveBeenCalledTimes(1);
    });

    it('reports pages that carry a real text layer', async () => {
        const document = stubDocument({
            1: stubPage({ items: [{ str: 'Printed text', transform: [1, 0, 0, 10, 10, 700], width: 80, height: 10 }] }),
            2: stubPage({ items: [] }),
        });
        const result = await inspectPdfDocument(document, [1, 2]);
        expect(result.pagesWithText).toEqual([1]);
    });

    it('collapses repeated warnings of the same kind on one page', async () => {
        const radio = (name) => ({
            subtype: 'Widget',
            fieldType: 'Btn',
            radioButton: true,
            fieldName: name,
            rect: [50, 500, 70, 520],
        });
        const document = stubDocument({ 1: stubPage({ annotations: [radio('a'), radio('b'), radio('c')] }) });
        const result = await inspectPdfDocument(document, [1]);
        expect(result.manualReview).toHaveLength(1);
    });

    it('survives a page with no annotation or text layer', async () => {
        const document = stubDocument({
            1: {
                view: VIEW,
                getAnnotations: vi.fn(async () => {
                    throw new Error('no annotations');
                }),
                getTextContent: vi.fn(async () => {
                    throw new Error('no text layer');
                }),
            },
        });
        await expect(inspectPdfDocument(document, [1])).resolves.toMatchObject({ rawSuggestions: [] });
    });

    it('measures through the page viewport when one is available', async () => {
        const viewport = {
            width: 792,
            height: 612,
            convertToViewportRectangle: vi.fn(() => [0, 0, 79.2, 61.2]),
        };
        const document = stubDocument({
            1: stubPage({
                viewport,
                annotations: [{ subtype: 'Widget', fieldType: 'Sig', fieldName: 'sig', rect: [50, 500, 250, 540] }],
            }),
        });

        const result = await inspectPdfDocument(document, [1]);
        expect(viewport.convertToViewportRectangle).toHaveBeenCalled();
        expect(result.rawSuggestions[0]).toMatchObject({ x: 0, y: 0, width: 10, height: 10 });
    });

    it('survives a page whose viewport cannot be built', async () => {
        const page = stubPage({
            annotations: [{ subtype: 'Widget', fieldType: 'Sig', fieldName: 'sig', rect: [0, 396, 306, 792] }],
        });
        page.getViewport = vi.fn(() => {
            throw new Error('no viewport');
        });
        const result = await inspectPdfDocument(stubDocument({ 1: page }), [1]);
        // Falls back to the unrotated page.view geometry.
        expect(result.rawSuggestions[0]).toMatchObject({ x: 0, y: 0, width: 50, height: 50 });
    });

    it('skips a page it cannot load instead of failing the scan', async () => {
        const document = stubDocument({ 2: stubPage({}) });
        await expect(inspectPdfDocument(document, [1, 2])).resolves.toBeTruthy();
    });

    it('stops early when the caller aborts', async () => {
        const controller = new AbortController();
        controller.abort();
        const document = stubDocument({ 1: stubPage({}) });
        const result = await inspectPdfDocument(document, [1], { signal: controller.signal });
        expect(document.getPage).not.toHaveBeenCalled();
        expect(result.rawSuggestions).toEqual([]);
    });
});
