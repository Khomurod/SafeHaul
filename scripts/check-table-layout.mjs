#!/usr/bin/env node
/**
 * Repository guard: a table cell must be able to contain what is put in it.
 *
 * Run: `npm run check:table-layout`   (after `npm run build-storybook`)
 * Dev: `npm run check:table-layout -- --url http://localhost:6006`
 *
 * ## Why this exists
 *
 * On 2026-08-08 the Super Admin AI Integrations table showed a pale vertical
 * strip down its right edge and a Delete button rendered as "Dele". Two
 * separate design-system defects, both invisible to every check the repository
 * had:
 *
 *  - `scrollbar-gutter: stable` reserved 15px at the inline-end edge of every
 *    table scroll region. A `<table>` cannot paint into a gutter, so the header
 *    background, row backgrounds and dividers all stopped 15px short of the
 *    card edge. Present on all 84 table renders in the catalog; not one of them
 *    scrolled vertically, so the gutter was reserved for a scrollbar that never
 *    appeared.
 *  - `--ds-table-actions-width` was 64px. Mobile cell padding is 2x
 *    `--ds-space-4`, leaving 32px of content box for the header word "ACTIONS",
 *    which needs 41px. Every table with a visible actions header overflowed its
 *    last column by exactly 9px.
 *
 * Neither could be caught by a unit test. jsdom has no layout engine, so
 * `scrollWidth` and `offsetWidth` are always `0` there — the contract tests and
 * `npm run test:stories` are structurally incapable of seeing this class of
 * bug, however many of them are written. And the E2E overflow assertion checks
 * `document.documentElement`, so a gap *inside* a card never reaches it.
 *
 * Measuring real layout in a real browser is the only thing that works, which
 * is what this script does.
 *
 * ## The two invariants
 *
 * 1. **A cell contains its content.** `scrollWidth > clientWidth` means the
 *    content is wider than the column it was placed in and is spilling over a
 *    neighbour, or past the edge the table paints to. A column declaring
 *    `truncate` is exempt: that attribute is an explicit opt-in to clipping.
 * 2. **No dead gutter.** Space reserved at the edge of a scroll region that is
 *    not scrolling is space the table can never paint, and it shows as a strip
 *    of the surface behind it.
 *
 * ## What it does not cover
 *
 * The catalog, not the application. Feature screens are only covered to the
 * extent that a catalog pattern represents them, and catalog fixtures are
 * deliberately generic — "Service alpha" is shorter than a real provider name.
 * A pattern can pass here while the screen it documents overflows on a longer
 * production string. When a feature changes a column's content, measure the
 * screen too.
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATIC_DIR = resolve(REPO_ROOT, 'storybook-static');

/** Both ends of the responsive range. The mobile end is where columns hit their declared widths. */
const VIEWPORTS = [
    { width: 412, height: 915, label: 'mobile' },
    { width: 1440, height: 900, label: 'desktop' },
];

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
    '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};

function parseArgs(argv) {
    const url = argv.indexOf('--url');
    return { url: url === -1 ? null : argv[url + 1] };
}

/** Minimal static server for the built catalog. No dependency, no configuration. */
function serveStatic(root) {
    return new Promise((resolvePort, reject) => {
        const server = createServer((req, res) => {
            const requested = decodeURIComponent((req.url || '/').split('?')[0]);
            // Normalised and re-rooted, so a traversal cannot escape the catalog.
            const path = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
            const target = existsSync(path) && statSync(path).isDirectory()
                ? join(path, 'index.html')
                : path;
            if (!target.startsWith(root) || !existsSync(target)) {
                res.writeHead(404).end('not found');
                return;
            }
            res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
            createReadStream(target).pipe(res);
        });
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => resolvePort({ server, port: server.address().port }));
    });
}

/**
 * Runs inside the page. Returns the violations found in this render, plus how
 * many populated tables were actually measured — the caller treats "measured
 * nothing anywhere" as a failure rather than a clean result.
 *
 * Kept as a single serialisable function so the measurement lives in one place
 * and is the same at both viewports.
 */
function measureTables() {
    const findings = [];
    let tableCount = 0;

    for (const root of document.querySelectorAll('.ds-data-table')) {
        const region = root.querySelector('.ds-data-table__scroll-region');
        if (!region) continue;
        // An async/empty state renders the shell with no cells. Counting only
        // regions that actually contain a row keeps the "did we measure
        // anything" assertion meaningful.
        if (region.querySelector('td, th')) tableCount += 1;

        // Invariant 2 — space reserved at the edge that the table cannot paint.
        const reserved = region.offsetWidth - region.clientWidth;
        const scrollsVertically = region.scrollHeight > region.clientHeight + 1;
        if (reserved > 1 && !scrollsVertically) {
            findings.push({
                kind: 'dead-gutter',
                detail: `${reserved}px reserved at the edge of a region that does not scroll vertically`,
            });
        }

        // Invariant 1 — every cell contains its content.
        for (const cell of region.querySelectorAll('td, th')) {
            if (cell.getAttribute('data-truncate') === 'true') continue;
            const over = cell.scrollWidth - cell.clientWidth;
            if (over <= 1) continue;
            findings.push({
                kind: 'cell-overflow',
                width: cell.getAttribute('data-width') || 'auto',
                over,
                box: cell.clientWidth,
                needs: cell.scrollWidth,
                text: (cell.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 56),
                detail: `content needs ${cell.scrollWidth}px in a ${cell.clientWidth}px column`,
            });
        }
    }
    return { findings, tableCount };
}

