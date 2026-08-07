// functions/shared/pdf/documentBuilder.js
//
// A small, domain-free layout engine over pdf-lib.
//
// WHY THIS EXISTS
// ---------------
// The application PDF used to be produced in the browser by jsPDF, with the
// layout, the field mapping and the legal text all tangled together in one
// file. Cursor arithmetic was open-coded at every call site, page breaks were
// checked by hand, and a section that grew past the bottom of the page simply
// ran off it.
//
// Everything here is about ink on paper: fonts, measurement, wrapping, page
// breaks, running headers and footers. It knows nothing about drivers,
// employers or agreements — `applicationDocument.js` owns all of that. Keeping
// the split means the layout can be reasoned about (and tested) without a
// submission record, and the domain mapping without a PDF.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/** US Letter, in points. */
const PAGE = Object.freeze({ WIDTH: 612, HEIGHT: 792 });

const MARGIN = Object.freeze({ TOP: 54, BOTTOM: 54, LEFT: 54, RIGHT: 54 });

const CONTENT_WIDTH = PAGE.WIDTH - MARGIN.LEFT - MARGIN.RIGHT;

/** One restrained type scale, so the document reads as one document. */
const TYPE = Object.freeze({
    TITLE: 17,
    COMPANY: 15,
    SECTION: 10.5,
    SUBHEADING: 9.5,
    BODY: 9.5,
    LABEL: 8,
    SMALL: 7.5,
    FOOTER: 7.5,
});

const INK = Object.freeze({
    TEXT: rgb(0.09, 0.11, 0.15),
    MUTED: rgb(0.42, 0.45, 0.5),
    RULE: rgb(0.80, 0.83, 0.87),
    BAND: rgb(0.94, 0.95, 0.97),
    ACCENT: rgb(0.12, 0.25, 0.55),
    WARNING: rgb(0.62, 0.30, 0.02),
});

/**
 * The 14 standard PDF fonts encode WinAnsi only, and pdf-lib throws on any
 * character outside it. Driver-entered text is free-form, so a single unusual
 * character would abort the whole document.
 *
 * Common typographic characters are folded to their ASCII equivalents (they read
 * identically); anything still unencodable becomes '?'. Latin letters with
 * diacritics — the realistic case in a name — are inside WinAnsi and pass
 * through untouched. Embedding a Unicode font would remove the '?' fallback
 * entirely and is the upgrade path if non-Latin scripts ever need to render.
 */
const TYPOGRAPHIC_FOLDS = [
    [/[\u2018\u2019\u201A\u201B]/g, "'"],
    [/[\u201C\u201D\u201E\u201F]/g, '"'],
    [/[\u2010\u2011\u2012\u2013]/g, '-'],
    [/[\u2015]/g, '\u2014'],
    [/\u2026/g, '...'],
    [/[\u00A0\u2007\u202F\u2009\u200A]/g, ' '],
    [/[\u25CF\u25AA\u2043]/g, '\u2022'],
    [/\u2122/g, '(TM)'],
    [/\u2044/g, '/'],
    [/\r/g, ''],
];

/**
 * Characters WinAnsi actually encodes: ASCII, Latin-1's printable range, and the
 * scattered set pdf-lib maps into 0x80-0x9F. Everything else becomes '?'.
 */
const WIN_ANSI_SAFE = new RegExp(
    // \n is kept: `paragraph` splits on it to find its lines, and `line` — which
    // draws a single line — strips it. Folding it to '?' here silently destroyed
    // every paragraph break in the legal agreements.
    '[^\\u000A\\u0020-\\u007E\\u00A0-\\u00FF'
    + '\\u20AC\\u201A\\u0192\\u201E\\u2026\\u2020\\u2021\\u02C6\\u2030\\u0160\\u2039\\u0152\\u017D'
    + '\\u2018\\u2019\\u201C\\u201D\\u2022\\u2013\\u2014\\u02DC\\u2122\\u0161\\u203A\\u0153\\u017E\\u0178]',
    'g',
);

