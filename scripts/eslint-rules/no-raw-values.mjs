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
 * (`ctx.strokeStyle = '#333'`, `const INK = '#0f172a'`), and a number in a
 * style object's layer (`{ zIndex: 20 }`, `{ zIndex: 'calc(100)' }`).
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
import { staticString } from './jsx.mjs';
import {
    REMEDIES, holdsRawColour, isColour, numericLayer, rawValuesIn,
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
const Z_INDEX_KEY = new Set(['zIndex', 'z-index']);

const keyName = (property) => {
    if (property.computed) return null;
    if (property.key.type === 'Identifier') return property.key.name;
    return typeof property.key.value === 'string' ? property.key.value : null;
};

/** The name an assignment writes: `INK`, `ctx.fillStyle`'s `fillStyle`; null for a pattern. */
const targetName = (node) => {
    if (node?.type === 'Identifier') return node.name;
    if (node?.type === 'MemberExpression') return node.computed ? staticString(node.property) : node.property.name;
    return null;
};

/** A layer written as a number: `20`, `-1`, `'20'`, `'calc(100)'`. */
const stackingNumber = (node) => {
    if (node?.type === 'Literal' && typeof node.value === 'number') return String(node.value);
    if (node?.type === 'UnaryExpression' && node.operator === '-' && typeof node.argument.value === 'number') {
        return `-${node.argument.value}`;
    }
    const text = staticString(node);
    return text !== null && numericLayer(text) ? text.trim() : null;
};

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
        /** A whole string that is one colour, written to `name`; a keyword only when the name holds a colour. */
        const colourValue = (node, value, name) => {
            const text = staticString(value);
            if (text !== null && isColour(text, { words: COLOUR_NAME.test(name ?? '') })) report(node, 'raw-hex-colour', text);
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
                const text = PRESENTATION.has(name) || COLOUR_PROP.test(name) ? staticString(node.value) : null;
                if (text !== null && holdsRawColour(text)) report(node, 'raw-hex-colour', text);
            },
            Property(node) {
                const key = keyName(node);
                if (key === null) return;
                // A colour-taking key holds one anywhere in its value; any other key, as its whole value.
                const text = staticString(node.value);
                if (text !== null && (COLOUR_KEY.test(key) ? holdsRawColour(text) : isColour(text, { words: false }))) {
                    report(node, 'raw-hex-colour', `${key}: ${text}`);
                }
                if (Z_INDEX_KEY.has(key)) {
                    const value = stackingNumber(node.value);
                    if (value !== null) report(node, 'raw-z-index', `${key}: ${value}`);
                }
            },
            VariableDeclarator(node) { colourValue(node, node.init, targetName(node.id)); },
            AssignmentExpression(node) { colourValue(node, node.right, targetName(node.left)); },
            AssignmentPattern(node) { colourValue(node, node.right, targetName(node.left)); },
            PropertyDefinition(node) { colourValue(node, node.value, keyName(node)); },
        };
    },
};
