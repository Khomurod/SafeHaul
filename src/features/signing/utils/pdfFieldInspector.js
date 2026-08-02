/**
 * Deterministic PDF inspection for the AI Field Assistant.
 *
 * This is the *reliable* half of the hybrid analysis: when a PDF carries real
 * AcroForm widgets or clearly ruled blanks, their geometry is measured, not
 * guessed, so those suggestions outrank anything the vision model proposes
 * (`source: 'pdf'` wins in `buildSuggestionSet`).
 *
 * The exported helpers are pure and take plain geometry objects, so they can be
 * tested without a PDF.js document. `inspectPdfDocument` is the only function
 * that touches PDF.js.
 */

/** 3+ underscores, or 3+ box-drawing dashes, read as a fill-in blank. */
const BLANK_RUN_PATTERN = /[_—–]{3,}/g;

/**
 * Ordered keyword rules. First match wins, so more specific patterns come
 * first ("date of birth" must not be read as a signing date, and "first name"
 * must not be read as a full name).
 */
const CATEGORY_RULES = [
    { category: null, test: /date\s*of\s*birth|birth\s*date|\bdob\b/i },
    { category: 'initials', test: /\binitials?\b/i },
    { category: 'signature', test: /signature|sign\s*here|signed\s*by|\bsign\b/i },
    { category: 'first_name', test: /first\s*name|given\s*name/i },
    { category: 'last_name', test: /last\s*name|surname|family\s*name/i },
    // Before the generic name rule: "Business Name" is a company, not a person.
    { category: 'company', test: /company|employer|organization|business\s*name/i },
    { category: 'full_name', test: /full\s*name|printed\s*name|print\s*name|\bname\b/i },
    { category: 'email', test: /e-?mail/i },
    { category: 'phone', test: /phone|mobile|cell|telephone/i },
    { category: 'zip', test: /\bzip\b|postal\s*code/i },
    { category: 'city', test: /\bcity\b|town/i },
    { category: 'state', test: /\bstate\b|province/i },
    { category: 'address', test: /address|street/i },
    { category: 'date', test: /\bdate\b|\bdated\b/i },
];

/**
 * Best semantic category for a printed label.
 * Returns 'text' when nothing matches, and null when the label names something
 * deliberately unsupported (a date of birth is not the signing date, and
 * mis-binding it to `current_date` would silently stamp the wrong value).
 */
export function categoryFromLabel(label) {
    const text = String(label || '').trim();
    if (!text) return 'text';
    for (const rule of CATEGORY_RULES) {
        if (rule.test.test(text)) return rule.category === null ? 'text' : rule.category;
    }
    return 'text';
}

/**
 * Convert a PDF user-space rectangle into top-left percentage coordinates.
 *
 * PDF space has its origin bottom-left; the editor stores percentages from the
 * top-left, which is why placement is unaffected by editor zoom or by the pixel
 * size a page happened to be rendered at.
 *
 * ROTATION: a page with `/Rotate 90` or `/Rotate 270` is *displayed* rotated by
 * react-pdf, which swaps the axes relative to `page.view`. Measuring against the
 * unrotated view would put every deterministic suggestion on the wrong axis, so
 * when a PDF.js viewport is available its `convertToViewportRectangle` is used —
 * it already carries the page's default rotation. The `view` path below stays
 * for unrotated pages and for tests that supply plain geometry.
 *
 * @param {number[]} rect  [x1, y1, x2, y2] in PDF user space
 * @param {number[]} view  page.view — [x0, y0, x1, y1]
 * @param {object} [viewport] PDF.js viewport at scale 1, when one is available
 */
