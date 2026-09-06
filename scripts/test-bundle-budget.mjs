#!/usr/bin/env node
/**
 * Drives every refusal in `check-bundle-budget.mjs` against throwaway builds.
 * A budget check that has never been seen to fail is a report, not a gate.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIRST_DOWNLOAD_GZIP_CEILING, firstDownloadAssets, measureFirstDownload } from './check-bundle-budget.mjs';

let failures = 0;
const assert = (label, condition, detail = '') => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${label}${condition || !detail ? '' : ` — ${detail}`}`);
    if (!condition) failures += 1;
};

/** A dist with an entry, optional preloads and a stylesheet; contents are given so gzip sizes are controllable. */
function fakeDist({ entry = 'console.log(1);', preloads = {}, css = 'body{margin:0}' } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'main-abc.js'), entry);
    writeFileSync(join(dir, 'assets', 'main-abc.css'), css);
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
    rmSync(dir, { recursive: true, force: true });
}
{
    // Random bytes are incompressible, so gzip cannot shrink them under the ceiling.
    const dir = fakeDist({ entry: randomBytes(64 * 1024) });
    const r = measureFirstDownload(dir, { ceiling: 40_000 });
    assert('B3. an entry over the ceiling is refused, naming the overrun', r.problems.some((p) => /over the 40000 ceiling by \d+/.test(p)), r.problems.join('; '));
    rmSync(dir, { recursive: true, force: true });
}
{
    const dir = fakeDist({ preloads: { 'pdfjs-Zz9.js': 'export const p = 1;' } });
    const r = measureFirstDownload(dir);
    assert('B4. a preloaded pdf.js chunk is refused even when the total is tiny', r.problems.some((p) => /pdfjs-Zz9\.js is preloaded/.test(p)), r.problems.join('; '));
    rmSync(dir, { recursive: true, force: true });
}
{
    const dir = fakeDist({ entry: 'const recorder = "rrweb"; console.log(recorder);' });
    const r = measureFirstDownload(dir);
    assert('B5. a Session Replay recorder inside the entry is refused', r.problems.some((p) => /contains "rrweb"/.test(p)), r.problems.join('; '));
    rmSync(dir, { recursive: true, force: true });
}
{
    const dir = fakeDist();
    rmSync(join(dir, 'assets', 'main-abc.css'));
    const r = measureFirstDownload(dir);
    assert('B6. an asset index.html references but the build lacks is refused', r.problems.some((p) => /main-abc\.css is referenced but not in the build/.test(p)), r.problems.join('; '));
    rmSync(dir, { recursive: true, force: true });
}
{
    const dir = mkdtempSync(join(tmpdir(), 'bundle-budget-empty-'));
    const r = measureFirstDownload(dir);
    assert('B7. a missing build is a refusal, not a pass over nothing', r.problems.length === 1 && /no index\.html/.test(r.problems[0]), r.problems.join('; '));
    rmSync(dir, { recursive: true, force: true });
}
{
    const dir = fakeDist();
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="/assets/main-abc.css"></head><body></body></html>');
    const r = measureFirstDownload(dir);
    assert('B8. an index.html with no module entry is refused as vacuous', r.problems.some((p) => /no module entry script/.test(p)), r.problems.join('; '));
    rmSync(dir, { recursive: true, force: true });
}
assert('B9. the ceiling is pinned: 380,000 bytes gzip, and may only move down with a new measurement', FIRST_DOWNLOAD_GZIP_CEILING === 380_000, String(FIRST_DOWNLOAD_GZIP_CEILING));

if (failures) { console.error(`\n${failures} bundle-budget check(s) failed.`); process.exit(1); }
console.log('All bundle-budget checks passed.');
