import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config.js';
import {
  colourDeclarationsIn, colourLiteralsIn, holdsRawColour, numericLayer, rawValuesIn, typeSizeCheck,
} from '../../scripts/eslint-rules/raw-values.mjs';

/**
 * The stylesheets under `src/` reach colours, stacking layers and type sizes
 * through the `--ds-*` roles, and nothing else.
 *
 * Colour is declared in `tokens/foundation.css` and given meaning in
 * `tokens/semantic.css`: those two are the only files allowed to name one, and
 * they are exempt by path. Every other stylesheet — the design system's own
 * component sheets included, since a hex in `Button.css` is the same defect as
 * one in a screen — is held to four rules: no raw colour, no bare `z-index`, no
 * text below the 12px floor, and an `@apply` list held to the class rules a
 * `className` is (`scripts/eslint-rules/raw-values.mjs`, which the lint rule
 * `ds/no-raw-values` reads JavaScript with).
 *
 * Fixtures that hold an arbitrary class are built rather than written:
 * Tailwind's content scan reads test files, and a literal arbitrary class would
 * compile into the application's stylesheet.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TOKEN_DEFINITIONS = ['src/design-system/tokens/foundation.css', 'src/design-system/tokens/semantic.css'];

/** `/* … *\/` only: in a stylesheet `//` is part of a URL. Newlines kept, so lines still count. */
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''));

/** An `@apply` list is a class list: a raw value, or the `fixed inset-0` of a hand-built overlay. */
const offContractApply = (list) => {
  const classes = list.split(/\s+/);
  const overlay = classes.includes('fixed') && classes.includes('inset-0') ? ['fixed inset-0'] : [];
  return [...rawValuesIn(list).map((found) => found.match), ...overlay];
};

/*
 * A hex or a colour function anywhere, and a colour keyword where a declaration
 * expects a colour (`color: red`, `border: 1px solid tan`). The system colours a
 * `forced-colors` block must use (`Canvas`, `Highlight`) are not raw.
 */
const rawColours = (css) => [
  ...colourLiteralsIn(css),
  ...colourDeclarationsIn(css).map((found) => found.match).filter((match) => !holdsRawColour(match, { words: false })),
];

const RULES = {
  'a raw colour': rawColours,
  // Each declaration's whole value, read as the class rules read one: `calc(100)` is a number, `calc(10px)` 10px.
  'a bare z-index': (css) => [...css.matchAll(/z-index\s*:\s*([^;}]+)/g)]
    .filter(([, value]) => numericLayer(value)).map(([declaration]) => declaration),
  'a font size below 12px': (css) => [...css.matchAll(/font-size\s*:\s*([^;}]+)/g)]
    .filter(([, value]) => typeSizeCheck(value.trim()) === 'sub-12px-type').map(([declaration]) => declaration),
  'an @apply list off the class contract': (css) => [...css.matchAll(/@apply\s+([^;{}]+);/g)]
    .flatMap((apply) => offContractApply(apply[1])),
};
const findings = (css, rule) => RULES[rule](withoutComments(css));

function stylesheets(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return stylesheets(full);
    return entry.name.endsWith('.css') ? [path.relative(repoRoot, full).split(path.sep).join('/')] : [];
  });
}
const governed = stylesheets(path.join(repoRoot, 'src')).filter((file) => !TOKEN_DEFINITIONS.includes(file));

const arbitrary = (utility, value) => `${utility}-[${value}]`;

async function compileWithAppTheme(css) {
  const result = await postcss([
    tailwindcss({ ...tailwindConfig, content: [{ raw: '', extension: 'html' }] }),
  ]).process(css, { from: undefined });
  return result.css;
}

