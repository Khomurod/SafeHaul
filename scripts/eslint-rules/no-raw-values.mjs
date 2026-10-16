/**
 * `ds/no-raw-values` — a raw colour, an arbitrary type size or an unnamed
 * stacking layer, where the strict theme cannot refuse it.
 *
 * Read in two places. Every string and template chunk, through
 * `./raw-values.mjs`: an arbitrary value or property in a class list
 * (`bg-[#000]/20`, `bg-[red]`, `text-[length:10px]`, `z-[calc(100)]`,
 * `[color:red]`), a colour declaration or a presentation attribute in a style
 * or markup string. And the syntax, for a colour the string alone does not
 * show is one: a presentation attribute or a colour prop
 * (`<path fill="#004C68">`, `<SignaturePad penColor="black">`), a style
 * property (`{ borderTop: '1px solid red' }`), an assignment
 * (`ctx.strokeStyle = '#333'`, `const INK = '#0f172a'`) and `setProperty`.
 * A layer written as a number, or a type size off the scale, is read wherever
 * a style names it — a key, an attribute, an assignment, a default or
 * `setProperty` (`{ zIndex: 20 }`, `<text fontSize={10}>`,
 * `node.style.zIndex = '9999'`) — since a style object may be named, nested
 * or returned before it reaches `style`; a value that is not a CSS size
 * (`fontSize: 'Auto'`, a field's own setting) sets none. Each is read on every
 * branch of a conditional (`color: dark ? '#fff' : '#000'`) and through
 * arithmetic (`6 + 4`, `'#' + 'fff'`); a layer or a size also through a name
 * the file binds once (`const NOTE = 10`), since a number alone is no style.
 *
 * A colour is a hex, a colour function or a colour keyword. A keyword counts
 * only where a colour is expected — a presentation attribute or colour prop, a
 * style property that takes one, an assignment to a name that holds one —
 * since `'green'` is as often a tone's name. Comments are not read; neither is
 * the text between JSX tags, which is prose and never a class list.
 */

import {
    CHECKS, exceptedChecks, locate, optionsSchema,
} from './context.mjs';
import { propertyKey, staticString, valuesYielded } from './jsx.mjs';
import {
    REMEDIES, colourDeclarationsIn, cssName, holdsRawColour, isColour, layerOrSizeCheck, rawValuesIn,
} from './raw-values.mjs';

/** The SVG presentation attributes that take a colour; any prop named for one (`penColor`) does too. */
const PRESENTATION = new Set([
    'fill', 'stroke', 'stopColor', 'stop-color', 'floodColor', 'flood-color', 'lightingColor', 'lighting-color', 'color',
]);
const COLOUR_PROP = /colou?r$/i;
/** A style property that takes a colour: `color`, `backgroundColor`, `borderTop`, `boxShadow`, `penColor`… */
const COLOUR_KEY = /^(?:color|background|border|outline|fill|stroke|text-?decoration|column-?rule)|(?:color|shadow)$/i;
/** A name that holds a colour: `fillStyle`, `shadowColor`, `INK`, `penColor`. */
const COLOUR_NAME = /(?:colou?r|style|fill|stroke|ink|background)$/i;
/** The style names read as a layer or a type size, as CSS names them. */
const LAYER_OR_SIZE = new Set(['z-index', 'font-size', 'font']);

/** The name an assignment writes: `INK`, `ctx.fillStyle`'s `fillStyle`; null for a pattern. */
const targetName = (node) => {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type === 'MemberExpression') return node.computed ? staticString(node.property) : node.property.name;
    return null;
};

/** The strings a value can be, on any branch: `dark ? '#fff' : '#000'` is both. */
const stringsYielded = (node, through = null) => valuesYielded(node, through).filter((value) => typeof value === 'string');

/**
 * The colour a value written under `name` holds, on some branch: anywhere in
 * it when the name is a colour-taking style (`border: '1px solid red'`), else
 * as the whole value — a keyword only when the name holds a colour.
 */
function colourIn(name, value, through = null) {
    const raw = COLOUR_KEY.test(name ?? '') ? (one) => holdsRawColour(one)
        : (one) => isColour(one, { words: COLOUR_NAME.test(name ?? '') });
    return stringsYielded(value, through).find(raw);
}

