// functions/shared/pdf/layout.js
//
// The layout vocabulary of the PDF engine: the page and margin geometry, the
// type scale, the ink palette, and the text sanitation and wrapping that make
// arbitrary strings safe for a WinAnsi standard font. Extracted verbatim from
// `documentBuilder.js`, whose header explains why this engine exists and why
// it is domain-free. Numbers here are geometry; changing any of them changes
// every document this engine lays out.

const { rgb } = require('pdf-lib');


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

module.exports = {
    PAGE,
    MARGIN,
    CONTENT_WIDTH,
    TYPE,
    INK,
    TYPOGRAPHIC_FOLDS,
    WIN_ANSI_SAFE,
    stripControlCharacters,
    sanitizeForStandardFont,
    wrapText,
};
