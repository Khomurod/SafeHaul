/**
 * The raw values a class list or a style string may not carry, read as text.
 *
 * The strict Tailwind theme refuses every default colour, type size, radius,
 * shadow and stacking layer: `bg-white`, `text-sm`, `rounded-lg` and `z-10`
 * compile to nothing, and `@apply` of one fails the build. An ARBITRARY value
 * still compiles — `bg-[#ff0000]`, `text-[10px]`, `z-[9999]` — and so does a
 * colour written into a style string. Those are what is left to refuse here.
 *
 * Shared, so the places a class list is written are held to one list:
 * `ds/no-raw-values` reads JavaScript strings with it, and
 * `src/tests/stylesheetContract.test.js` reads every `@apply` and `index.html`.
 * No imports and no paths, so a Vitest test can load it.
 */

const HEX = '#[0-9a-fA-F]{3,8}';

/*
 * `#` is not always a colour, so each shape names its context: an arbitrary
 * value in a class, a declaration whose property takes a colour, a presentation
 * attribute in markup. An anchor (`#main`), a gradient reference (`url(#id)`)
 * or an id selector stays silent.
 */
const PATTERNS = [
    // An arbitrary colour in a class: `bg-[#ff0000]`, `text-[#1877F2]/10`, `from-[rgb(0_0_0)]`.
    ['raw-hex-colour', new RegExp(String.raw`-\[(?:${HEX}|(?:rgb|hsl)a?\([^\]\s]*)\]`, 'g')],
    // A declaration in a style string: `background: #ffffff`.
    ['raw-hex-colour', new RegExp(String.raw`(?:color|background|border|fill|stroke)\s*:\s*['"]?${HEX}\b`, 'g')],
    // A presentation attribute in markup held as text: `fill="#004C68"`.
    ['raw-hex-colour', new RegExp(String.raw`\b(?:fill|stroke|stopColor|stop-color|floodColor|flood-color`
        + String.raw`|lightingColor|lighting-color|color)\s*=\s*["']${HEX}["']`, 'g')],
    // A stacking number as an arbitrary value: `z-[55]`, `-z-[1]`, `md:z-[9999]`.
    ['raw-z-index', /(?<![\w-])-?z-\[-?\d+\](?![\w-])/g],
];

/** An arbitrary type size: under 12px is below the floor, anything else is off the scale. */
const TYPE_SIZE = /text-\[(\d*\.?\d+)(px|rem|em)\]/g;

/**
 * Every raw value in `text`, in order.
 *
 * @param {string} text a string literal, a template chunk, an `@apply` list or a document
 * @returns {{check: string, match: string, index: number}[]}
 */
export function rawValuesIn(text) {
    const found = [];
    for (const [check, pattern] of PATTERNS) {
        for (const match of text.matchAll(pattern)) found.push({ check, match: match[0], index: match.index });
    }
    for (const match of text.matchAll(TYPE_SIZE)) {
        const below = match[2] === 'px' && Number(match[1]) < 12;
        found.push({ check: below ? 'sub-12px-type' : 'arbitrary-type-size', match: match[0], index: match.index });
    }
    return found.sort((a, b) => a.index - b.index);
}

/** What to do instead, per check: the sentence a refusal prints. */
export const REMEDIES = {
    'raw-hex-colour': 'Use a `--ds-*` semantic role. Artwork, a third-party mark or an exported '
        + 'document that must not follow the theme is an exception recorded in roadmap §5.',
    'sub-12px-type': 'The interface floor is 12px (`text-ds-xs`).',
    'arbitrary-type-size': 'Use the `--ds-*` type scale (`text-ds-xs` … `text-ds-heading-xl`); an '
        + 'arbitrary size is a type scale of one.',
    'raw-z-index': 'Name the layer: `z-ds-raised`, `-sticky`, `-dropdown`, `-drawer`, `-modal`, '
        + '`-toast`, or `z-ds-layer-1..4` inside one `isolate` container (`tokens/foundation.css`).',
};