export function rectToPercent(rect, view, viewport) {
    if (!Array.isArray(rect) || rect.length < 4) return null;

    if (viewport && typeof viewport.convertToViewportRectangle === 'function') {
        const converted = viewport.convertToViewportRectangle(rect.map(Number));
        const width = Number(viewport.width);
        const height = Number(viewport.height);
        if (
            Array.isArray(converted) &&
            converted.length >= 4 &&
            Number.isFinite(width) &&
            Number.isFinite(height) &&
            width > 0 &&
            height > 0 &&
            converted.every((n) => Number.isFinite(Number(n)))
        ) {
            // Viewport space already has its origin at the top-left with y
            // increasing downward, so only normalization is left.
            const [cx0, cy0, cx1, cy1] = converted.map(Number);
            const left = Math.min(cx0, cx1);
            const right = Math.max(cx0, cx1);
            const top = Math.min(cy0, cy1);
            const bottom = Math.max(cy0, cy1);
            return {
                x: (left / width) * 100,
                y: (top / height) * 100,
                width: ((right - left) / width) * 100,
                height: ((bottom - top) / height) * 100,
            };
        }
    }

    if (!Array.isArray(view) || view.length < 4) return null;
    const [vx0, vy0, vx1, vy1] = view.map(Number);
    const pageWidth = vx1 - vx0;
    const pageHeight = vy1 - vy0;
    if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) || pageWidth <= 0 || pageHeight <= 0) {
        return null;
    }

    const [rx0, ry0, rx1, ry1] = rect.map(Number);
    if ([rx0, ry0, rx1, ry1].some((n) => !Number.isFinite(n))) return null;

    const left = Math.min(rx0, rx1);
    const right = Math.max(rx0, rx1);
    const bottom = Math.min(ry0, ry1);
    const top = Math.max(ry0, ry1);

    return {
        x: ((left - vx0) / pageWidth) * 100,
        y: ((vy1 - top) / pageHeight) * 100,
        width: ((right - left) / pageWidth) * 100,
        height: ((top - bottom) / pageHeight) * 100,
    };
}

/**
 * One PDF.js annotation → a raw suggestion, a manual-review warning, or
 * neither.
 *
 * @returns {{ suggestion?: object, manualReview?: object }}
 */
export function annotationToSuggestion(annotation, { pageNumber, view, viewport }) {
    if (!annotation || annotation.subtype !== 'Widget') return {};
    if (annotation.readOnly === true) return {};

    const rect = rectToPercent(annotation.rect, view, viewport);
    if (!rect) return {};

    const label =
        String(annotation.alternativeText || annotation.fieldName || '').replace(/[._-]+/g, ' ').trim();

    const fieldType = String(annotation.fieldType || '');

    if (fieldType === 'Sig') {
        return {
            suggestion: {
                category: 'signature',
                label: label || 'Signature',
                required: true,
                // Embedded signature widgets are unambiguous.
                confidence: 0.97,
                source: 'pdf',
                origin: 'widget',
                page: pageNumber,
                ...rect,
            },
        };
    }

    if (fieldType === 'Btn') {
        if (annotation.radioButton === true) {
            return {
                manualReview: {
                    kind: 'radio_group',
                    page: pageNumber,
                    detail: label || 'Single-choice group',
                },
            };
        }
        if (annotation.checkBox === true) {
            return {
                suggestion: {
                    category: 'checkbox',
                    label: label || 'Checkbox',
                    required: false,
                    confidence: 0.95,
                    source: 'pdf',
                    origin: 'widget',
                    page: pageNumber,
                    ...rect,
                },
            };
        }
        // Push buttons carry no signer input.
        return {};
    }

    if (fieldType === 'Ch') {
        return {
            manualReview: { kind: 'dropdown', page: pageNumber, detail: label || 'Choice list' },
        };
    }

    if (fieldType === 'Tx') {
        const category = categoryFromLabel(label);
        const result = {
            suggestion: {
                category,
                label: label || 'Text',
                required: false,
                // Measured geometry, inferred meaning: high but not certain.
                confidence: category === 'text' ? 0.82 : 0.9,
                source: 'pdf',
                origin: 'widget',
                page: pageNumber,
                ...rect,
            },
        };
        if (annotation.multiLine === true) {
            result.manualReview = {
                kind: 'multiline',
                page: pageNumber,
                detail: label || 'Multi-line text area',
            };
        }
        return result;
    }

    return {};
}

/**
 * Group PDF.js text items into rows, then read each `______` run as a blank
 * whose label is the text printed immediately before it on the same row.
 *
 * Items are expected in PDF.js `getTextContent()` shape:
 * `{ str, transform: [a, b, c, d, e, f], width, height }`.
 */
