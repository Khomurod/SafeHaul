/**
 * The raw values a class list or a style string may not carry, read as text.
 *
 * The strict Tailwind theme refuses every default colour, type size, radius,
 * shadow and stacking layer: `bg-white`, `text-sm`, `rounded-lg` and `z-10`
 * compile to nothing, and `@apply` of one fails the build. An ARBITRARY value
 * still compiles, in every syntax Tailwind reads — `bg-[#ff0000]`, `bg-[red]`,
 * `bg-[oklch(50%_0.2_20)]`, `border-[color:red]`, `text-[length:10px]`,
 * `text-[calc(10px)]`, `z-[calc(100)]`, `[color:red]` — and so does a colour
 * written into a style string. Those are what is left to refuse here.
 *
 * Shared, so the places a class list or a colour is written are held to one
 * list: `ds/no-raw-values` reads JavaScript with it,
 * `src/tests/stylesheetContract.test.js` every stylesheet and `@apply`, and
 * `src/tests/pageShell.test.js` `index.html`. No imports and no paths, so a
 * Vitest test can load it.
 */

/**
 * The 148 named colours: the keywords Tailwind parses as colours. `transparent`
 * and `currentColor` are values rather than a palette, and the theme keeps
 * them. The system colours (`Canvas`, `Highlight`…) are not here: they are the
 * user's own, the ones a `forced-colors` style must use.
 */
export const COLOUR_WORDS = new Set(`
    aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown
    burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan
    darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid
    darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet
    deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro
    ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki
    lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow
    lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
    lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine
    mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
    mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab
    orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru
    pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown
    seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
    teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen
`.trim().split(/\s+/));

const HEX = /#[0-9a-fA-F]{3,8}(?![\w-])/;
const COLOUR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)\(/i;

/** A value with quoted text, `url()` and variable names taken out: what is left is the value's own. */
const ownText = (value) => value
    .replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, ' ')
    .replace(/url\([^)]*\)/gi, ' ')
    .replace(/var\(\s*--[\w-]*/g, 'var(');

/**
 * Does this CSS value hold a raw colour? A hex or a colour function anywhere;
 * with `words`, a colour keyword too — a keyword is a colour only where one is
 * expected, since `highlight` names a keyframe as easily. `url(#paint0)` is a
 * reference and quoted text is content; a variable is held where it is
 * defined, and only its fallback is read here.
 */
export function holdsRawColour(value, { words = true } = {}) {
    const text = ownText(value).replace(/_/g, ' ');
    if (HEX.test(text) || COLOUR_FUNCTION.test(text)) return true;
    return words && (text.match(/[a-z]+/gi) ?? []).some((word) => COLOUR_WORDS.has(word.toLowerCase()));
}

/** Is this whole string one colour: `#0f172a`, `rgb(0 0 0 / 0.5)`, or, with `words`, `black`? */
export function isColour(text, { words = true } = {}) {
    const value = text.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return true;
    if (/^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)\(.*\)$/is.test(value)) return true;
    return words && COLOUR_WORDS.has(value.toLowerCase());
}

/** A stacking layer with a number of its own — `9999`, `calc(100)`, `var(--x, 10)` — rather than a name. */
export const numericLayer = (value) => /\d/.test(ownText(value));

const VARIABLE_ONLY = /^var\(--[\w-]+\)$/;
const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/;
const PX_PER = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, rem: 16, em: 16 };

/**
 * A font size that is not a `--ds-*` role: below the floor when every absolute
 * size it names is under 12px (`10px`, `calc(10px)`, `0.5rem` at the 16px
 * root), off the scale otherwise. A variable alone, or a CSS-wide keyword, is
 * not a size of its own.
 */
function typeSizeCheck(value) {
    if (VARIABLE_ONLY.test(value) || CSS_WIDE.test(value)) return null;
    const sizes = [...ownText(value).matchAll(/(?<![\w.])(\d*\.?\d+)(px|pt|pc|in|cm|mm|q|rem|em)(?![\w-])/gi)]
        .map(([, number, unit]) => Number(number) * PX_PER[unit.toLowerCase()]);
    return sizes.length > 0 && Math.max(...sizes) < 12 ? 'sub-12px-type' : 'arbitrary-type-size';
}

/*
 * How Tailwind reads `text-[…]`: a `length:`, `percentage:` or size hint, or a
 * value that is a length, a percentage, a math function or a size keyword, is
 * a font size; anything else is a colour.
 */
