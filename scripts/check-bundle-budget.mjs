#!/usr/bin/env node
/**
 * The first download a driver's phone makes, held to a budget.
 *
 * What keeps it small: the pdf.js worker wiring lives outside the entry and no
 * preload names the pdf.js chunk; Session Replay and tracing attach after load;
 * Storage and DOMPurify load on demand; Auth starts without its popup resolver;
 * each glyph loads with the screens that draw it; and the libraries ride in a
 * chunk of their own. This check keeps it there: it reads `dist/index.html`,
 * sums the gzip size of the entry script, every `modulepreload` and every
 * stylesheet — exactly what the browser must fetch before the first screen —
 * and refuses the build when the sum passes the ceiling, when a preload names
 * the pdf.js chunk, when a script of that set carries one of the pieces that
 * load later, or when none carries one that must not.
 *
 * It measures the driver's application page the same way (`measureApplyPage`):
 * the first download, the route's chunk with everything it imports, and the
 * Inter part every page with English text loads.
 *
 * gzip, not brotli, because Hosting serves both and gzip is the larger of the
 * two, so a pass here is a pass over the wire. Node builtins only, so it runs
 * wherever the build does. `scripts/test-bundle-budget.mjs` drives every refusal.
 *
 * Usage: node scripts/check-bundle-budget.mjs [distDir]   (default: ./dist)
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Bytes, gzip. 309,382 measured; the headroom is 3%. Move it DOWN, never up, without a measurement. */
export const FIRST_DOWNLOAD_GZIP_CEILING = 319_000;

/** A preload of any of these is the regression this check was written for. */
export const MUST_NOT_PRELOAD = Object.freeze([{ pattern: /pdfjs/i, why: 'the pdf.js chunk belongs to the PDF features, not to every route' }]);

/**
 * Strings that only code loaded after the first screen contains, each found in
 * the entry before it moved. Checked in every script of the first download: a
 * module preload is fetched before the first screen as surely as the entry.
 */
export const FIRST_DOWNLOAD_MUST_NOT_CONTAIN = Object.freeze([
    { marker: 'rrweb', why: 'Session Replay is attached after load; its recorder must not ride in the first download' },
    { marker: 'auto.pageload.browser', why: 'Sentry tracing is attached with Replay after load (src/lib/monitoring/sentry.js)' },
    { marker: 'Sentry Logger', why: "Sentry's debug logging is compiled out (__SENTRY_DEBUG__ in vite.config.js)" },
    { marker: 'firebasestorage.googleapis.com', why: 'Storage loads with the features that handle files (@lib/firebase/storage), not through @lib/firebase' },
    { marker: '__/auth/handler', why: 'Auth starts without the popup/redirect resolver (initializeAuth in src/lib/firebase/config.js)' },
    { marker: 'DOMPurify', why: 'the sanitizer loads when custom questions are saved, not with the company chooser' },
]);

/**
 * Strings of code the first screen must carry, in the entry or a module it
 * preloads: a chunk loaded later can fail on the connection that needs it, and
 * nothing reloads the page for a network failure (`staleBuildReload.js`).
 */
export const FIRST_DOWNLOAD_MUST_CONTAIN = Object.freeze([
    { marker: 'safehaul-submission-queue', why: 'the offline queue sends queued applications from every page (QueueStatusIndicator in App.jsx), so it must not wait on a chunk that can fail to load' },
]);

/**
 * Bytes over the wire for `/apply/:slug` before its first screen: scripts and
 * stylesheets gzip, the font as served (WOFF2 is compressed already). 520,577
 * measured; the headroom is 3%. Move it DOWN, never up, without a measurement.
 */
export const APPLY_PAGE_CEILING = 536_000;

/** The chunk Rollup names after the route's screen (`featureRegistry.jsx`). */
export const APPLY_ROUTE_CHUNK = /^PublicApplyHandler-[\w-]+\.js$/;

/** Chunks the application page must not import before its first screen. */
export const APPLY_MUST_NOT_LOAD = Object.freeze([
    { pattern: /^pdfjs-/, why: 'pdf.js loads when a driver picks a PDF report (useReportImport), not with the page' },
]);

const ATTRIBUTE = (name) => new RegExp(`\\b${name}=["']([^"']+)["']`);

function attribute(tag, name) {
    const match = tag.match(ATTRIBUTE(name));
    return match ? match[1] : null;
}

