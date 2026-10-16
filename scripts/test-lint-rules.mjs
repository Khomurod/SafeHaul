#!/usr/bin/env node
/**
 * The lint rules whose violation is a broken screen or a broken contract,
 * driven through ESLint's own API on sample code. A rule switched off, scoped to
 * the wrong files or left at "warn" reports the same clean run as one that found
 * nothing, so each is shown refusing.
 *
 *   npm run test:lint-rules
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eslint = new ESLint({ cwd: repoRoot });
let failures = 0;
const assert = (label, condition, detail = '') => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    if (!condition) failures += 1;
};

/** The rules that report an error for `code` placed at `path`. */
async function errorsFor(code, path) {
    const [result] = await eslint.lintText(code, { filePath: resolve(repoRoot, path) });
    return result.messages.filter((message) => message.severity === 2).map((message) => message.ruleId ?? message.message);
}

/*
 * A rule holds only where ESLint looks, and ESLint here lints JavaScript alone:
 * a `.ts` or `.tsx` file under src/ would reach no lint rule at all. So the
 * files a rule must reach are read from git, TypeScript included, and a new
 * file is judged in the pull request that adds it.
 */
const sourceFiles = execFileSync('git', ['ls-files', '-z', 'src'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter((file) => /\.(?:[jt]sx?|mjs|cjs)$/.test(file));

/*
 * An `eslint-disable` comment silences any lint rule, and the checks these
 * rules replaced had no such door. So every file holding an ESLint comment, the
 * only way to switch a rule off from inside a file, is linted once more with
 * inline configuration ignored, for one rule alone: what a comment hides, this
 * run still sees. A file without one gets the ordinary lint, which the rule
 * cannot be talked out of.
 */
const holdsComment = (text) => text.includes('eslint');
const strictLinter = (ruleId) => new ESLint({
    cwd: repoRoot,
    allowInlineConfig: false,
    ruleFilter: (rule) => rule.ruleId === ruleId,
});

console.log('\nL. Glyphs come from the design system');
{
    const ways = {
        'an import': "import { Trash2 } from 'lucide-react';\nexport const glyph = Trash2;\n",
        'a deep import': "import Trash2 from 'lucide-react/dist/esm/icons/trash-2';\nexport const glyph = Trash2;\n",
        'a re-export': "export { Trash2 } from 'lucide-react';\n",
        'an export of everything': "export * from 'lucide-react';\n",
        'a dynamic import': "export const load = () => import('lucide-react');\n",
        'a dynamic import in backticks': 'export const load = () => import(`lucide-react`);\n',
        'a dynamic deep import built from a name': 'export const load = (name) => import(`lucide-react/dist/esm/icons/${name}`);\n',
        'a require': "const { Trash2 } = require('lucide-react');\nexport const glyph = Trash2;\n",
        'a require in backticks': 'const { Trash2 } = require(`lucide-react`);\nexport const glyph = Trash2;\n',
    };
    for (const [way, code] of Object.entries(ways)) {
        const errors = await errorsFor(code, 'src/features/example/Widget.jsx');
        assert(`L1. ${way} of lucide-react under src/ is an error`, errors.includes('no-restricted-syntax'), errors.join(', '));
    }
    const elsewhere = [];
    for (const path of ['src/App.jsx', 'src/shared/components/Widget.jsx', 'src/design-system/components/x/Widget.jsx']) {
        if (!(await errorsFor(ways['an import'], path)).includes('no-restricted-syntax')) elsewhere.push(path);
    }
    assert('L1b. and so it is anywhere else under src/', elsewhere.length === 0, elsewhere.join(', '));
    const registry = await errorsFor(ways['an import'], 'src/design-system/icons/glyphs.js');
    assert('L2. the icons directory may import it', !registry.includes('no-restricted-syntax'), registry.join(', '));
    const viaRegistry = await errorsFor("import { Icon, Trash2 } from '@design-system/icons';\nexport const a = [Icon, Trash2];\n",
        'src/features/example/Widget.jsx');
    const lookalike = await errorsFor(
        "import x from 'lucide-reactive';\nexport const a = x;\nexport const load = () => import(`lucide-reactive`);\n",
        'src/features/example/Widget.jsx',
    );
    assert('L3. glyphs from the registry pass, and so does a package that only starts with the name',
        !viaRegistry.includes('no-restricted-syntax') && !lookalike.includes('no-restricted-syntax'),
        [...viaRegistry, ...lookalike].join(', '));

    // Every source file the replaced checker governed must be one this rule reaches.
    const governed = sourceFiles.filter((file) => !file.startsWith('src/design-system/icons/'));
    const unreached = [];
    for (const file of governed) {
        const config = await eslint.calculateConfigForFile(file);
        const [severity, ...options] = [config?.rules?.['no-restricted-syntax']].flat();
        const reached = severity === 2 && options.some((option) => /lucide-react/.test(option?.message ?? ''));
        if (!reached) unreached.push(file);
    }
    // A listing that came back empty would pass over nothing.
    const unlisted = ['src/features/', 'src/shared/', 'src/design-system/']
        .filter((root) => !governed.some((file) => file.startsWith(root)));
    assert(`L4. the rule reaches every source file under src/ outside icons/ (${governed.length})`,
        unlisted.length === 0 && unreached.length === 0,
        unreached.length > 0
            ? `${unreached.slice(0, 5).join(', ')}: ESLint does not apply the rule here; lint the file type before adding one`
            : `git listed no source file under ${unlisted.join(', ')}`);

    /*
     * The files linted again are chosen by the comment, not by the package name:
     * an escaped specifier (`'lucide\u002dreact'`) is the package to ESLint and
     * to Vite and invisible to a text search, while a directive is always plain
     * text.
     */
    const strict = strictLinter('no-restricted-syntax');
    const refusedStrictly = async (code) => {
        const [result] = await strict.lintText(code, { filePath: resolve(repoRoot, 'src/features/example/Widget.jsx') });
        return result.messages.some((message) => message.severity === 2 && /lucide-react/.test(message.message));
    };
    const disabled = {
        'a disable comment on the line': "// eslint-disable-next-line no-restricted-syntax\nimport { Trash2 } from 'lucide-react';\nexport const glyph = Trash2;\n",
        'a disable comment for the file': "/* eslint-disable */\nimport { Trash2 } from 'lucide-react';\nexport const glyph = Trash2;\n",
        'a rule switched off inline': "/* eslint no-restricted-syntax: off */\nimport { Trash2 } from 'lucide-react';\nexport const glyph = Trash2;\n",
        'an escaped name under a disable comment': "// eslint-disable-next-line no-restricted-syntax\nimport { Trash2 } from 'lucide\\u002dreact';\nexport const glyph = Trash2;\n",
    };
    const hiddenSamples = [];
    for (const [way, code] of Object.entries(disabled)) {
        if (!holdsComment(code) || !(await refusedStrictly(code))) hiddenSamples.push(way);
    }
    assert('L5. a comment that switches the rule off does not hide an import from this test',
        hiddenSamples.length === 0, hiddenSamples.join(', '));
    const commented = governed.filter((file) => holdsComment(readFileSync(resolve(repoRoot, file), 'utf8')));
    const hidden = commented.length === 0 ? [] : (await strict.lintFiles(commented))
        .filter((result) => result.messages.some((message) => message.severity === 2 && /lucide-react/.test(message.message)))
        .map((result) => relative(repoRoot, result.filePath));
    assert(`L5b. and no file under src/ hides one behind a comment (${commented.length} hold an ESLint comment)`,
        hidden.length === 0, `${hidden.join(', ')}: import glyphs from @design-system/icons`);
}

console.log('\nM. Lint refuses what would crash a screen');
{
    const undefinedTag = await errorsFor('export const Row = () => <Icon />;\n', 'src/features/example/Row.jsx');
    assert('M1. a JSX tag whose component is not in scope is an error',
        undefinedTag.includes('react/jsx-no-undef'), undefinedTag.join(', '));
    const conditionalHook = await errorsFor(
        "import { useState } from 'react';\nexport function Row({ on }) {\n  if (on) useState(0);\n  return null;\n}\n",
        'src/features/example/Row.jsx',
    );
    assert('M2. a hook called conditionally is an error',
        conditionalHook.includes('react-hooks/rules-of-hooks'), conditionalHook.join(', '));
}

console.log('\nN. No blocking browser dialogs');
{
    /*
     * `alert`, `confirm` and `prompt` freeze the tab and cannot be styled or
     * announced: confirmations use `ConfirmDialog`, notices a toast or a
     * `FieldMessage`. Tests may stub and call them.
     */
    const widget = 'src/features/example/Widget.jsx';
    const calls = {
        'confirm()': "export const ask = () => confirm('Delete?');\n",
        'alert()': "export const tell = () => alert('Saved');\n",
        'prompt()': "export const ask = () => prompt('Name?');\n",
        'window.confirm()': "export const ask = () => window.confirm('Delete?');\n",
        "window['confirm']()": "export const ask = () => window['confirm']('Delete?');\n",
        'globalThis.alert()': "export const tell = () => globalThis.alert('Saved');\n",
        'window.confirm?.()': "export const ask = () => window.confirm?.('Delete?');\n",
        'a call inside a template literal': "export const ask = () => `${confirm('Delete?')}`;\n",
    };
    const missed = [];
    for (const [way, code] of Object.entries(calls)) {
        if (!(await errorsFor(code, widget)).includes('no-alert')) missed.push(way);
    }
    assert('N1. every way of calling a blocking browser dialog under src/ is an error', missed.length === 0, missed.join(', '));
    const lookalikes = await errorsFor(
        "const confirm = (text) => text;\nexport const a = (toast, dialog) => [confirm('x'), toast.alert('x'), dialog.confirm('x')];\n",
        widget,
    );
    const inTest = await errorsFor("export const stubbed = () => window.confirm('Delete?');\n", 'src/features/example/Widget.test.jsx');
    assert('N2. a function of its own, a method of another object and a test pass',
        !lookalikes.includes('no-alert') && !inTest.includes('no-alert'), [...lookalikes, ...inTest].join(', '));

    const production = sourceFiles.filter((file) => !/\.(?:test|spec)\.[^/]+$/.test(file));
    const unreached = [];
    for (const file of production) {
        const config = await eslint.calculateConfigForFile(file);
        if ([config?.rules?.['no-alert']].flat()[0] !== 2) unreached.push(file);
    }
    assert(`N3. the rule reaches every source file under src/ that is not a test (${production.length})`,
        production.length > 0 && unreached.length === 0,
        unreached.length > 0 ? `${unreached.slice(0, 5).join(', ')}: ESLint does not apply the rule here` : 'git listed no source file');

    const strict = strictLinter('no-alert');
    const hiddenSample = "// eslint-disable-next-line no-alert\nexport const ask = () => window.confirm('Delete?');\n";
    const [sample] = await strict.lintText(hiddenSample, { filePath: resolve(repoRoot, widget) });
    assert('N4. a comment that switches the rule off does not hide a call from this test',
        holdsComment(hiddenSample) && sample.messages.some((message) => message.ruleId === 'no-alert'));
    const commented = production.filter((file) => holdsComment(readFileSync(resolve(repoRoot, file), 'utf8')));
    const hidden = commented.length === 0 ? [] : (await strict.lintFiles(commented))
        .filter((result) => result.messages.some((message) => message.ruleId === 'no-alert'))
        .map((result) => relative(repoRoot, result.filePath));
    assert(`N4b. and no file under src/ hides one behind a comment (${commented.length} hold an ESLint comment)`,
        hidden.length === 0, `${hidden.join(', ')}: use ConfirmDialog, a toast or a FieldMessage`);
}

console.log('\nO. The design-system contract a strict theme cannot hold');
{
    /*
     * The Tailwind theme compiles nothing for a default colour, type size,
     * radius, shadow or layer. What it cannot refuse — an arbitrary value, a hex
     * in a style or an assignment, a native table, markup the design system
     * already builds — is held by `ds/no-raw-values`, `ds/native-table` and
     * `ds/use-primitive` (`scripts/eslint-rules/`). The cases are the ones the
     * UI-contract checker's fixtures pinned for the same checks, plus a few
     * shapes the port reads that the checker never tried. Every fixture must
     * parse: a sample ESLint cannot read reports nothing, which would pass every
     * "stays silent" assertion for the wrong reason.
     */
    const widget = 'src/features/example/Widget.jsx';
    const checksFor = async (code, path = widget, linter = eslint) => {
        const [result] = await linter.lintText(code, { filePath: resolve(repoRoot, path) });
        return result.messages
            .filter((message) => message.fatal || (message.severity === 2 && message.ruleId?.startsWith('ds/')))
            .map((message) => (message.fatal ? `parse error: ${message.message}` : message.messageId));
    };
    const view = (jsx, statements = '') => `${statements}\nexport const View = () => (<>${jsx}</>);\n`;
    const count = (checks, check) => checks.filter((one) => one === check).length;

    const defects = [
        ['raw-hex-colour', 'an arbitrary colour class', view('<div className="bg-[#ff0000]" />')],
        ['raw-hex-colour', 'an SVG attribute', view('<path fill="#004C68" />')],
        ['raw-hex-colour', 'a gradient stop', view('<stop stopColor="#0CE1A5" />')],
        ['raw-hex-colour', 'a canvas-context assignment', "export function ink(ctx) {\n  ctx.strokeStyle = '#333';\n}\n"],
        ['raw-hex-colour', 'a declaration', "export const SIGNATURE_INK = '#0f172a';\n"],
        ['raw-hex-colour', 'a style property', view("<div style={{ color: '#fff' }} />")],
        ['raw-hex-colour', 'a style string', 'export const CSS = `html, body { background: #ffffff; }`;\n'],
        ['sub-12px-type', 'a sub-12px size', view('<span className="text-[10px]">x</span>')],
        ['arbitrary-type-size', 'an arbitrary size', view('<span className="text-[17px]">x</span>')],
        ['raw-z-index', 'an arbitrary layer', view('<div className="z-[9999]" />')],
        ['raw-z-index', 'a style-object layer', 'export const s = { position: "absolute", zIndex: 20 };\n'],
        // Every other arbitrary syntax Tailwind compiles (O1c proves each does).
        ['raw-hex-colour', 'a named colour', view('<div className="bg-[red]" />')],
        ['raw-hex-colour', 'a modern colour function', view('<div className="bg-[oklch(50%_0.2_20)]" />')],
        ['raw-hex-colour', 'a named colour on text', view('<span className="text-[rebeccapurple]">x</span>')],
        ['raw-hex-colour', 'a colour type hint', view('<div className="border-[color:red]" />')],
        ['raw-hex-colour', 'a colour inside a shadow', view('<div className="shadow-[0_0_0_1px_red]" />')],
        ['raw-hex-colour', 'a variable with a raw fallback', view('<div className="bg-[var(--brand,#fff)]" />')],
        ['raw-hex-colour', 'an arbitrary property', view('<div className="md:[color:red]" />')],
        ['raw-hex-colour', 'a named colour in a style property', view("<div style={{ borderColor: 'red' }} />")],
        ['raw-hex-colour', 'a colour inside a style shorthand', view("<div style={{ borderTop: '1px solid #ccc' }} />")],
        ['raw-hex-colour', 'a named colour in a colour prop', view('<SignaturePad penColor="black" />')],
        ['raw-hex-colour', 'a named colour in an SVG attribute', view('<path fill="red" />')],
        ['raw-hex-colour', 'a named colour on a canvas', "export function ink(ctx) {\n  ctx.fillStyle = 'black';\n}\n"],
        ['raw-hex-colour', 'a colour function in a declaration', "export const INK = 'rgb(15 23 42)';\n"],
        ['raw-hex-colour', 'a named colour in a style string', 'export const CSS = `body { color: red; }`;\n'],
        ['raw-hex-colour', 'a hex in an object', "export const palette = { primary: '#004C68' };\n"],
        ['raw-hex-colour', 'a colour on either branch of a style property', view("<div style={{ color: dark ? '#fff' : '#000' }} />")],
        ['raw-hex-colour', 'a colour on one branch of an SVG attribute', view("<path fill={on ? 'red' : 'none'} />")],
        ['raw-hex-colour', 'a colour on a branch of an assignment', "export function ink(ctx, on) {\n  ctx.fillStyle = on ? '#000' : 'currentColor';\n}\n"],
        ['raw-z-index', 'a layer on a branch of a style object', 'export const s = (open) => ({ zIndex: open ? 50 : undefined });\n'],
        ['raw-z-index', 'a layer in a style string', "export const CSS = '.x { z-index: 9999; }';\n"],
        ['sub-12px-type', 'a small size in a style string', "export const CSS = '.x { font-size: 10px; }';\n"],
        ['sub-12px-type', 'a small inline font size', view('<span style={{ fontSize: 10 }}>x</span>')],
        ['arbitrary-type-size', 'an inline font size off the scale', view("<span style={{ fontSize: on ? '17px' : 'inherit' }}>x</span>")],
        ['raw-hex-colour', 'a colour under a computed key', view("<div style={{ ['color']: '#fff' }} />")],
        ['raw-hex-colour', 'a colour under a capitalised property', "export const CSS = '.x { COLOR: #fff; }';\n"],
        ['raw-z-index', 'a layer under a capitalised property', "export const CSS = '.x { Z-INDEX: 999; }';\n"],
        ['sub-12px-type', 'a small size under a capitalised property', "export const CSS = '.x { FONT-SIZE: 10px; }';\n"],
        ['sub-12px-type', 'an inline font size in a spread', view('<span style={{ ...{ fontSize: 10 } }}>x</span>')],
        ['sub-12px-type', 'an inline font size in a conditional spread', view('<span style={{ ...(on ? { fontSize: 10 } : {}) }}>x</span>')],
        ['sub-12px-type', 'the smaller of two sizes', view('<span className="text-[min(10px,20px)]">x</span>')],
        ['sub-12px-type', 'a clamp that can fall below the floor', view('<span className="text-[clamp(10px,2vw,14px)]">x</span>')],
        ['arbitrary-type-size', 'a sum that clears the floor', view('<span className="text-[calc(10px+10px)]">x</span>')],
        ['raw-hex-colour', 'a mix of two roles', view('<div className="bg-[color-mix(in_srgb,var(--ds-color-surface)_50%,var(--ds-color-content))]" />')],
        ['raw-hex-colour', 'a light-dark pair', view('<div className="text-[light-dark(var(--ds-color-content),var(--ds-color-surface))]" />')],
        ['raw-hex-colour', 'a hex in a custom property', "export const CSS = ':root { --accent: #fff; }';\n"],
        ['raw-hex-colour', 'a colour function in a custom property', 'export const CSS = `.x { --tint: oklch(50% 0.2 20); }`;\n'],
        ['sub-12px-type', 'a typed size', view('<span className="text-[length:10px]">x</span>')],
        ['sub-12px-type', 'a calculated size', view('<span className="text-[calc(10px)]">x</span>')],
        ['sub-12px-type', 'a size in rem', view('<span className="text-[0.5rem]">x</span>')],
        ['sub-12px-type', 'a font-size property', view('<span className="[font-size:10px]">x</span>')],
        ['arbitrary-type-size', 'a clamped size', view('<span className="text-[clamp(0.75rem,2vw,1rem)]">x</span>')],
        ['arbitrary-type-size', 'a size keyword', view('<span className="text-[larger]">x</span>')],
        ['raw-z-index', 'a calculated layer', view('<div className="z-[calc(100)]" />')],
        ['raw-z-index', 'a layer counted from a named one', view('<div className="z-[calc(var(--ds-z-modal)+1)]" />')],
        ['raw-z-index', 'a z-index property', view('<div className="[z-index:9999]" />')],
        ['raw-z-index', 'a calculated style-object layer', "export const s = { zIndex: 'calc(100)' };\n"],
        ['hand-built-overlay', 'a fixed inset-0 class list', view('<div className="fixed inset-0 bg-ds-overlay" />')],
        ['hand-built-overlay', 'an overlayClassName', view('<Modal overlayClassName="fixed inset-0 z-50 flex bg-ds-overlay p-4">{body}</Modal>')],
        ['hand-built-overlay', 'the classes as two arguments', view("<div className={clsx('fixed', 'inset-0')} />")],
        ['hand-built-overlay', 'the classes concatenated', view("<div className={'fixed ' + 'inset-0'} />")],
        ['hand-built-overlay', 'the classes in a joined array', view("<div className={['fixed', open && 'inset-0'].filter(Boolean).join(' ')} />")],
        ['hand-built-overlay', 'the classes either side of a template hole', view("<div className={`fixed ${open ? 'inset-0' : ''}`} />")],
        ['hand-built-overlay', 'the classes as keys of a class map', view("<div className={clsx({ fixed: open, 'inset-0': open })} />")],
        ['hand-built-overlay', 'a class map beside a string', view("<div className={clsx('fixed', { 'inset-0': open })} />")],
        ['hand-built-overlay', 'a class map behind a condition', view("<div className={clsx(open && { fixed: true, 'inset-0': true })} />")],
        ['hand-built-overlay', 'two classes behind the same condition', view("<div className={clsx(open && 'fixed', open && 'inset-0')} />")],
        ['raw-table', 'a table outside the approved list', view('<table><tbody /></table>')],
        ['hand-styled-button', 'a styled button', view('<button className="px-4 py-2 bg-ds-surface rounded">Go</button>')],
        ['hand-styled-field', 'a styled input', view('<input className="border rounded px-3" />')],
        ['hand-styled-anchor', 'a styled anchor', view('<a href="/x" className="px-4 py-2 rounded border">Go</a>')],
        ['raw-file-input', 'a raw file input', view('<input type="file" />')],
        ['hand-rolled-tablist', 'a hand-rolled tab strip', view('<div role="tablist" />')],
        ['hand-written-target-blank', 'a hand-written new tab', view('<a href="https://x.example" target="_blank" rel="noreferrer">Docs</a>')],
        ['jsx-label-on-throwing-primitive', 'a JSX label', view('<FormField id="x" label={(<span>Date</span>)}>{c}</FormField>')],
        ['hand-rolled-toggle', 'a raw pressed button', view('<button type="button" aria-pressed={on}>Hired</button>')],
        ['hand-rolled-toggle', 'one behind an arrow function', view('<button onClick={() => go()} aria-pressed={on}>x</button>')],
        ['hand-rolled-toggle', 'a pressed anchor', view('<a href="/x" aria-pressed={on}>x</a>')],
        ['hand-rolled-current', 'a raw current button', view('<button aria-current="page">3</button>')],
        ['hand-rolled-disclosure', 'an expanding button in a heading', view('<h3 className="m-0"><button type="button" '
            + 'aria-expanded={showGuide} aria-controls="guide" className="flex w-full items-center">Title</button></h3>')],
    ];
    const missed = [];
    for (const [check, label, code] of defects) {
        const checks = await checksFor(code);
        if (count(checks, check) !== 1) missed.push(`${check} on ${label} (${checks.join(', ') || 'nothing'})`);
    }
    assert(`O1. each defect is refused exactly once, by its own check (${defects.length})`, missed.length === 0, missed.join('; '));

    const counted = [
        ['sub-12px-type', 2, view('<div className="text-[10px] md:text-[9px]" />')],
        ['raw-z-index', 2, view('<div className="z-[10]" /><div className="-z-[70]" />')],
        ['raw-hex-colour', 2, view('<div className="bg-[#1877F2]/10 text-[#1877F2]" />')],
        ['raw-hex-colour', 2, view('<div className="bg-[red] hover:text-[oklch(0.5_0.2_20)]" />')],
        ['sub-12px-type', 2, view('<div className="text-[length:10px] md:text-[calc(9px)]" />')],
        ['hand-built-overlay', 1, view("<div className={['fixed inset-0', on && 'fixed', 'inset-0'].join(' ')} />")],
        ['hand-built-overlay', 2, view('<div className="fixed inset-0 bg-ds-overlay" /><div className="inset-0 fixed flex" />')],
        ['hand-rolled-disclosure', 1, view('<h3 className="x" /><h3><button aria-expanded={o} /></h3>')],
        ['hand-rolled-disclosure', 1, view('<h3 onClick={() => f()} /><h3><button aria-expanded={o} /></h3>')],
        ['hand-rolled-disclosure', 2, view('<h3><button aria-expanded={a} /></h3><h3><button aria-expanded={b} /></h3>')],
        ['hand-rolled-disclosure', 1, view('<h3 onClick={() => focus()}><button aria-expanded={open} /></h3>')],
        ['hand-rolled-disclosure', 6, view([1, 2, 3, 4, 5, 6].map((n) => `<h${n}><button aria-expanded={o} /></h${n}>`).join(''))],
        ['jsx-label-on-throwing-primitive', 9, view(['FormField', 'FieldDisplay', 'Checkbox', 'Radio', 'Switch', 'IconButton',
            'IconButtonLink', 'FileInput', 'ProgressBar'].map((tag) => `<${tag} label={<span>x</span>} />`).join(''))],
    ];
    const miscounted = [];
    for (const [check, expected, code] of counted) {
        const checks = await checksFor(code);
        if (count(checks, check) !== expected) miscounted.push(`${check}: ${count(checks, check)} of ${expected} (${checks.join(', ')})`);
    }
    assert('O1b. every occurrence is reported, not just the first, and every heading level and throwing primitive is read',
        miscounted.length === 0, miscounted.join('; '));

    /*
     * The arbitrary forms O1 refuses are real: each compiles with the
     * application's own Tailwind configuration, so each would reach the screen.
     * And the colour keywords read are the ones Tailwind parses as colours.
     */
    const { default: postcss } = await import('postcss');
    const { default: tailwindcss } = await import('tailwindcss');
    const { default: appTheme } = await import('../tailwind.config.js');
    const compiles = async (name) => (await postcss([tailwindcss({ ...appTheme, content: [{ raw: name, extension: 'html' }] })])
        .process('@tailwind utilities;', { from: undefined })).css.trim() !== '';
    const forms = ['bg-[red]', 'bg-[oklch(50%_0.2_20)]', 'text-[rebeccapurple]', 'border-[color:red]', 'shadow-[0_0_0_1px_red]',
        'text-[min(10px,20px)]', 'text-[clamp(10px,2vw,14px)]', 'text-[calc(10px+10px)]',
        'bg-[color-mix(in_srgb,var(--ds-color-surface)_50%,var(--ds-color-content))]',
        'text-[light-dark(var(--ds-color-content),var(--ds-color-surface))]',
        'bg-[var(--brand,#fff)]', 'md:[color:red]', 'text-[length:10px]', 'text-[calc(10px)]', 'text-[0.5rem]', '[font-size:10px]',
        'text-[clamp(0.75rem,2vw,1rem)]', 'text-[larger]', 'z-[calc(100)]', 'z-[calc(var(--ds-z-modal)+1)]', '[z-index:9999]'];
    const inert = [];
    for (const name of forms) if (!(await compiles(name))) inert.push(name);
    const { COLOUR_WORDS } = await import('./eslint-rules/raw-values.mjs');
    const { default: colourNames } = await import('tailwindcss/lib/util/colorNames.js');
    const tailwindNames = Object.keys(colourNames.default ?? colourNames);
    const unread = tailwindNames.filter((name) => !COLOUR_WORDS.has(name));
    assert(`O1c. each arbitrary form O1 refuses compiles with the app's Tailwind (${forms.length}), and every colour name Tailwind parses is read (${tailwindNames.length})`,
        inert.length === 0 && unread.length === 0 && COLOUR_WORDS.size === tailwindNames.length,
        [...inert.map((name) => `${name} compiles to nothing`), ...unread.map((name) => `${name} is not read`)].join('; '));

    /*
     * The other half: a rule that fires on correct code gets switched off.
     * Each of these was a "stays silent" case for the same check.
     */
    const correct = {
        'semantic tokens': view('<div className="bg-ds-surface text-ds-content border-ds-border" />'),
        'the ds type scale': view('<span className="text-ds-xs">x</span><span className="text-ds-heading-md">y</span>'),
        'an unstyled button': view('<button type="button" onClick={go}>Go</button>'),
        'a layout-only button': view('<button type="button" className="flex items-center gap-ds-2">Go</button>'),
        'a plain anchor': view('<a href="/records">All records</a>'),
        'a design-system component': view('<Button variant="primary">Go</Button>'),
        'a Link with external': view('<Link href="https://x.example" external>Docs</Link>'),
        'the ds radius and shadow scales': view('<div className="rounded-ds-md rounded-t-ds-lg shadow-ds-xs focus-visible:shadow-ds-focus" />'),
        'a string label': view('<FormField id="x" label="Filter by date">{c}</FormField>'),
        'a JSX title on PageHeader, and a JSX label on Badge': view('<PageHeader title={(<span>My Profile</span>)} /><Badge label={<span>x</span>} />'),
        'currentColor, none, a token and a gradient reference': view('<path fill="currentColor" /><path fill="none" />'
            + '<path fill="var(--ds-color-brand-deep)" /><path fill="url(#paint0_linear_logo)" />'),
        'an in-page anchor and a hex-like placeholder': view('<a href="#main">Skip to content</a><input placeholder="#1234567" />'),
        'an id selector': "export const node = () => document.querySelector('#signature-canvas');\n",
        'named layers, a token in a style object, auto and a word ending in z': view('<div className="z-ds-modal z-ds-layer-2 lg:z-auto quiz-10" />')
            + "export const s = { zIndex: 'var(--ds-z-layer-2)' };\n",
        'a component carrying aria-pressed or aria-current': view('<Button aria-pressed={on}>SMS</Button><IconButton aria-pressed={on} label="x" />'
            + '<ChipGroup ariaLabel="Stage"><Chip pressed={on}>Hired</Chip></ChipGroup><SelectableCard current /><SectionNavigation aria-current="page" />'),
        'elements whose name only starts with a': view('<abbr aria-pressed="true">x</abbr><article aria-pressed="true" />'),
        'a step indicator that is read, not operated': view('<li aria-current="step">2. Map</li><span aria-current="step">3. Send</span>'),
        'an expanding trigger outside a heading': view('<nav><button type="button" aria-expanded={openSheet === key}>Open Fields</button></nav>'
            + '<div className="relative"><button aria-expanded={isOpen} aria-haspopup="menu" /></div>'
            + '<input type="text" aria-expanded={open} aria-autocomplete="list" />'),
        'a Button in a heading, and the primitive\'s own Heading': view('<h2><Button aria-expanded={rulesOpen} aria-controls="rules">Rules</Button></h2>'
            + '<Heading id={headingId}><button aria-expanded={isOpen} /></Heading>'),
        'a heading with no expanding button': view('<h3 className="m-0">Plain section title</h3><h3 /><h3><button type="button" onClick={save}>Save</button></h3>'),
        'a token, a keyword or a length in an arbitrary value': view('<div className="bg-[var(--ds-color-surface)] '
            + 'text-[color:var(--ds-color-content)] border-[color:currentColor] bg-[transparent] '
            + 'text-[length:var(--ds-font-size-xs)] z-[var(--ds-z-modal)] border-[14px] bg-[url(/hero.png)] grid-cols-[8rem_1fr]" />'),
        'a colour word where no colour is expected': view('<div className="transition-[background-color,box-shadow] '
            + "animate-[highlight_1s_ease-out] content-['red'] [mask-image:linear-gradient(black,transparent)]\" />")
            + "export const tone = 'green';\nexport const prompt = 'Pick a color: red or blue';\n",
        'arbitrary variants, which select rather than paint': view('<div className="data-[state=open]:bg-ds-surface '
            + 'group-[.red]:flex supports-[color:red]:flex [&_svg]:fill-current" />'),
        'a system colour, for forced colours': view('<div className="forced-colors:border-[Highlight]" />'),
        'an overlay\'s classes on exclusive branches': view("<div className={open ? 'fixed' : 'inset-0'} />"),
        'a call that chooses between classes, and an array never joined': "export const pick = selectClass('fixed', 'inset-0');\n"
            + "export const OPTIONS = ['fixed', 'inset-0', 'absolute'];\nexport const wrapped = describe(['fixed', 'inset-0']);\n",
        'a document field\'s font size, roles in a style string, and an inline size that inherits':
            "export const FIELD = { type: 'text', fontSize: 'Auto' };\n"
            + "export const CSS = '.x { z-index: var(--ds-z-modal); font-size: var(--ds-font-size-xs); }';\n"
            + view("<span style={{ fontSize: 'inherit' }}>x</span>"),
        'a role or a keyword on every branch': view("<div style={{ color: on ? 'var(--ds-color-content)' : 'inherit', zIndex: on ? 'var(--ds-z-modal)' : 'auto' }} />"),
        'a plain object whose keys only look like classes': "export const LABELS = { fixed: 'Fixed', 'inset-0': 'Inset' };\n"
            + "export const joined = [{ fixed: true }, 'inset-0'].join(' ');\n",
        'classes behind opposite conditions': view("<div className={clsx({ fixed: open, 'inset-0': !open })} />"
            + "<div className={clsx(open && 'fixed', !open && 'inset-0')} />"
            + "<div className={cn(open ? 'fixed' : '', open ? '' : 'inset-0')} />"),
        'class maps on exclusive branches': view("<div className={clsx(open ? { fixed: true } : { 'inset-0': true })} />"),
        'a custom property holding a role, and a link': "export const CSS = ':root { --accent: var(--ds-color-brand); }';\n"
            + "export const DOCS = 'https://example.com/guide#add';\n",
        'a violation named in a comment': '// this used to be text-[10px] and z-[9999]\n/* was bg-[#fff], target="_blank" and fixed inset-0 */\nexport const a = 1;\n',
    };
    const flagged = [];
    for (const [name, code] of Object.entries(correct)) {
        const checks = await checksFor(code);
        if (checks.length > 0) flagged.push(`${name} (${checks.join(', ')})`);
    }
    assert(`O2. correct code passes every design-system rule (${Object.keys(correct).length})`, flagged.length === 0, flagged.join('; '));

    // Class names live inside strings, so a string is read whatever holds it.
    const inStrings = {
        'a string': 'export const c = "text-[10px]";\n',
        'a string after a URL': 'export const u = "https://x.example"; export const c = "text-[10px]";\n',
        'a branch of a template': 'export const c = (on) => `px-2 ${on ? "text-[10px]" : "text-ds-xs"}`;\n',
        'a template chunk': 'export const c = (tone) => `text-[10px] ${tone}`;\n',
    };
    const unseen = [];
    for (const [name, code] of Object.entries(inStrings)) {
        if (count(await checksFor(code), 'sub-12px-type') !== 1) unseen.push(name);
    }
    assert('O2b. a class in any string is read, and one in a comment is not', unseen.length === 0, unseen.join(', '));

    /*
     * A class list held in a variable is the same control as the inline one,
     * and is judged only when that is provable: the file binds the name once, to
     * text that styles on every path. `className={props.className}` forwards a
     * class and styles nothing.
     */
    const field = async (code) => count(await checksFor(code), 'hand-styled-field');
    const hoistedRead = await field(view('<input className={c} />', 'const c = "px-ds-3 border rounded-ds-md bg-ds-surface";'));
    const perElement = await field(view('<textarea className={c} /><select className={c} /><input className={c} />', 'const c = "p-ds-3 border rounded-ds-md";'));
    const once = await field(view('<input className={c} data-tone="bg-ds-surface" />', 'const c = "p-ds-3 border";'));
    const branches = await field(view('<input className={c} />', 'const c = on ? "p-ds-3 border" : "bg-ds-surface p-ds-2";'))
        + await field(view('<input className={c} />', 'const c = `border rounded-ds-md ${tone}`;'));
    assert('O3. a hoisted class list counts like the inline one, per element, once, and on every certain branch',
        hoistedRead === 1 && perElement === 3 && once === 1 && branches === 2,
        `hoisted ${hoistedRead}, per element ${perElement}, both ways ${once}, branches ${branches}`);
    const unprovable = {
        'a forwarded className': view('<input className={props.className} />'),
        'a binding with no styling': view('<input className={c} />', 'const c = "flex gap-ds-2";'),
        'a spread that may replace the class': view('<input className={c} {...rest} />', 'const c = "p-ds-3 border";'),
        'a name the file rebinds': view('<input className={c} />', 'let c = "p-ds-3 border";\nc = pick();'),
        'a name a parameter shadows': view('<input className={c} />', 'const c = "p-ds-3 border";\nfunction g(c) { return c; }'),
        'an imported name': view('<input className={c} />', "import { c } from './x';"),
        'a component': view('<Thing className={c} />', 'const c = "p-ds-3 border";'),
        'a conditional with one unstyled branch': view('<input className={c} />', 'const c = on ? "p-ds-3 border" : "";'),
    };
    const judged = [];
    for (const [name, code] of Object.entries(unprovable)) {
        const checks = await checksFor(code);
        if (checks.length > 0) judged.push(`${name} (${checks.join(', ')})`);
    }
    assert('O3b. a class list that cannot be proved styled is not judged', judged.length === 0, judged.join('; '));

    /*
     * The native-table contract is ARMED by an exception, not satisfied by it:
     * every `<table>` in an approved file must carry `ds-native-table` on the
     * attribute that decides its class list, on every branch. These are the
     * bypasses that check was hardened against, one review round each.
     */
    const approvedAt = (path) => new ESLint({
        cwd: repoRoot,
        overrideConfig: { files: [path], rules: { 'ds/native-table': ['error', { exceptions: { [path]: { 'raw-table': 'a fixture approval, with a reason of its own' } } }] } },
    });
    const approvedFile = 'src/features/example/Approved.jsx';
    const approved = approvedAt(approvedFile);
    const offContract = {
        'a bare identifier': '<table className={cls} />',
        'a logical AND': "<table className={on && 'ds-native-table'} />",
        'a fallback after a computed class': "<table className={custom ?? 'ds-native-table'} />",
        'a function call': '<table className={pick()} />',
        'a glued template chunk': '<table className={`ds-native-table${x}`} />',
        'a lookalike token': '<table className="ds-native-table-broken" />',
        'a data-testid decoy': '<table data-testid="ds-native-table" className="p-2" />',
        'a spread after className': '<table className="ds-native-table" {...rest} />',
        'a later className': '<table className="ds-native-table" className={other} />',
    };
    const bypasses = [];
    for (const [name, jsx] of Object.entries(offContract)) {
        if (count(await checksFor(view(jsx), approvedFile, approved), 'off-contract') !== 1) bypasses.push(name);
    }
    assert('O4. an approved table off the ds-native-table contract is refused, whatever the bypass', bypasses.length === 0, bypasses.join(', '));
    const onContract = {
        'a string': '<table className="ds-native-table p-2" />',
        'a conditional tethered on both sides': "<table className={a ? 'ds-native-table x' : 'ds-native-table y'} />",
        'a template with a space before the hole': '<table className={`ds-native-table ${x}`} />',
        'a spread before className': '<table {...rest} className="ds-native-table" />',
        'a hidden table, which carries the class too': '<table className="sr-only ds-native-table" />',
    };
    const refusedCorrect = [];
    for (const [name, jsx] of Object.entries(onContract)) {
        const checks = await checksFor(view(jsx), approvedFile, approved);
        if (checks.length > 0) refusedCorrect.push(`${name} (${checks.join(', ')})`);
    }
    assert('O4b. and every form that certainly carries it passes', refusedCorrect.length === 0, refusedCorrect.join('; '));
    const designSystemTable = await checksFor(view('<table className={cls} />'), 'src/design-system/components/data-table/DataTable.jsx');
    const unlistedDesignSystem = await checksFor(view('<table className="ds-native-table" />'), 'src/design-system/components/x/Widget.jsx');
    const lookalikePath = 'src/features/notes/design-system-notes.jsx';
    const lookalike = await checksFor(view('<table className={cls} />'), lookalikePath, approvedAt(lookalikePath));
    assert('O4c. DataTable, the contract itself, is not asked for the class; the design system is not approved wholesale; a path that only mentions it is asked',
        designSystemTable.length === 0 && count(unlistedDesignSystem, 'raw-table') === 1 && count(lookalike, 'off-contract') === 1,
        `DataTable [${designSystemTable}], unlisted [${unlistedDesignSystem}], lookalike [${lookalike}]`);

    /*
     * Where each rule reaches. All three are errors in every non-test source
     * file under src/. The design system is exempt from the toggle and the
     * current-item checks and nothing else, because `Button`, `Chip`,
     * `SegmentedControl` and `SectionNavigation` are those shapes; a story is
     * held to them, and is let off only the markup-shaped checks it demonstrates.
     */
    const CONTRACT_SKIP = ['hand-rolled-current', 'hand-rolled-toggle'];
    const STORY_SKIP = ['hand-built-overlay', 'hand-rolled-tablist', 'hand-written-target-blank',
        'jsx-label-on-throwing-primitive', 'raw-file-input'];
    const isStory = (file) => /\.stories\.[^/]+$/.test(file);
    const isTest = (file) => /\.(?:test|spec)\.[^/]+$/.test(file);
    const { DS_EXCEPTIONS } = await import('./eslint-rules/exceptions.mjs');
    const expectedExceptions = JSON.stringify(DS_EXCEPTIONS);
    const misplaced = [];
    for (const file of sourceFiles) {
        const config = await eslint.calculateConfigForFile(file);
        const rule = (id) => [config?.rules?.[id]].flat();
        const [rawSeverity, rawOptions] = rule('ds/no-raw-values');
        const [tableSeverity, tableOptions] = rule('ds/native-table');
        const [primitiveSeverity, primitiveOptions] = rule('ds/use-primitive');
        if (isTest(file)) {
            if ([rawSeverity, tableSeverity, primitiveSeverity].some((severity) => severity)) misplaced.push(`${file}: a test`);
            continue;
        }
        const skip = isStory(file) ? STORY_SKIP : file.startsWith('src/design-system/') ? CONTRACT_SKIP : [];
        const ok = rawSeverity === 2 && primitiveSeverity === 2 && tableSeverity === (isStory(file) ? 0 : 2)
            && JSON.stringify([...(primitiveOptions?.skip ?? [])].sort()) === JSON.stringify(skip)
            && [rawOptions, primitiveOptions, ...(isStory(file) ? [] : [tableOptions])]
                .every((options) => JSON.stringify(options?.exceptions) === expectedExceptions);
        if (!ok) misplaced.push(file);
    }
    const scopes = {
        stories: sourceFiles.filter(isStory).length,
        'the design system': sourceFiles.filter((file) => file.startsWith('src/design-system/') && !isStory(file) && !isTest(file)).length,
        features: sourceFiles.filter((file) => file.startsWith('src/features/') && !isTest(file)).length,
    };
    assert(`O5. the rules reach every source file under src/ with the skips of its scope (${Object.entries(scopes).map(([scope, n]) => `${n} in ${scope}`).join(', ')})`,
        misplaced.length === 0 && Object.values(scopes).every((n) => n > 0),
        misplaced.length > 0 ? `${misplaced.slice(0, 5).join(', ')}: lint the file type before adding one, or fix the scope` : 'a scope listed no file');

    /*
     * An exception is a file, a check and a reason, and nothing else. ESLint
     * refuses to start with one that names no check or carries no reason, and a
     * retired one must not linger as cover for a new violation: each must still
     * be needed, by the file it names, for the check it names.
     */
    const refusesOption = async (exceptions) => {
        const linter = new ESLint({ cwd: repoRoot, overrideConfig: { files: [widget], rules: { 'ds/no-raw-values': ['error', { exceptions }] } } });
        try { await linter.lintText(view('<div />'), { filePath: resolve(repoRoot, widget) }); return false; } catch { return true; }
    };
    assert('O6. ESLint refuses an exception for a check that does not exist, or with a reason too short to disagree with',
        await refusesOption({ [widget]: { 'raw-hex-color': 'a reason long enough to pass the floor' } })
        && await refusesOption({ [widget]: { 'raw-hex-colour': 'because' } })
        && !(await refusesOption({ [widget]: { 'raw-hex-colour': 'a reason long enough to pass the floor' } })));
    const tracked = new Set(execFileSync('git', ['ls-files', '-z', 'src'], { cwd: repoRoot, encoding: 'utf8' }).split('\0'));
    const unlistedFiles = Object.keys(DS_EXCEPTIONS).filter((file) => !tracked.has(file));
    const unexcepted = [];
    for (const file of Object.keys(DS_EXCEPTIONS)) {
        const config = await eslint.calculateConfigForFile(file);
        const rules = {};
        for (const id of ['ds/no-raw-values', 'ds/native-table', 'ds/use-primitive']) {
            const [severity, options = {}] = [config?.rules?.[id]].flat();
            if (severity) rules[id] = [severity, { ...options, exceptions: {} }];
        }
        unexcepted.push({ files: [file], rules });
    }
    const bare = new ESLint({ cwd: repoRoot, overrideConfig: unexcepted, ruleFilter: ({ ruleId }) => ruleId.startsWith('ds/') });
    const firing = new Set();
    for (const result of await bare.lintFiles(Object.keys(DS_EXCEPTIONS).filter((file) => tracked.has(file)))) {
        for (const message of result.messages) firing.add(`${relative(repoRoot, result.filePath)} → ${message.messageId}`);
    }
    const stale = Object.entries(DS_EXCEPTIONS).flatMap(([file, checks]) => Object.keys(checks).map((check) => `${file} → ${check}`))
        .filter((pair) => !firing.has(pair));
    assert(`O6b. every exception names a tracked file and is still needed there (${Object.keys(DS_EXCEPTIONS).length} files)`,
        unlistedFiles.length === 0 && stale.length === 0,
        [...unlistedFiles.map((file) => `${file} is not tracked`), ...stale.map((pair) => `${pair} no longer fires: delete it`)].join('; '));

    /*
     * The checker these rules replace had no comment that could switch it off,
     * so neither do they: what a comment hides, a run with inline configuration
     * ignored still sees — an inline rule setting that adds an exception included.
     */
    const strict = new ESLint({ cwd: repoRoot, allowInlineConfig: false, ruleFilter: ({ ruleId }) => ruleId.startsWith('ds/') });
    const hiding = {
        'a disable comment on the line': '// eslint-disable-next-line ds/no-raw-values\nexport const c = "text-[10px]";\n',
        'a disable comment for the file': '/* eslint-disable */\nexport const View = () => <table />;\n',
        'a rule switched off inline': '/* eslint ds/use-primitive: off */\nexport const View = () => <a href="/x" target="_blank">x</a>;\n',
        'an exception added inline': `/* eslint ds/native-table: ["error", {"exceptions": {"${widget}": {"raw-table": "a reason written in a comment"}}}] */\n`
            + 'export const View = () => <table />;\n',
    };
    const hiddenSamples = [];
    for (const [way, code] of Object.entries(hiding)) {
        if (!holdsComment(code) || (await checksFor(code, widget, strict)).length !== 1) hiddenSamples.push(way);
    }
    assert('O7. a comment does not hide a design-system violation from this test', hiddenSamples.length === 0, hiddenSamples.join(', '));
    const governed = sourceFiles.filter((file) => !isTest(file) && /\.(?:jsx?|mjs|cjs)$/.test(file));
    const commented = governed.filter((file) => holdsComment(readFileSync(resolve(repoRoot, file), 'utf8')));
    const hidden = commented.length === 0 ? [] : (await strict.lintFiles(commented))
        .filter((result) => result.messages.some((message) => message.severity === 2))
        .map((result) => relative(repoRoot, result.filePath));
    assert(`O7b. and no file under src/ hides one behind a comment (${commented.length} hold an ESLint comment)`,
        hidden.length === 0, `${hidden.join(', ')}: fix the violation, or record an exception with its roadmap §5 reason`);
}

console.log(failures === 0 ? '\nlint rules: all assertions passed.' : `\n${failures} assertion(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