/**
 * The check a layer or a type size breaks on some value of `node`, and that
 * value: `open ? 50 : undefined` is 50, `6 + 4` is 10, and a name bound once
 * is followed (`const NOTE = 10`), unless it is a style name itself, which is
 * judged where it is written.
 */
function layerOrSize(name, node, sourceCode) {
    const through = { sourceCode, follows: (one) => !LAYER_OR_SIZE.has(cssName(one)) };
    for (const value of valuesYielded(node, through)) {
        const check = layerOrSizeCheck(name, value);
        if (check) return { check, value: String(value).trim() };
    }
    return null;
}

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Refuse a raw colour, an arbitrary type size or an unnamed stacking layer (roadmap §3).' },
        schema: optionsSchema(),
        messages: Object.fromEntries(CHECKS['no-raw-values'].map((check) => [check, `{{value}}: ${REMEDIES[check]}`])),
    },
    create(context) {
        const excepted = exceptedChecks(context);
        const { sourceCode } = context;
        const report = (node, check, value, loc) => {
            if (!excepted.has(check)) context.report({ node, loc, messageId: check, data: { value } });
        };
        const readText = (node, text) => {
            let from = 0;
            for (const { check, match } of rawValuesIn(text)) {
                const place = locate(sourceCode, node, match, from);
                from = place.next;
                report(node, check, match, place.loc);
            }
        };
        /** A layer or a type size written under `name` (`zIndex`, `font-size`) on some branch of `value`. */
        const styleValue = (node, name, value) => {
            const css = cssName(name ?? '');
            const found = LAYER_OR_SIZE.has(css) ? layerOrSize(css, value, sourceCode) : null;
            if (found) report(node, found.check, `${name}: ${found.value}`);
        };
        // A name bound once is followed to its colour (`color: ALERT`), unless
        // its own binding already holds one, which is judged where it is written.
        const colours = { sourceCode, follows: (name, value) => colourIn(name, value) === undefined };
        /** A colour written to `name` on some branch (`colourIn`), reported at `node`. */
        const colourValue = (node, value, name) => {
            const text = colourIn(name, value, colours);
            if (text !== undefined) report(node, 'raw-hex-colour', text);
        };
        return {
            Literal(node) {
                if (typeof node.value === 'string') readText(node, node.value);
            },
            TemplateElement(node) {
                readText(node, node.value.cooked ?? node.value.raw);
            },
            JSXAttribute(node) {
                const name = node.name?.name;
                if (typeof name !== 'string') return;
                styleValue(node, name, node.value);
                if (!PRESENTATION.has(name) && !COLOUR_PROP.test(name)) return;
                const text = stringsYielded(node.value, colours).find((one) => holdsRawColour(one));
                if (text !== undefined) report(node, 'raw-hex-colour', text);
            },
            Property(node) {
                const key = propertyKey(node);
                if (key === null) return;
                const text = colourIn(key, node.value, colours);
                if (text !== undefined) report(node, 'raw-hex-colour', `${key}: ${text}`);
                styleValue(node, key, node.value);
            },
            // `node.style.setProperty('z-index', '9999')` is a declaration, read as one.
            CallExpression(node) {
                const { callee } = node;
                if (callee.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'setProperty') return;
                const name = staticString(node.arguments[0])?.trim().toLowerCase();
                if (!name) return;
                const found = LAYER_OR_SIZE.has(name) ? layerOrSize(name, node.arguments[1], sourceCode) : null;
                if (found) report(node, found.check, `${name}: ${found.value}`);
                const colour = stringsYielded(node.arguments[1], colours)
                    .find((one) => colourDeclarationsIn(`${name}: ${one}`).length > 0);
                if (colour !== undefined) report(node, 'raw-hex-colour', `${name}: ${colour}`);
            },
            VariableDeclarator(node) {
                colourValue(node, node.init, targetName(node.id));
                styleValue(node, targetName(node.id), node.init);
            },
            AssignmentExpression(node) {
                colourValue(node, node.right, targetName(node.left));
                styleValue(node, targetName(node.left), node.right);
            },
            AssignmentPattern(node) {
                colourValue(node, node.right, targetName(node.left));
                styleValue(node, targetName(node.left), node.right);
            },
            PropertyDefinition(node) {
                colourValue(node, node.value, propertyKey(node));
                styleValue(node, propertyKey(node), node.value);
            },
        };
    },
};