async function main() {
    const { url } = parseArgs(process.argv.slice(2));

    if (!url && !existsSync(STATIC_DIR)) {
        console.error('\nNo built catalog at storybook-static/.');
        console.error('Run `npm run build-storybook` first, or pass --url http://localhost:6006.\n');
        process.exit(1);
    }

    let server = null;
    let base = url;
    if (!base) {
        const started = await serveStatic(STATIC_DIR);
        server = started.server;
        base = `http://127.0.0.1:${started.port}`;
    }

    // From `@playwright/test`, not `playwright`: the two are pinned to different
    // versions here and therefore to different browser builds. Sharing the test
    // runner's build means CI downloads and caches one browser, the same one the
    // E2E lane already has, rather than a second copy.
    //
    // Imported lazily so the "no catalog" message above does not require the
    // browser to be installed at all.
    const { chromium } = await import('@playwright/test');

    const index = await (await fetch(`${base}/index.json`)).json();
    const storyIds = Object.values(index.entries || index.stories || {})
        .filter((entry) => entry.type !== 'docs')
        .map((entry) => entry.id);

    if (storyIds.length === 0) {
        console.error('\nThe catalog index resolved to zero stories. That is a build problem, not a pass.\n');
        server?.close();
        process.exit(1);
    }

    // Honour the same `PW_CHROMIUM_EXECUTABLE` override `playwright.config.cjs`
    // does. A sandboxed or CI-adjacent environment often provides a system
    // Chromium whose build number does not match the one this Playwright version
    // pins, and without the override this guard cannot run there at all — which
    // in practice means it gets skipped, which is the same as not having it.
    const chromiumExecutablePath = process.env.PW_CHROMIUM_EXECUTABLE;
    const browser = await chromium.launch(
        chromiumExecutablePath ? { executablePath: chromiumExecutablePath } : {},
    );
    const violations = [];
    let tablesMeasured = 0;

    for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const page = await context.newPage();
        for (const id of storyIds) {
            await page.goto(`${base}/iframe.html?id=${id}&viewMode=story`, { waitUntil: 'networkidle' });

            // Settle deliberately rather than on a timeout. An earlier revision
            // of this script waited a flat 80ms and silently reported a clean
            // run against a tree with 37px of real overflow in it, because the
            // stories had not finished rendering when it measured. A guard that
            // passes because it looked too early is worse than no guard, so the
            // wait is now tied to observable state: web fonts resolved (they
            // change text metrics, which is the whole measurement) and two
            // frames painted.
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

            const result = await page.evaluate(measureTables);
            tablesMeasured += result.tableCount;
            for (const finding of result.findings) {
                violations.push({ story: id, viewport: viewport.label, ...finding });
            }
        }
        await context.close();
    }
    await browser.close();
    server?.close();

    // The catalog contains tables. Measuring none of them means the selector,
    // the story glob or the render broke — that is a failure, not a pass.
    if (tablesMeasured === 0) {
        console.error('\nThe check found no tables to measure across the whole catalog.');
        console.error('That is a broken check or a broken build, not a clean result.\n');
        process.exit(1);
    }

    if (violations.length === 0) {
        console.log(`Table layout intact: ${tablesMeasured} table renders across `
            + `${storyIds.length} stories x ${VIEWPORTS.length} widths — no cell overflow, no dead gutter.`);
        return;
    }

    // One line per distinct (story, viewport, column, kind) so a single
    // mis-sized column does not print once per row.
    const seen = new Map();
    for (const violation of violations) {
        const key = `${violation.story}|${violation.viewport}|${violation.kind}|${violation.width || ''}`;
        const existing = seen.get(key);
        if (!existing || (violation.over || 0) > (existing.over || 0)) seen.set(key, violation);
    }
    const rows = [...seen.values()].sort((a, b) => (b.over || 0) - (a.over || 0));

    console.error('\nTable layout check failed.\n');
    console.error('A cell must be able to contain its content, and a table must be able to paint');
    console.error('to the edge of its own scroll region. Widen the column at the call site, mark it');
    console.error('`truncate` if clipping is intended, or fix the design-system default.\n');
    for (const row of rows) {
        console.error(`  [${row.viewport}] ${row.kind}${row.width ? ` width='${row.width}'` : ''} — ${row.detail}`);
        console.error(`      story: ${row.story}`);
        if (row.text) console.error(`      content: "${row.text}"`);
    }
    console.error(`\n${rows.length} distinct violation(s) from ${violations.length} occurrence(s) `
        + `across ${tablesMeasured} table render(s).\n`);
    process.exit(1);
}

main().catch((error) => {
    console.error(`\nTable layout check could not run: ${error?.message || error}\n`);
    process.exit(1);
});