describe('the stylesheet contract', () => {
  /* A walk that reads nothing passes everything, so the floor is part of the rule. */
  it('reads every stylesheet under src/ except the two that define the tokens', () => {
    expect(governed.length).toBeGreaterThanOrEqual(20);
    expect(TOKEN_DEFINITIONS.every((file) => fs.existsSync(path.join(repoRoot, file)))).toBe(true);
    expect(governed).toContain('src/index.css');
  });

  it.each(Object.keys(RULES))('no stylesheet holds %s', (rule) => {
    const offending = governed
      .map((file) => [file, findings(fs.readFileSync(path.join(repoRoot, file), 'utf8'), rule)])
      .filter(([, found]) => found.length > 0);
    expect(offending).toEqual([]);
  });

  it.each([
    ['a raw colour', '.x { color: #fff; }', 1],
    ['a raw colour', '.x { background: rgba(0, 0, 0, 0.2); border-color: hsl(0 0% 0%); }', 2],
    ['a raw colour', '.x { color: var(--ds-color-content); }', 0],
    ['a raw colour', '.x { color: red; border: 1px solid rebeccapurple; }', 2],
    ['a raw colour', '.x { background: oklch(50% 0.2 20); outline-color: hwb(0 0% 0%); }', 2],
    ['a raw colour', '.x { background: color-mix(in srgb, var(--ds-color-surface) 50%, var(--ds-color-content)); }', 1],
    ['a raw colour', '.x { --tint: light-dark(var(--ds-color-content), var(--ds-color-surface)); }', 1],
    ['a raw colour', '.x { border-color: transparent; fill: currentColor; animation: highlight 1s; }', 0],
    ['a raw colour', '@media (forced-colors: active) { .x { border-bottom-color: Highlight; } }', 0],
    ['a bare z-index', '.x { z-index: 60; }', 1],
    ['a bare z-index', '.x { z-index: -1; }', 1],
    ['a bare z-index', '.x { z-index: var(--ds-z-modal); }', 0],
    ['a bare z-index', '.x { z-index: calc(100); }', 1],
    ['a bare z-index', '.x { z-index: calc(var(--ds-z-modal) + 1); }', 1],
    ['a bare z-index', '.x { z-index: auto; }', 0],
    ['a font size below 12px', '.x { font-size: 11px; }', 1],
    ['a font size below 12px', '.x { font-size: 12px; }', 0],
    ['a font size below 12px', '.x { font-size: var(--ds-font-size-xs); }', 0],
    ['a font size below 12px', '.x { font-size: calc(10px); }', 1],
    ['a font size below 12px', '.x { font-size: 0.6875rem; }', 1],
    ['a font size below 12px', '.x { font-size: clamp(12px, 2vw, 14px); }', 0],
    ['an @apply list off the class contract', `.x { @apply ${arbitrary('bg', '#ff0000')} ${arbitrary('text', '10px')}; }`, 2],
    ['an @apply list off the class contract', `.x { @apply ${arbitrary('z', '55')}; }`, 1],
    ['an @apply list off the class contract', '.x { @apply fixed inset-0; }', 1],
    ['an @apply list off the class contract', '.x { @apply bg-ds-surface rounded-ds-md text-ds-body; }', 0],
    ['a raw colour', '/* was #ffffff */ .x { color: var(--ds-color-content); }', 0],
  ])('%s: %s → %i', (rule, css, expected) => {
    expect(findings(css, rule)).toHaveLength(expected);
  });

  /*
   * The class rules a theme holds need no reading here: an `@apply` of a class
   * the strict theme does not define is a build error, so it cannot ship.
   */
  it.each(['bg-blue-600', 'text-white', 'text-xs', 'rounded', 'rounded-lg', 'shadow', 'shadow-sm', 'z-10'])(
    'refuses to build an @apply of the Tailwind default %s',
    async (name) => {
      await expect(compileWithAppTheme(`.x { @apply ${name}; }`)).rejects.toThrow(/does not exist/);
    },
  );

  it('builds an @apply of the design-system utilities', async () => {
    await expect(compileWithAppTheme('.x { @apply bg-ds-surface rounded-ds-md shadow-ds-sm z-ds-modal; }'))
      .resolves.toMatch(/var\(--ds-color-surface\)/);
  });
});
