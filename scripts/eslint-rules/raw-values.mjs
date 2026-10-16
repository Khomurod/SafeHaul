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
/*
 * Every CSS function that makes a colour. One that only combines roles
 * (`color-mix()`, `light-dark()`, `rgb(from var(--ds-…) …)`) makes a colour no
 * role names, so it is as raw as a hex.
 */
const COLOUR_FUNCTIONS = 'rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark|contrast-color|color-contrast'
    + '|device-cmyk|ictcp|jzazbz|jzczhz';
const COLOUR_FUNCTION = new RegExp(String.raw`(?<![\w-])(?:${COLOUR_FUNCTIONS})\(`, 'i');

/** A value with quoted text, `url()` and variable names taken out: what is left is the value's own. */
const ownText = (value) => value
    .replace(/(["'])(?:\\.|(?!\1)[^\\])*\1/g, ' ')
    .replace(/url\([^)]*\)/gi, ' ')
    .replace(/var\(\s*--[\w-]*/g, 'var(');

/**
 * A stylesheet with only what its declarations' values can paint: no
 * selector (`#add { … }`), string (`content: '#fff'`) or `url(#abc)` holds a
 * colour, whatever it spells.
 */
export const stylesheetValues = (css) => ownText(css).replace(/(^|[{};])[^{};]*(?=\{)/g, '$1');

/** Every hex and colour function in `text`, as written: what a stylesheet may not hold. */
export const colourLiteralsIn = (text) => text.match(new RegExp(`${HEX.source}|${COLOUR_FUNCTION.source}`, 'gi')) ?? [];

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
    if (new RegExp(String.raw`^(?:${COLOUR_FUNCTIONS})\(.*\)$`, 'is').test(value)) return true;
    return words && COLOUR_WORDS.has(value.toLowerCase());
}

/** A stacking layer with a number of its own — `9999`, `calc(100)`, `var(--x, 10)` — rather than a name. */
export const numericLayer = (value) => /\d/.test(ownText(value));

const VARIABLE_ONLY = /^var\(--[\w-]+\)$/;
const CSS_WIDE = /^(?:inherit|initial|unset|revert|revert-layer)$/i;

/*
 * A font size's range in px, as CSS computes it: `calc(10px + 10px)` is 20px,
 * `min(10px, 20px)` 10px, `clamp(10px, 2vw, 14px)` anywhere from 10px to 14px.
 * `rem` is the 16px root, a size keyword its CSS size. `em`, `%`, `larger` and
 * `smaller` scale the parent's size, which the floor keeps at 12px or more;
 * what the page decides alone — a viewport unit, a variable — may be any size.
 * Null when the value is not a size CSS can compute.
 */
const ABSOLUTE = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, rem: 16 };
const KEYWORD_SIZES = { 'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48 };
const PARENT = { lo: 12, hi: Infinity, length: true };
const ANY_SIZE = { lo: 0, hi: Infinity, length: true };
const exact = (n, length) => ({ lo: n, hi: n, length });
const times = (a, b) => (a === 0 || b === 0 ? 0 : a * b);
const scaled = (range, by) => {
    const ends = [times(range.lo, by.lo), times(range.lo, by.hi), times(range.hi, by.lo), times(range.hi, by.hi)];
    return { lo: Math.min(...ends), hi: Math.max(...ends), length: range.length || by.length };
};
const lowest = (list) => ({ lo: Math.min(...list.map((r) => r.lo)), hi: Math.min(...list.map((r) => r.hi)), length: list.some((r) => r.length) });
const highest = (list) => ({ lo: Math.max(...list.map((r) => r.lo)), hi: Math.max(...list.map((r) => r.hi)), length: list.some((r) => r.length) });

function sizeRange(value) {
    // CSS takes a bare zero as a length; any other unitless number is none.
    if (/^\s*[+-]?(?:0+\.?0*|\.0+)(?:e[+-]?\d+)?\s*$/i.test(value)) return exact(0, true);
    const tokens = [];
    let end = 0;
    for (const match of value.toLowerCase().matchAll(/\s*(?:(\d*\.?\d+(?:e[+-]?\d+)?)([a-z%]*)|(calc|min|max|clamp|var)\(|([(),*/+-])|([a-z][a-z-]*))\s*/gy)) {
        tokens.push(match);
        end = match.index + match[0].length;
    }
    if (end !== value.length) return null;
    let at = 0;
    const is = (symbol) => tokens[at]?.[4] === symbol;
    const closes = () => is(')') && Boolean(tokens[at++]);
    function list() {
        const items = [expression()];
        while (is(',') && tokens[at++]) items.push(expression());
        return closes() && !items.includes(null) ? items : null;
    }
    function factor() {
        const token = tokens[at++];
        if (!token) return null;
        const [, number, unit, fn, symbol, word] = token;
        if (number !== undefined) {
            if (unit === '') return exact(Number(number), false);
            if (ABSOLUTE[unit]) return exact(Number(number) * ABSOLUTE[unit], true);
            if (unit === 'em') return scaled(PARENT, exact(Number(number), false));
            if (unit === '%') return scaled(PARENT, exact(Number(number) / 100, false));
            return ANY_SIZE;
        }
        if (fn === 'var') {
            for (let depth = 1; depth > 0;) {
                const next = tokens[at++];
                if (!next) return null;
                if (next[3] || next[4] === '(') depth += 1;
                if (next[4] === ')') depth -= 1;
            }
            return ANY_SIZE;
        }
        if (fn) {
            const items = list();
            if (items === null) return null;
            if (fn === 'calc') return items.length === 1 ? items[0] : null;
            if (fn === 'min') return lowest(items);
            if (fn === 'max') return highest(items);
            return items.length === 3 ? highest([items[0], lowest([items[1], items[2]])]) : null;
        }
        if (symbol === '(') {
            const inner = expression();
            return closes() ? inner : null;
        }
        if (symbol === '-') {
            const inner = factor();
            return inner && { lo: -inner.hi, hi: -inner.lo, length: inner.length };
        }
        if (KEYWORD_SIZES[word]) return exact(KEYWORD_SIZES[word], true);
        if (word === 'larger') return scaled(PARENT, exact(1.2, false));
        if (word === 'smaller') return scaled(PARENT, exact(1 / 1.2, false));
        return null;
    }
    function term() {
        let left = factor();
        while (left && (is('*') || is('/'))) {
            const divide = tokens[at++][4] === '/';
            const right = factor();
            if (!right) return null;
            if (!divide) left = scaled(left, right);
            else if (right.lo <= 0 && right.hi >= 0) left = { lo: -Infinity, hi: Infinity, length: left.length };
            else left = scaled(left, { lo: 1 / right.hi, hi: 1 / right.lo, length: false });
        }
        return left;
    }
    function expression() {
        let left = term();
        while (left && (is('+') || is('-'))) {
            const minus = tokens[at++][4] === '-';
            const right = term();
            if (!right) return null;
            left = minus
                ? { lo: left.lo - right.hi, hi: left.hi - right.lo, length: left.length || right.length }
                : { lo: left.lo + right.lo, hi: left.hi + right.hi, length: left.length || right.length };
        }
        return left;
    }
    const result = expression();
    return result && at === tokens.length && result.length ? result : null;
}

/**
 * A font size that is not a `--ds-*` role: below the floor when it can compute
 * to under 12px (`10px`, `calc(10px)`, `min(10px, 20px)`, `0.5rem`), off the
 * scale otherwise (`calc(10px + 10px)`). A variable alone, or a CSS-wide
 * keyword, is not a size of its own.
 */
export function typeSizeCheck(value) {
    if (VARIABLE_ONLY.test(value) || CSS_WIDE.test(value)) return null;
    const range = sizeRange(value);
    return range && range.lo < 12 ? 'sub-12px-type' : 'arbitrary-type-size';
}

/** The size in a `font` shorthand, before any `/line-height`: `italic 10px/1.5 serif` holds `10px`; null for none. */
function fontShorthandSize(value) {
    const words = value.match(/(?:[^\s(]|\([^)]*\))+/g) ?? [];
    return words.map((word) => word.split('/')[0]).find((word) => word !== '' && sizeRange(word) !== null) ?? null;
}

/** A style key as CSS names it: `fontSize` is `font-size`, `Z-INDEX` is `z-index`. */
export const cssName = (key) => (/^[a-z][a-zA-Z]*$/.test(key) ? key.replace(/[A-Z]/g, (letter) => `-${letter}`) : key)
    .toLowerCase();

/**
 * The check a layer or a type size breaks, however it is written: a
 * `z-index` that holds a number, a `font-size` — or a `font` shorthand's size
 * — off the scale or below the floor. A number is a layer, or px, as React
 * writes one. A value that is not a size CSS computes (`'Auto'`, `'inherit'`)
 * sets none; any other name is not judged here.
 */
export function layerOrSizeCheck(name, value) {
    if (name === 'z-index') return numericLayer(String(value)) ? 'raw-z-index' : null;
    const text = typeof value === 'number' ? `${value}px` : value;
    if (typeof text !== 'string' || (name !== 'font-size' && name !== 'font')) return null;
    const size = name === 'font' ? fontShorthandSize(text) : text.trim();
    return size !== null && sizeRange(size) !== null ? typeSizeCheck(size) : null;
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
const ARBITRARY = /(?<![\w[\]-])(?:-?([a-z][a-z\d]*(?:-[a-z\d]+)*?)-\[([^\]\s]+)\]|\[(--[\w-]+|[a-zA-Z][\w-]*):([^\]\s]+)\])(?!:)/g;

/*
 * Markup and style text: a declaration, where one starts (`background:
 * #ffffff`, `style="color:red"`, `:root { --accent: #fff }`), and a
 * presentation attribute (`fill="#004C68"`). `#` is not always a colour, so
 * each names its context: an anchor (`#main`), a gradient reference
 * (`url(#id)`), an id selector or a link (`https://…#add`) stays silent, and
 * "Pick a color: red" in prose is not a declaration.
 */
const DECLARATION = /(?:^|[{;"'`])\s*(-{0,2}[a-zA-Z][\w-]*)\s*:(?!\/\/)\s*['"]?([^;{}"'`]+)/g;
const PRESENTATION = /(?<![\w-])(?:fill|stroke|stopColor|stop-color|floodColor|flood-color|lightingColor|lighting-color|color)\s*=\s*(["'])(.*?)\1/gi;
/** An SVG `font-size` attribute in markup: a number there is user units, which are px. */
const FONT_SIZE_ATTRIBUTE = /(?<![\w-])(?:font-size|fontSize)\s*=\s*(["'])(.*?)\1/gi;

/**
 * Every declaration in `text` whose value holds a raw colour: a hex or a colour
 * function under any property, a custom one included, and a colour keyword
 * under a property that takes a colour.
 */
export function colourDeclarationsIn(text) {
    return [...text.matchAll(DECLARATION)].flatMap((match) => {
        const [whole, property, value] = match;
        if (!holdsRawColour(value, { words: COLOUR_PROPERTY.test(property.toLowerCase()) })) return [];
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
        const check = arbitraryCheck(utility, property?.toLowerCase() ?? null, utility === null ? propertyValue : value);
        if (check) found.push({ check, match: whole, index: match.index });
    }
    found.push(...colourDeclarationsIn(text));
    // A style string is held to what a stylesheet is: no numeric layer, no type below the floor.
    for (const match of text.matchAll(DECLARATION)) {
        const [whole, property, value] = match;
        const check = layerOrSizeCheck(property.toLowerCase(), value);
        if (check === 'raw-z-index' || check === 'sub-12px-type') {
            const index = match.index + whole.indexOf(property);
            found.push({ check, match: text.slice(index, match.index + whole.length).trim(), index });
        }
    }
    for (const match of text.matchAll(PRESENTATION)) {
        if (holdsRawColour(match[2])) found.push({ check: 'raw-hex-colour', match: match[0], index: match.index });
    }
    for (const match of text.matchAll(FONT_SIZE_ATTRIBUTE)) {
        const value = match[2].trim();
        const check = layerOrSizeCheck('font-size', /^[\d.]+$/.test(value) ? Number(value) : value);
        if (check === 'sub-12px-type') found.push({ check, match: match[0], index: match.index });
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