const SIZE_HINTS = new Set(['length', 'percentage', 'absolute-size', 'relative-size']);
const IS_TYPE_SIZE = new RegExp(String.raw`^(?:0|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:[a-z]+|%)|(?:calc|min|max|clamp)\(.*\)`
    + String.raw`|xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller)$`, 'is');

/** The utilities whose arbitrary value Tailwind applies as a colour, where a colour keyword is one. */
const COLOUR_UTILITIES = new Set([
    'bg', 'text', 'border', 'border-x', 'border-y', 'border-s', 'border-e', 'border-t', 'border-r', 'border-b',
    'border-l', 'divide', 'outline', 'ring', 'ring-offset', 'shadow', 'drop-shadow', 'decoration', 'accent',
    'caret', 'fill', 'stroke', 'from', 'via', 'to', 'placeholder',
]);
/** A CSS property that takes a colour: `color`, `background-color`, `border-top`, `box-shadow`, `fill`… */
const COLOUR_PROPERTY = /(?:^|-)(?:color|background|border|outline|shadow|fill|stroke|decoration|rule|emphasis)(?:-|$)/;

/** The check an arbitrary value or property breaks, or null. */
function arbitraryCheck(utility, property, raw) {
    if (utility !== null) {
        const [, hint = null, value] = /^(?:([a-z-]+):)?(.*)$/s.exec(raw);
        if (utility === 'z') return numericLayer(value) ? 'raw-z-index' : null;
        if (utility === 'text' && (SIZE_HINTS.has(hint) || (hint === null && IS_TYPE_SIZE.test(value)))) {
            return typeSizeCheck(value);
        }
        return holdsRawColour(value, { words: hint === 'color' || COLOUR_UTILITIES.has(utility) }) ? 'raw-hex-colour' : null;
    }
    if (property === 'z-index') return numericLayer(raw) ? 'raw-z-index' : null;
    if (property === 'font-size' || property === 'font') return typeSizeCheck(raw);
    return holdsRawColour(raw, { words: COLOUR_PROPERTY.test(property) }) ? 'raw-hex-colour' : null;
}

/*
 * A class token's arbitrary value (`bg-[#fff]/20`, `md:text-[length:10px]`,
 * `-z-[1]`) or arbitrary property (`[color:red]`, `md:[z-index:9]`); never an
 * arbitrary variant, which a `:` follows (`data-[state=open]:`, `[&:hover]:`).
 */
const ARBITRARY = /(?<![\w[\]-])(?:-?([a-z][a-z\d]*(?:-[a-z\d]+)*?)-\[([^\]\s]+)\]|\[(--[\w-]+|[a-z][a-z\d-]*):([^\]\s]+)\])(?!:)/g;

/*
 * Markup and style text: a declaration whose property takes a colour, where
 * a declaration starts (`background: #ffffff`, `style="color:red"`), and a
 * presentation attribute (`fill="#004C68"`). `#` is not always a colour, so
 * each names its context: an anchor (`#main`), a gradient reference
 * (`url(#id)`) or an id selector stays silent, and "Pick a color: red" in
 * prose is not a declaration.
 */
const DECLARATION = /(?:^|[{;"'`])\s*(-{0,2}[a-z][\w-]*)\s*:\s*['"]?([^;{}"'`\n]+)/g;
const PRESENTATION = /(?<![\w-])(?:fill|stroke|stopColor|stop-color|floodColor|flood-color|lightingColor|lighting-color|color)\s*=\s*(["'])(.*?)\1/g;

/** Every declaration in `text` whose property takes a colour and whose value holds a raw one. */
export function colourDeclarationsIn(text) {
    return [...text.matchAll(DECLARATION)].flatMap((match) => {
        const [whole, property, value] = match;
        if (!COLOUR_PROPERTY.test(property) || !holdsRawColour(value)) return [];
        const index = match.index + whole.indexOf(property);
        return [{ check: 'raw-hex-colour', match: text.slice(index, match.index + whole.length).trim(), index }];
    });
}

/**
 * Every raw value in `text`, in order.
 *
 * @param {string} text a string literal, a template chunk, an `@apply` list or a document
 * @returns {{check: string, match: string, index: number}[]}
 */
export function rawValuesIn(text) {
    const found = [];
    for (const match of text.matchAll(ARBITRARY)) {
        const [whole, utility = null, value, property = null, propertyValue] = match;
        const check = arbitraryCheck(utility, property, utility === null ? propertyValue : value);
        if (check) found.push({ check, match: whole, index: match.index });
    }
    found.push(...colourDeclarationsIn(text));
    for (const match of text.matchAll(PRESENTATION)) {
        if (holdsRawColour(match[2])) found.push({ check: 'raw-hex-colour', match: match[0], index: match.index });
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
