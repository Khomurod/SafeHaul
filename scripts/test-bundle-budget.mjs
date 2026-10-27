#!/usr/bin/env node
/**
 * Drives every refusal in `check-bundle-budget.mjs` against throwaway builds.
 * A budget check that has never been seen to fail is a report, not a gate.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    APPLY_PAGE_CEILING, FIRST_DOWNLOAD_GZIP_CEILING, FIRST_DOWNLOAD_MUST_CONTAIN, FIRST_DOWNLOAD_MUST_NOT_CONTAIN,
    englishTextFonts, firstDownloadAssets, measureApplyPage, measureFirstDownload, staticImports,
} from './check-bundle-budget.mjs';
import { removeTree } from './lib/throwaway.mjs';

let failures = 0;
const assert = (label, condition, detail = '') => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    if (!condition) failures += 1;
};

/** The entry of a clean build: it carries every piece the first screen must. */
const CLEAN_ENTRY = `console.log(${JSON.stringify(FIRST_DOWNLOAD_MUST_CONTAIN.map(({ marker }) => marker))});`;

/** The stylesheet of a clean build: the upright English-text face, and an italic one that is not counted. */
const CLEAN_CSS = 'body{margin:0}'
    + '@font-face{font-family:Inter;font-style:normal;src:url(/assets/Inter-latin-f1.woff2) format("woff2");unicode-range:U+0000-00FF,U+2013}'
    + '@font-face{font-family:Inter;font-style:normal;src:url(/assets/Inter-latin-ext-f2.woff2) format("woff2");unicode-range:U+0100-024F}'
    + '@font-face{font-family:Inter;font-style:italic;src:url(/assets/Inter-Italic-latin-f3.woff2) format("woff2");unicode-range:U+0000-00FF}';

/**
 * A dist with an entry, optional preloads, a stylesheet, the font files and
 * other chunks (the application page's among them); contents are given so
 * gzip sizes are controllable. The default page chunk imports nothing, which
 * `measureApplyPage` refuses (A6); the A-cases that pass give it imports.
 */