/**
 * Drop C0 and DEL control characters, keeping tab and newline.
 *
 * Done by code point rather than by regular expression: a character class of
 * literal control characters is invisible in a diff and is exactly what eslint's
 * no-control-regex exists to stop.
 */
function stripControlCharacters(text) {
    let out = '';
    for (const char of text) {
        const code = char.codePointAt(0);
        const isControl = (code < 0x20 && code !== 0x09 && code !== 0x0A) || code === 0x7F;
        if (!isControl) out += char;
    }
    return out;
}

function sanitizeForStandardFont(value) {
    let text = String(value ?? '');
    for (const [pattern, replacement] of TYPOGRAPHIC_FOLDS) {
        text = text.replace(pattern, replacement);
    }
    // Tabs become spaces; every other control character is dropped outright.
    // Built via RegExp rather than a literal: an inline control-character class
    // is invisible in a diff, and eslint's no-control-regex rightly objects.
    text = stripControlCharacters(text.replace(/\t/g, '    '));
    return text.replace(WIN_ANSI_SAFE, '?');
}

/**
 * Break `text` into lines that fit `maxWidth`, honouring the newlines already in
 * it. A single word longer than the line (a pasted URL, an unspaced string) is
 * split by character rather than allowed to overflow the margin.
 */
function wrapText(text, { font, size, maxWidth }) {
    const clean = sanitizeForStandardFont(text);
    const lines = [];

    for (const paragraph of clean.split('\n')) {
        if (paragraph.trim() === '') {
            lines.push('');
            continue;
        }

        let current = '';
        for (const word of paragraph.split(/\s+/).filter(Boolean)) {
            const candidate = current ? `${current} ${word}` : word;
            if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
                current = candidate;
                continue;
            }
            if (current) lines.push(current);

            if (font.widthOfTextAtSize(word, size) <= maxWidth) {
                current = word;
                continue;
            }
            // Oversized single token: break it at the last character that fits.
            let chunk = '';
            for (const char of word) {
                if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
                    lines.push(chunk);
                    chunk = char;
                } else {
                    chunk += char;
                }
            }
            current = chunk;
        }
        if (current) lines.push(current);
    }

    return lines.length ? lines : [''];
}

/**
 * A document under construction: one cursor, automatic page breaks, and running
 * furniture applied once at the end (when the total page count is finally known).
 */
class DocumentBuilder {
    constructor({ pdfDoc, regular, bold, italic }) {
        this.pdfDoc = pdfDoc;
        this.font = { regular, bold, italic };
        this.pages = [];
        this.page = null;
        this.y = 0;
        /** Set by the caller; drawn into every page's footer at finish(). */
        this.footerLeft = '';
        this.footerCenter = '';
        this.runningHeader = '';
        this.addPage();
    }

    static async create() {
        const pdfDoc = await PDFDocument.create();
        const [regular, bold, italic] = await Promise.all([
            pdfDoc.embedFont(StandardFonts.Helvetica),
            pdfDoc.embedFont(StandardFonts.HelveticaBold),
            pdfDoc.embedFont(StandardFonts.HelveticaOblique),
        ]);
        return new DocumentBuilder({ pdfDoc, regular, bold, italic });
    }

    addPage() {
        this.page = this.pdfDoc.addPage([PAGE.WIDTH, PAGE.HEIGHT]);
        this.pages.push(this.page);
        // Every page after the first leaves room for the running header.
        this.y = PAGE.HEIGHT - MARGIN.TOP - (this.pages.length > 1 ? 20 : 0);
        return this.page;
    }

    /** Remaining vertical space above the footer. */
    get remaining() {
        return this.y - MARGIN.BOTTOM - 18;
    }

    /** Start a new page unless `height` still fits on this one. */
    ensure(height) {
        if (this.remaining < height) this.addPage();
    }

    moveDown(amount) {
        this.y -= amount;
    }