export function blankRunsFromTextItems(items, { pageNumber, view, viewport }) {
    if (!Array.isArray(items) || !Array.isArray(view) || view.length < 4) return [];
    const [, , , vy1] = view.map(Number);

    const positioned = items
        .map((item) => {
            const transform = Array.isArray(item?.transform) ? item.transform : null;
            if (!transform || transform.length < 6) return null;
            const x = Number(transform[4]);
            const baselineY = Number(transform[5]);
            const width = Number(item.width);
            const height = Number(item.height) || Math.abs(Number(transform[3])) || 10;
            if ([x, baselineY, width, height].some((n) => !Number.isFinite(n))) return null;
            return { str: String(item.str ?? ''), x, baselineY, width, height };
        })
        .filter(Boolean);

    // Rows: same baseline within half a line height.
    const rows = [];
    for (const item of positioned) {
        const row = rows.find((candidate) => Math.abs(candidate.baselineY - item.baselineY) <= item.height * 0.6);
        if (row) {
            row.items.push(item);
            continue;
        }
        rows.push({ baselineY: item.baselineY, items: [item] });
    }

    const suggestions = [];
    for (const row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        for (let index = 0; index < row.items.length; index += 1) {
            const item = row.items[index];
            BLANK_RUN_PATTERN.lastIndex = 0;
            if (!BLANK_RUN_PATTERN.test(item.str)) continue;
            // A run of underscores with nothing else on it is the blank itself.
            if (item.str.replace(BLANK_RUN_PATTERN, '').trim().length > 0) continue;
            if (item.width <= 0) continue;

            const labelText = row.items
                .slice(0, index)
                .map((sibling) => sibling.str)
                .join(' ')
                .replace(/[:\s]+$/, '')
                .trim();

            const rect = rectToPercent(
                [item.x, item.baselineY, item.x + item.width, item.baselineY + item.height * 1.4],
                view,
                viewport,
            );
            if (!rect) continue;

            suggestions.push({
                category: categoryFromLabel(labelText),
                label: labelText || 'Text',
                required: false,
                // A ruled blank is real, but the label association is a guess.
                confidence: labelText ? 0.7 : 0.5,
                source: 'pdf',
                origin: 'textRun',
                page: pageNumber,
                ...rect,
            });
        }
    }

    // `vy1` is read above only to validate the view; keeping the destructure
    // explicit documents the coordinate system the rects were built in.
    void vy1;
    return suggestions;
}

/**
 * Inspect a loaded PDF.js document.
 *
 * @param {object} pdfDocument  a PDF.js PDFDocumentProxy
 * @param {number[]} pageNumbers
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ rawSuggestions: object[], manualReview: object[], pagesWithText: number[] }>}
 */
export async function inspectPdfDocument(pdfDocument, pageNumbers, options = {}) {
    const rawSuggestions = [];
    const manualReview = [];
    const pagesWithText = [];

    for (const pageNumber of pageNumbers) {
        if (options.signal?.aborted) break;
        let page;
        try {
            page = await pdfDocument.getPage(pageNumber);
        } catch (_) {
            continue;
        }
        const view = page.view;
        // Carries the page's default /Rotate, so a rotated page is measured on
        // the axes it is actually displayed on.
        let viewport = null;
        try {
            viewport = page.getViewport?.({ scale: 1 }) || null;
        } catch (_) {
            viewport = null;
        }

        try {
            const annotations = await page.getAnnotations({ intent: 'display' });
            for (const annotation of annotations || []) {
                const { suggestion, manualReview: warning } = annotationToSuggestion(annotation, {
                    pageNumber,
                    view,
                    viewport,
                });
                if (suggestion) rawSuggestions.push(suggestion);
                if (warning) manualReview.push(warning);
            }
        } catch (_) {
            // A PDF without an annotation layer is normal, not an error.
        }

        try {
            const textContent = await page.getTextContent();
            const items = textContent?.items || [];
            const printed = items.map((item) => String(item?.str ?? '')).join('').trim();
            if (printed.length > 0) pagesWithText.push(pageNumber);
            rawSuggestions.push(...blankRunsFromTextItems(items, { pageNumber, view, viewport }));
        } catch (_) {
            // Scanned pages have no text layer; the vision pass covers them.
        }
    }

    // Collapse repeated warnings of the same kind on the same page.
    const seen = new Set();
    const dedupedReview = manualReview.filter((entry) => {
        const key = `${entry.page}:${entry.kind}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return { rawSuggestions, manualReview: dedupedReview, pagesWithText };
}