/** The assets `index.html` makes the browser fetch before the first screen. */
export function firstDownloadAssets(indexHtml) {
    const tags = indexHtml.match(/<(?:script|link)\b[^>]*>/g) || [];
    const assets = [];
    for (const tag of tags) {
        if (/^<script/.test(tag) && /\btype=["']module["']/.test(tag)) {
            const src = attribute(tag, 'src');
            if (src) assets.push({ href: src, kind: 'entry' });
        } else if (/^<link/.test(tag)) {
            const rel = attribute(tag, 'rel');
            const href = attribute(tag, 'href');
            if (rel === 'modulepreload' && href) assets.push({ href, kind: 'modulepreload' });
            if (rel === 'stylesheet' && href) assets.push({ href, kind: 'stylesheet' });
        }
    }
    return assets;
}

/** Measures the first download under `distDir`; every refusal is a problem string. */
export function measureFirstDownload(distDir, { ceiling = FIRST_DOWNLOAD_GZIP_CEILING } = {}) {
    const problems = [];
    const indexPath = join(distDir, 'index.html');
    if (!existsSync(indexPath)) return { assets: [], gzipTotal: 0, problems: [`no index.html under ${distDir}; build first`] };

    const assets = firstDownloadAssets(readFileSync(indexPath, 'utf8'));
    if (!assets.some((a) => a.kind === 'entry')) problems.push('index.html has no module entry script; the measurement would be vacuous');

    let gzipTotal = 0;
    const scripts = [];
    for (const asset of assets) {
        const path = join(distDir, asset.href.replace(/^\//, ''));
        if (!existsSync(path)) { problems.push(`${asset.href} is referenced but not in the build`); continue; }
        const bytes = readFileSync(path);
        asset.bytes = bytes.length;
        asset.gzip = gzipSync(bytes, { level: 6 }).length;
        gzipTotal += asset.gzip;
        if (asset.kind === 'modulepreload') {
            for (const { pattern, why } of MUST_NOT_PRELOAD) if (pattern.test(asset.href)) problems.push(`${asset.href} is preloaded on every route — ${why}`);
        }
        if (asset.kind !== 'stylesheet') {
            const text = bytes.toString('utf8');
            scripts.push(text);
            for (const { marker, why } of FIRST_DOWNLOAD_MUST_NOT_CONTAIN) if (text.includes(marker)) problems.push(`${asset.href} (${asset.kind}) contains "${marker}" — ${why}`);
        }
    }
    // A preload that imports the entry carries the entry's name, which changes
    // with every release, so its own name would too: it is the vendor chunk's
    // reason to exist that it does not.
    const entry = assets.find((a) => a.kind === 'entry');
    const entryName = entry && entry.href.split('/').pop();
    for (const asset of assets.filter((a) => a.kind === 'modulepreload' && a.bytes !== undefined)) {
        if (entryName && staticImports(readFileSync(join(distDir, asset.href.replace(/^\//, '')), 'utf8')).includes(entryName)) {
            problems.push(`${asset.href} imports the entry, so its name changes with every release and returning visitors download it again`);
        }
    }
    for (const { marker, why } of FIRST_DOWNLOAD_MUST_CONTAIN) {
        if (scripts.length && !scripts.some((text) => text.includes(marker))) problems.push(`no script of the first download contains "${marker}" — ${why}`);
    }
    if (gzipTotal > ceiling) problems.push(`first download is ${gzipTotal} bytes gzip, over the ${ceiling} ceiling by ${gzipTotal - ceiling}`);
    return { assets, gzipTotal, problems };
}

/** The chunks a script statically imports or re-exports from, as Rollup writes ES output. */
export function staticImports(code) {
    const found = new Set();
    const pattern = /(?:^|[;}\n])\s*(?:import|export)\s*(?:[^"';()]*?\bfrom\s*)?["']\.\/([\w.-]+\.js)["']/g;
    for (const [, file] of code.matchAll(pattern)) found.add(file);
    return [...found];
}

/** The fonts a page with English text loads: the upright faces that draw "A". */
export function englishTextFonts(css) {
    const fonts = [];
    for (const [, body] of css.matchAll(/@font-face\s*{([^}]*)}/g)) {
        if (!/font-style:\s*normal/.test(body)) continue;
        // A face with no range draws every character it has.
        const ranges = body.match(/unicode-range:([^;}]+)/)?.[1] ?? 'U+0000-10FFFF';
        const drawsA = ranges.split(',').some((item) => {
            const [first, last = first] = item.trim().replace(/^U\+/i, '').split('-').map((hex) => parseInt(hex, 16));
            return first <= 0x41 && 0x41 <= last;
        });
        const url = body.match(/url\(["']?([^"')]+\.woff2)["']?\)/);
        if (drawsA && url) fonts.push(url[1]);
    }
    return fonts;
}

/**
 * What `/apply/:slug` downloads before its first screen: the first download,
 * the route's chunk and every chunk it imports, and the English-text font. A
 * chunk's own stylesheet is not counted: the app has one stylesheet, in the
 * first download, and only the pdf.js chunk carries another.
 */
export function measureApplyPage(distDir, firstDownload, { ceiling = APPLY_PAGE_CEILING } = {}) {
    const problems = [];
    const assetsDir = join(distDir, 'assets');
    const routeChunks = existsSync(assetsDir) ? readdirSync(assetsDir).filter((file) => APPLY_ROUTE_CHUNK.test(file)) : [];
    if (routeChunks.length !== 1) {
        return { route: [], fonts: [], total: 0, problems: [`expected one chunk named like ${APPLY_ROUTE_CHUNK}, found ${routeChunks.length}; the application page cannot be measured`] };
    }
    const firstFiles = new Set(firstDownload.assets.map((a) => a.href.split('/').pop()));
    const route = [];
    const queue = [routeChunks[0]];
    const seen = new Set(queue);
    while (queue.length) {
        const file = queue.shift();
        const path = join(assetsDir, file);
        if (!existsSync(path)) { problems.push(`${file} is imported by the application page but not in the build`); continue; }
        const bytes = readFileSync(path);
        if (!firstFiles.has(file)) route.push({ file, gzip: gzipSync(bytes, { level: 6 }).length });
        for (const { pattern, why } of APPLY_MUST_NOT_LOAD) if (pattern.test(file)) problems.push(`the application page imports ${file} — ${why}`);
        const imports = staticImports(bytes.toString('utf8'));
        // The screen imports React from the first download at the least; finding
        // nothing means the imports could not be read, and the sum would be short.
        if (file === routeChunks[0] && !imports.length) problems.push(`no import of ${file} could be read; the application page cannot be measured`);
        for (const next of imports) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
    const css = firstDownload.assets.filter((a) => a.kind === 'stylesheet' && a.bytes !== undefined)
        .map((a) => readFileSync(join(distDir, a.href.replace(/^\//, '')), 'utf8')).join('\n');
    const fonts = englishTextFonts(css).map((url) => {
        const path = join(distDir, url.replace(/^\//, ''));
        if (!existsSync(path)) { problems.push(`${url} is named by a stylesheet but not in the build`); return { url, bytes: 0 }; }
        return { url, bytes: readFileSync(path).length };
    });
    if (!fonts.length) problems.push('no stylesheet names an upright font for English text; the measurement would leave the font out');
    const total = firstDownload.gzipTotal + route.reduce((sum, r) => sum + r.gzip, 0) + fonts.reduce((sum, f) => sum + f.bytes, 0);
    if (total > ceiling) problems.push(`the application page downloads ${total} bytes before its first screen, over the ${ceiling} ceiling by ${total - ceiling}`);
    return { route, fonts, total, problems };
}

function main() {
    const distDir = resolve(process.argv[2] || 'dist');
    const first = measureFirstDownload(distDir);
    const { assets, gzipTotal } = first;
    for (const a of assets) console.log(`  ${String(a.gzip ?? '-').padStart(8)} gz ${String(a.bytes ?? '-').padStart(9)} raw  ${a.kind.padEnd(13)} ${a.href}`);
    console.log(`first download: ${gzipTotal} bytes gzip (ceiling ${FIRST_DOWNLOAD_GZIP_CEILING})`);
    const apply = measureApplyPage(distDir, first);
    for (const r of apply.route) console.log(`  ${String(r.gzip).padStart(8)} gz  application page chunk  ${r.file}`);
    for (const f of apply.fonts) console.log(`  ${String(f.bytes).padStart(8)}     application page font   ${f.url}`);
    console.log(`application page: ${apply.total} bytes (ceiling ${APPLY_PAGE_CEILING})`);
    const problems = [...first.problems, ...apply.problems];
    if (problems.length) {
        console.error(`\nbundle budget: ${problems.length} problem(s)\n  - ${problems.join('\n  - ')}`);
        return 1;
    }
    console.log('bundle budget OK.');
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    process.exit(main());
}
export const __dirnameForTests = dirname(fileURLToPath(import.meta.url));