    /**
     * Draw one line of text. Does NOT wrap — callers that may overflow use
     * `paragraph`, which does.
     */
    line(text, {
        x = MARGIN.LEFT,
        size = TYPE.BODY,
        font = this.font.regular,
        color = INK.TEXT,
        align = 'left',
        width = CONTENT_WIDTH,
        advance = true,
        leading = 1.35,
    } = {}) {
        const clean = sanitizeForStandardFont(text).replace(/\n/g, ' ');
        let drawX = x;
        if (align === 'right') drawX = x + width - font.widthOfTextAtSize(clean, size);
        if (align === 'center') drawX = x + (width - font.widthOfTextAtSize(clean, size)) / 2;

        this.page.drawText(clean, { x: drawX, y: this.y - size, size, font, color });
        if (advance) this.y -= size * leading;
    }

    /** Wrapped body text, breaking across pages as needed. */
    paragraph(text, {
        x = MARGIN.LEFT,
        width = CONTENT_WIDTH,
        size = TYPE.BODY,
        font = this.font.regular,
        color = INK.TEXT,
        leading = 1.4,
    } = {}) {
        for (const lineText of wrapText(text, { font, size, maxWidth: width })) {
            this.ensure(size * leading);
            this.line(lineText, { x, size, font, color, width, leading });
        }
    }

    rule({ color = INK.RULE, thickness = 0.6, width = CONTENT_WIDTH, x = MARGIN.LEFT } = {}) {
        this.page.drawLine({
            start: { x, y: this.y },
            end: { x: x + width, y: this.y },
            thickness,
            color,
        });
    }

    /**
     * A section heading: a tinted band with the title in it. Kept with at least
     * the first rows of its content so a heading never strands at a page foot.
     */
    sectionHeading(title, { keepWith = 62 } = {}) {
        this.ensure(26 + keepWith);
        this.moveDown(8);
        this.page.drawRectangle({
            x: MARGIN.LEFT,
            y: this.y - 15,
            width: CONTENT_WIDTH,
            height: 18,
            color: INK.BAND,
        });
        this.page.drawRectangle({
            x: MARGIN.LEFT,
            y: this.y - 15,
            width: 2.5,
            height: 18,
            color: INK.ACCENT,
        });
        this.line(title.toUpperCase(), {
            x: MARGIN.LEFT + 9,
            size: TYPE.SECTION,
            font: this.font.bold,
            advance: false,
        });
        this.moveDown(24);
    }

    /**
     * A group label. Kept with enough space for the first record beneath it: a
     * "Driving Schools" heading alone at the foot of a page, with its one school
     * overleaf, reads as an empty section.
     */
    subheading(text, { keepWith = 92 } = {}) {
        this.ensure(20 + keepWith);
        this.moveDown(3);
        this.line(text, { size: TYPE.SUBHEADING, font: this.font.bold });
        this.moveDown(2);
    }

    /**
     * Label-above-value pairs in a two-column grid.
     *
     * A value long enough to need more than one line takes the full width, so a
     * long explanation is readable rather than squeezed into half the page.
     */
    fieldGrid(fields, { columns = 2 } = {}) {
        const gutter = 18;
        const columnWidth = (CONTENT_WIDTH - gutter * (columns - 1)) / columns;
        let column = 0;
        let rowTop = this.y;
        let rowHeight = 0;

        const closeRow = () => {
            if (rowHeight === 0) return;
            this.y = rowTop - rowHeight;
            column = 0;
            rowHeight = 0;
        };

        for (const field of fields) {
            const valueLines = wrapText(field.value, {
                font: this.font.regular,
                size: TYPE.BODY,
                maxWidth: columnWidth,
            });
            const fullWidth = field.fullWidth || valueLines.length > 2;

            if (fullWidth && column !== 0) closeRow();

            const width = fullWidth ? CONTENT_WIDTH : columnWidth;
            const lines = fullWidth
                ? wrapText(field.value, { font: this.font.regular, size: TYPE.BODY, maxWidth: width })
                : valueLines;
            const height = 11 + lines.length * (TYPE.BODY * 1.3) + 7;

            if (column === 0) {
                this.ensure(height);
                rowTop = this.y;
                rowHeight = 0;
            }

            const x = MARGIN.LEFT + column * (columnWidth + gutter);
            const savedY = this.y;
            this.y = rowTop;

            this.line(field.label.toUpperCase(), {
                x,
                width,
                size: TYPE.LABEL,
                font: this.font.bold,
                color: INK.MUTED,
                leading: 1.35,
            });
            for (const lineText of lines) {
                this.line(lineText, {
                    x,
                    width,
                    size: TYPE.BODY,
                    color: field.muted ? INK.MUTED : INK.TEXT,
                    font: field.muted ? this.font.italic : this.font.regular,
                    leading: 1.3,
                });
            }

            rowHeight = Math.max(rowHeight, rowTop - this.y + 7);
            this.y = savedY;

            if (fullWidth) {
                closeRow();
            } else {
                column += 1;
                if (column >= columns) closeRow();
            }
        }
        closeRow();
    }