function fakeDist({ entry = CLEAN_ENTRY, preloads = {}, css = CLEAN_CSS, chunks = { 'PublicApplyHandler-r1.js': 'export const page = 1;' } } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'main-abc.js'), entry);
    writeFileSync(join(dir, 'assets', 'main-abc.css'), css);
    for (const [name, bytes] of [['Inter-latin-f1.woff2', 1000], ['Inter-latin-ext-f2.woff2', 2000], ['Inter-Italic-latin-f3.woff2', 4000]]) {
        writeFileSync(join(dir, 'assets', name), Buffer.alloc(bytes, 1));
    }
    for (const [name, body] of Object.entries(chunks)) writeFileSync(join(dir, 'assets', name), body);
    const preloadTags = Object.entries(preloads).map(([name, body]) => {
        writeFileSync(join(dir, 'assets', name), body);
        return `<link rel="modulepreload" crossorigin href="/assets/${name}">`;
    }).join('\n    ');
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html><head>
    <meta charset="UTF-8" />
    <link rel="icon" href="data:image/svg+xml,x">
    <script type="module" crossorigin src="/assets/main-abc.js"></script>
    ${preloadTags}
    <link rel="stylesheet" crossorigin href="/assets/main-abc.css">
  </head><body><div id="root"></div></body></html>`);
    return dir;
}

console.log('\nB. Bundle budget');
{
    const html = '<script type="module" crossorigin src="/assets/main-1.js"></script><link rel="modulepreload" href="/assets/x-1.js"><link rel="stylesheet" href="/assets/m.css"><link rel="icon" href="/f.svg"><script src="/legacy.js"></script>';
    const kinds = firstDownloadAssets(html).map((a) => `${a.kind}:${a.href}`);
    assert('B1. the parser takes the module entry, module preloads and stylesheets, and nothing else',
        JSON.stringify(kinds) === JSON.stringify(['entry:/assets/main-1.js', 'modulepreload:/assets/x-1.js', 'stylesheet:/assets/m.css']), kinds.join(', '));
}
{
    const dir = fakeDist();
    const r = measureFirstDownload(dir);
    assert('B2. a small clean build passes with the three assets measured', r.problems.length === 0 && r.assets.length === 2 && r.gzipTotal > 0, r.problems.join('; '));
    removeTree(dir);
}
{
    // Random bytes are incompressible, so gzip cannot shrink them under the ceiling.
    const dir = fakeDist({ entry: randomBytes(64 * 1024) });
    const r = measureFirstDownload(dir, { ceiling: 40_000 });
    assert('B3. an entry over the ceiling is refused, naming the overrun', r.problems.some((p) => /over the 40000 ceiling by \d+/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist({ preloads: { 'pdfjs-Zz9.js': 'export const p = 1;' } });
    const r = measureFirstDownload(dir);
    assert('B4. a preloaded pdf.js chunk is refused even when the total is tiny', r.problems.some((p) => /pdfjs-Zz9\.js is preloaded/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist({ entry: 'const recorder = "rrweb"; console.log(recorder);' });
    const r = measureFirstDownload(dir);
    assert('B5. a Session Replay recorder inside the entry is refused', r.problems.some((p) => /contains "rrweb"/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
for (const { marker } of FIRST_DOWNLOAD_MUST_NOT_CONTAIN) {
    const piece = `const piece = ${JSON.stringify(marker)}; console.log(piece);`;
    let dir = fakeDist({ entry: `${CLEAN_ENTRY} ${piece}` });
    let r = measureFirstDownload(dir);
    assert(`B5b. an entry carrying "${marker}" is refused`, r.problems.some((p) => p.includes(`main-abc.js (entry) contains "${marker}"`)), r.problems.join('; '));
    removeTree(dir);
    dir = fakeDist({ preloads: { 'vendor-V1.js': `export ${piece}` } });
    r = measureFirstDownload(dir);
    assert(`B5b. a module preload carrying "${marker}" is refused`, r.problems.some((p) => p.includes(`vendor-V1.js (modulepreload) contains "${marker}"`)), r.problems.join('; '));
    removeTree(dir);
}
for (const { marker } of FIRST_DOWNLOAD_MUST_CONTAIN) {
    let dir = fakeDist({ entry: CLEAN_ENTRY.replaceAll(marker, 'something-else') });
    let r = measureFirstDownload(dir);
    assert(`B5c. a first download without "${marker}" is refused`, r.problems.some((p) => p.includes(`no script of the first download contains "${marker}"`)), r.problems.join('; '));
    removeTree(dir);
    dir = fakeDist({ entry: CLEAN_ENTRY.replaceAll(marker, 'something-else'), preloads: { 'chunk-Q1.js': `export const q = ${JSON.stringify(marker)};` } });
    r = measureFirstDownload(dir);
    assert(`B5c. "${marker}" in a module preload counts: it loads with the first screen`, r.problems.length === 0, r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist();
    rmSync(join(dir, 'assets', 'main-abc.css'));
    const r = measureFirstDownload(dir);
    assert('B6. an asset index.html references but the build lacks is refused', r.problems.some((p) => /main-abc\.css is referenced but not in the build/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-empty-'));
    const r = measureFirstDownload(dir);
    assert('B7. a missing build is a refusal, not a pass over nothing', r.problems.length === 1 && /no index\.html/.test(r.problems[0]), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist();
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/assets/main-abc.css"></head><body></body></html>');
    const r = measureFirstDownload(dir);
    assert('B8. an index.html with no module entry is refused as vacuous', r.problems.some((p) => /no module entry script/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
assert('B9. the ceiling is pinned: 319,000 bytes gzip, and may only move down with a new measurement', FIRST_DOWNLOAD_GZIP_CEILING === 319_000, String(FIRST_DOWNLOAD_GZIP_CEILING));
{
    const dir = fakeDist({ preloads: { 'vendor-V1.js': 'import{a}from"./main-abc.js";export const v = a;' } });
    const r = measureFirstDownload(dir);
    assert('B10. a module preload that imports the entry is refused: its name would change with every release',
        r.problems.some((p) => /vendor-V1\.js imports the entry/.test(p)), r.problems.join('; '));
    removeTree(dir);
}

console.log('\nA. The application page');
{
    const code = 'import{a as b}from"./vendor-V1.js";import"./side-S1.js";export{c}from"./shared-X1.js";'
        + 'const d=()=>import("./later-L1.js");const s="import{z}from\'./x.js\'";';
    const found = staticImports(code);
    assert('A1. static imports and re-exports are followed; a dynamic import() and a string are not',
        ['vendor-V1.js', 'side-S1.js', 'shared-X1.js'].every((f) => found.includes(f)) && found.length === 3, found.join(', '));
}
{
    const fonts = englishTextFonts(CLEAN_CSS);
    assert('A2. the font counted is the upright face that draws "A"; latin-ext and italic are not',
        JSON.stringify(fonts) === JSON.stringify(['/assets/Inter-latin-f1.woff2']), fonts.join(', '));
}
{
    const dir = fakeDist({
        preloads: { 'vendor-V1.js': 'export const v = 1;' },
        chunks: {
            'PublicApplyHandler-r1.js': 'import{v}from"./vendor-V1.js";import{s}from"./steps-S1.js";const l=()=>import("./later-L1.js");',
            'steps-S1.js': 'import{v}from"./vendor-V1.js";export const s = 2;',
            'later-L1.js': 'export const later = "never counted";',
        },
    });
    const first = measureFirstDownload(dir);
    const r = measureApplyPage(dir, first);
    const files = r.route.map((c) => c.file).sort();
    assert('A3. a clean page passes: the first download, the route and what it imports (once), and the font',
        r.problems.length === 0 && JSON.stringify(files) === JSON.stringify(['PublicApplyHandler-r1.js', 'steps-S1.js'])
        && r.total === first.gzipTotal + r.route.reduce((sum, c) => sum + c.gzip, 0) + 1000, `${r.problems.join('; ')} ${files} ${r.total}`);
    const tight = measureApplyPage(dir, first, { ceiling: r.total - 1 });
    assert('A4. a page over its ceiling is refused, naming the overrun', tight.problems.some((p) => /over the \d+ ceiling by 1$/.test(p)), tight.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist({ chunks: { 'PublicApplyHandler-r1.js': 'import{p}from"./pdfjs-P1.js";', 'pdfjs-P1.js': 'export const p = 1;' } });
    const r = measureApplyPage(dir, measureFirstDownload(dir));
    assert('A5. pdf.js imported by the page is refused', r.problems.some((p) => /imports pdfjs-P1\.js/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist();
    const r = measureApplyPage(dir, measureFirstDownload(dir));
    assert('A6. a page chunk whose imports cannot be read is a refusal, not a short sum', r.problems.some((p) => /no import of PublicApplyHandler-r1\.js could be read/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    // Rolldown (Vite 8) can emit a facade beside the screen's chunk that only
    // re-exports it; the page is measured from the facade, through it.
    const dir = fakeDist({
        preloads: { 'vendor-V1.js': 'export const v = 1;' },
        chunks: {
            'PublicApplyHandler-f1.js': 'export{PublicApplyHandler}from"./PublicApplyHandler-r1.js";',
            'PublicApplyHandler-r1.js': 'import{v}from"./vendor-V1.js";import{s}from"./steps-S1.js";export const PublicApplyHandler = 1;',
            'steps-S1.js': 'export const s = 2;',
        },
    });
    const r = measureApplyPage(dir, measureFirstDownload(dir));
    const files = r.route.map((c) => c.file).sort();
    assert('A6b. a facade that only re-exports the page chunk is measured through it, not refused',
        r.problems.length === 0 && JSON.stringify(files) === JSON.stringify(['PublicApplyHandler-f1.js', 'PublicApplyHandler-r1.js', 'steps-S1.js']),
        `${r.problems.join('; ')} ${files}`);
    removeTree(dir);
}
for (const [label, chunks] of [['no chunk', {}], ['two chunks', { 'PublicApplyHandler-r1.js': '1', 'PublicApplyHandler-r2.js': '2' }],
    ['a facade of some other chunk', { 'PublicApplyHandler-f1.js': 'export{x}from"./other-O1.js";', 'PublicApplyHandler-r1.js': 'import{v}from"./vendor-V1.js";' }]]) {
    const dir = fakeDist({ chunks });
    const r = measureApplyPage(dir, measureFirstDownload(dir));
    assert(`A6. ${label} named for the page is a refusal, not a pass over nothing`, r.problems.some((p) => /cannot be measured/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist({ css: 'body{margin:0}' });
    const r = measureApplyPage(dir, measureFirstDownload(dir));
    assert('A7. a stylesheet with no English-text font is refused: the font would be left out', r.problems.some((p) => /no stylesheet names an upright font/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
{
    const dir = fakeDist({ chunks: { 'PublicApplyHandler-r1.js': 'import{m}from"./missing-M1.js";' } });
    const r = measureApplyPage(dir, measureFirstDownload(dir));
    assert('A8. a chunk the page imports but the build lacks is refused', r.problems.some((p) => /missing-M1\.js is imported by the application page but not in the build/.test(p)), r.problems.join('; '));
    removeTree(dir);
}
assert('A9. the application page ceiling is pinned: 536,000 bytes, and may only move down with a new measurement', APPLY_PAGE_CEILING === 536_000, String(APPLY_PAGE_CEILING));

if (failures) { console.error(`\n${failures} bundle-budget check(s) failed.`); process.exit(1); }
console.log('All bundle-budget checks passed.');
