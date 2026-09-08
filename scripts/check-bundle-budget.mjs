#!/usr/bin/env node
/**
 * The first download a driver's phone makes, held to a budget.
 *
 * Measured on 2026-09-06 against the production build (audit step I): the
 * public application downloaded 517,442 bytes gzip before a line of it ran —
 * a 1,184 kB entry script, a 399 kB pdf.js chunk preloaded on a page that
 * renders no PDF, and Sentry's Session Replay recorder inside the entry. Moving
 * the pdf.js worker wiring out of the entry and attaching Replay after load
 * took it to 363,025. This check keeps it there: it reads `dist/index.html`,
 * sums the gzip size of the entry script, every `modulepreload` and every
 * stylesheet — exactly what the browser must fetch before the first screen —
 * and refuses the build when the sum passes the ceiling, when a preload names
 * the pdf.js chunk, or when the entry carries the replay recorder.
 *
 * gzip, not brotli, because Hosting serves both and gzip is the larger of the
 * two, so a pass here is a pass over the wire. Node builtins only, so it runs
 * wherever the build does. `scripts/test-bundle-budget.mjs` drives every refusal.
 *
 * Usage: node scripts/check-bundle-budget.mjs [distDir]   (default: ./dist)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Bytes, gzip. 363,025 measured on 2026-09-06; the headroom is under 5%. Move it DOWN, never up, without a measurement. */
export const FIRST_DOWNLOAD_GZIP_CEILING = 380_000;

/** A preload of any of these is the regression this check was written for. */
export const MUST_NOT_PRELOAD = Object.freeze([{ pattern: /pdfjs/i, why: 'the pdf.js chunk belongs to the PDF features, not to every route' }]);

/** Strings that only the deferred Session Replay recorder contains. */
export const ENTRY_MUST_NOT_CONTAIN = Object.freeze([{ marker: 'rrweb', why: 'Session Replay is attached after load; its recorder must not ride in the entry' }]);

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
        if (asset.kind === 'entry') {
            const text = bytes.toString('utf8');
            for (const { marker, why } of ENTRY_MUST_NOT_CONTAIN) if (text.includes(marker)) problems.push(`the entry script contains "${marker}" — ${why}`);
        }
    }
    if (gzipTotal > ceiling) problems.push(`first download is ${gzipTotal} bytes gzip, over the ${ceiling} ceiling by ${gzipTotal - ceiling}`);
    return { assets, gzipTotal, problems };
}

function main() {
    const distDir = resolve(process.argv[2] || 'dist');
    const { assets, gzipTotal, problems } = measureFirstDownload(distDir);
    for (const a of assets) console.log(`  ${String(a.gzip ?? '-').padStart(8)} gz ${String(a.bytes ?? '-').padStart(9)} raw  ${a.kind.padEnd(13)} ${a.href}`);
    console.log(`first download: ${gzipTotal} bytes gzip (ceiling ${FIRST_DOWNLOAD_GZIP_CEILING})`);
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