    /**
     * How tall one record block will be, without drawing it.
     *
     * Used to decide whether a group heading can be kept with its first record:
     * a heading alone at the foot of a page, with its only record overleaf,
     * reads as an empty section.
     */
    measureRecordBlock(cells) {
        const gutter = 14;
        const columnWidth = (CONTENT_WIDTH - 20 - gutter) / 2;

        let height = 22;
        let pendingNarrow = 0;
        for (const cell of cells) {
            const lines = wrapText(cell.displayValue, {
                font: this.font.regular, size: TYPE.BODY, maxWidth: columnWidth,
            });
            if (lines.length > 2) {
                pendingNarrow = 0;
                const wideLines = wrapText(cell.displayValue, {
                    font: this.font.regular, size: TYPE.BODY, maxWidth: CONTENT_WIDTH - 20,
                });
                height += 10 + wideLines.length * (TYPE.BODY * 1.3) + 5;
            } else if (pendingNarrow === 0) {
                height += 10 + lines.length * (TYPE.BODY * 1.3) + 5;
                pendingNarrow = 1;
            } else {
                pendingNarrow = 0;
            }
        }
        return height;
    }

    /**
     * One record of a repeating group, as a titled block of label/value cells.
     *
     * A block is laid out as a unit: if it does not fit, it moves whole to the
     * next page rather than being split down the middle, so an employer's dates
     * never end up on a different page from the employer.
     */
    recordBlock(title, cells) {
        const gutter = 14;
        const columnWidth = (CONTENT_WIDTH - 20 - gutter) / 2;

        const measured = cells.map((cell) => {
            const lines = wrapText(cell.displayValue, {
                font: this.font.regular,
                size: TYPE.BODY,
                maxWidth: columnWidth,
            });
            return { ...cell, lines, wide: lines.length > 2 };
        });

        this.ensure(this.measureRecordBlock(cells) + 10);

        const top = this.y;
        this.moveDown(4);
        this.line(title, {
            x: MARGIN.LEFT + 10,
            size: TYPE.SUBHEADING,
            font: this.font.bold,
            width: CONTENT_WIDTH - 20,
        });
        this.moveDown(2);

        const savedLeft = MARGIN.LEFT;
        const innerFields = measured.map((cell) => ({
            label: cell.label,
            value: cell.displayValue,
            fullWidth: cell.wide,
        }));
        this._gridWithin(innerFields, savedLeft + 10, CONTENT_WIDTH - 20);
        this.moveDown(6);

        this.page.drawRectangle({
            x: MARGIN.LEFT,
            y: this.y,
            width: CONTENT_WIDTH,
            height: Math.max(top - this.y, 0),
            borderColor: INK.RULE,
            borderWidth: 0.6,
        });
        this.moveDown(8);
    }

