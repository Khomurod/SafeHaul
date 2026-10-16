/**
 * `ds/no-raw-values` — a raw colour, an arbitrary type size or an unnamed
 * stacking layer, where the strict theme cannot refuse it.
 *
 * Read in two places. Every string and template chunk, through
 * `./raw-values.mjs`: an arbitrary value in a class list (`bg-[#000]/20`,
 * `text-[10px]`, `text-[17px]`, `z-[9999]`), a colour declaration or a
 * presentation attribute in a style or markup string. And the syntax, for a
 * colour the string alone does not show is one: a presentation attribute
 * (`<path fill="#004C68">`), a style property (`{ color: '#fff' }`), an
 * assignment (`ctx.strokeStyle = '#333'`, `const INK = '#0f172a'`), and a bare
 * number in a style object (`{ zIndex: 20 }`).
 *
 * Comments are not read; neither is the text between JSX tags, which is prose
 * and never a class list.
 */

import {
    CHECKS, exceptedChecks, locate, optionsSchema,
} from './context.mjs';
import { staticString } from './jsx.mjs';
import { REMEDIES, rawValuesIn } from './raw-values.mjs';

/** The SVG presentation attributes that take a colour. */
const PRESENTATION = new Set([
    'fill', 'stroke', 'stopColor', 'stop-color', 'floodColor', 'flood-color', 'lightingColor', 'lighting-color', 'color',
]);
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const STARTS_WITH_HEX = /^#[0-9a-fA-F]{3,8}\b/;
/** A style property that takes a colour: `color`, `background`, `borderColor`, `fill`, `stroke`… */
const COLOUR_KEY = /(?:color|background|border|fill|stroke)$/i;
const Z_INDEX_KEY = new Set(['zIndex', 'z-index']);

const keyName = (property) => {
    if (property.computed) return null;
    if (property.key.type === 'Identifier') return property.key.name;
    return typeof property.key.value === 'string' ? property.key.value : null;
};

/** A number written as one: `20`, `-1`, `'20'`. */
const stackingNumber = (node) => {
    if (node?.type === 'Literal' && typeof node.value === 'number') return String(node.value);
    if (node?.type === 'UnaryExpression' && node.operator === '-' && typeof node.argument.value === 'number') {
        return `-${node.argument.value}`;
    }
    const text = staticString(node);
    return text !== null && /^-?\d+$/.test(text.trim()) ? text.trim() : null;
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
        const hexValue = (node, value) => {
            const text = staticString(value);
            if (text !== null && HEX.test(text)) report(node, 'raw-hex-colour', text);
        };
        return {
            Literal(node) {
                if (typeof node.value === 'string') readText(node, node.value);
            },
            TemplateElement(node) {
                readText(node, node.value.cooked ?? node.value.raw);
            },
            JSXAttribute(node) {
                if (PRESENTATION.has(node.name?.name)) hexValue(node, node.value);
            },
            Property(node) {
                const key = keyName(node);
                if (key === null) return;
                if (COLOUR_KEY.test(key)) {
                    const text = staticString(node.value);
                    if (text !== null && STARTS_WITH_HEX.test(text)) report(node, 'raw-hex-colour', `${key}: ${text}`);
                }
                if (Z_INDEX_KEY.has(key)) {
                    const value = stackingNumber(node.value);
                    if (value !== null) report(node, 'raw-z-index', `${key}: ${value}`);
                }
            },
            VariableDeclarator(node) { hexValue(node, node.init); },
            AssignmentExpression(node) { hexValue(node, node.right); },
            AssignmentPattern(node) { hexValue(node, node.right); },
            PropertyDefinition(node) { hexValue(node, node.value); },
        };
    },
};