    /** fieldGrid constrained to an arbitrary box; used by recordBlock. */
    _gridWithin(fields, left, totalWidth) {
        const gutter = 14;
        const columnWidth = (totalWidth - gutter) / 2;
        let column = 0;
        let rowTop = this.y;
        let rowHeight = 0;

        const closeRow = () => {
            if (rowHeight === 0) return;
            this.y = rowTop - rowHeight;
            column = 0;
            rowHeight = 0;
        };

        for (const field of fields) {
            const width = field.fullWidth ? totalWidth : columnWidth;
            if (field.fullWidth && column !== 0) closeRow();

            const lines = wrapText(field.value, {
                font: this.font.regular,
                size: TYPE.BODY,
                maxWidth: width,
            });
            const height = 10 + lines.length * (TYPE.BODY * 1.3) + 5;

            if (column === 0) {
                this.ensure(height);
                rowTop = this.y;
                rowHeight = 0;
            }

            const x = left + column * (columnWidth + gutter);
            const savedY = this.y;
            this.y = rowTop;

            this.line(field.label.toUpperCase(), {
                x, width, size: TYPE.LABEL, font: this.font.bold, color: INK.MUTED, leading: 1.3,
            });
            for (const lineText of lines) {
                this.line(lineText, { x, width, size: TYPE.BODY, leading: 1.3 });
            }

            rowHeight = Math.max(rowHeight, rowTop - this.y + 5);
            this.y = savedY;

            if (field.fullWidth) closeRow();
            else {
                column += 1;
                if (column >= 2) closeRow();
            }
        }
        closeRow();
    }

    /** An italic muted note — "None recorded", provenance caveats. */
    note(text, { color = INK.MUTED } = {}) {
        this.paragraph(text, { font: this.font.italic, size: TYPE.SMALL, color });
        this.moveDown(2);
    }

    /**
     * Stamp the running header and footer onto every page. Called last, because
     * "Page 3 of 11" cannot be written before the eleventh page exists.
     */
    finish() {
        const total = this.pages.length;
        this.pages.forEach((page, index) => {
            const pageNumber = index + 1;

            if (index > 0 && this.runningHeader) {
                page.drawText(sanitizeForStandardFont(this.runningHeader), {
                    x: MARGIN.LEFT,
                    y: PAGE.HEIGHT - MARGIN.TOP + 12,
                    size: TYPE.SMALL,
                    font: this.font.regular,
                    color: INK.MUTED,
                });
                page.drawLine({
                    start: { x: MARGIN.LEFT, y: PAGE.HEIGHT - MARGIN.TOP + 6 },
                    end: { x: PAGE.WIDTH - MARGIN.RIGHT, y: PAGE.HEIGHT - MARGIN.TOP + 6 },
                    thickness: 0.5,
                    color: INK.RULE,
                });
            }

            page.drawLine({
                start: { x: MARGIN.LEFT, y: MARGIN.BOTTOM - 6 },
                end: { x: PAGE.WIDTH - MARGIN.RIGHT, y: MARGIN.BOTTOM - 6 },
                thickness: 0.5,
                color: INK.RULE,
            });

            const footerY = MARGIN.BOTTOM - 18;
            if (this.footerLeft) {
                page.drawText(sanitizeForStandardFont(this.footerLeft), {
                    x: MARGIN.LEFT, y: footerY, size: TYPE.FOOTER, font: this.font.regular, color: INK.MUTED,
                });
            }
            if (this.footerCenter) {
                const clean = sanitizeForStandardFont(this.footerCenter);
                page.drawText(clean, {
                    x: MARGIN.LEFT + (CONTENT_WIDTH - this.font.regular.widthOfTextAtSize(clean, TYPE.FOOTER)) / 2,
                    y: footerY,
                    size: TYPE.FOOTER,
                    font: this.font.regular,
                    color: INK.MUTED,
                });
            }
            const label = `Page ${pageNumber} of ${total}`;
            page.drawText(label, {
                x: PAGE.WIDTH - MARGIN.RIGHT - this.font.regular.widthOfTextAtSize(label, TYPE.FOOTER),
                y: footerY,
                size: TYPE.FOOTER,
                font: this.font.regular,
                color: INK.MUTED,
            });
        });
    }

    async save() {
        this.finish();
        return this.pdfDoc.save();
    }
}

module.exports = {
    CONTENT_WIDTH,
    DocumentBuilder,
    INK,
    MARGIN,
    PAGE,
    TYPE,
    sanitizeForStandardFont,
    wrapText,
};
