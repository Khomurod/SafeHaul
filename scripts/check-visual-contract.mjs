#!/usr/bin/env node
/**
 * Repository guard: the geometry of the design system does not change by
 * accident.
 *
 * Run:    `npm run check:visual-contract`   (after `npm run build-storybook`)
 * Update: `npm run check:visual-contract -- --update`
 *
 * ## Why this exists alongside the pixel baselines
 *
 * `e2e/visual/` holds screenshot baselines, and screenshots are the right tool
 * for "does this still look right". They are the wrong tool for "is the control
 * height still 44px", for two reasons:
 *
 *  1. **They cannot say what changed.** A diff of 900 pixels tells you something
 *     moved. This says `ds-button[md].height: 44 -> 40`.
 *  2. **They are not portable.** The catalog deliberately does not load Inter,
 *     so text rasterises with whatever `sans-serif` the runner has. A baseline
 *     captured on one machine can differ on another for reasons that have
 *     nothing to do with the design system.
 *
 * This measures *computed values* in a real browser instead — heights, padding,
 * font sizes, radii, resolved token colours. Those are identical on every
 * machine, so this is the layer that can be strictly blocking, and it is
 * measuring exactly the invariants the design-system campaign established.
 *
 * jsdom cannot do this either: it has no layout engine and no cascade
 * resolution, so `getComputedStyle` there returns the declared value or nothing.
 */

import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROBES } from './visual-contract/probes.mjs';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATIC_DIR = resolve(REPO_ROOT, 'storybook-static');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'src/design-system/tests/visual-contract.snapshot.json');

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.map': 'application/json',
};


const VIEWPORTS = [
    { width: 412, height: 915, label: 'mobile' },
    { width: 1440, height: 900, label: 'desktop' },
];

function startServer() {
    const server = createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        let target = join(STATIC_DIR, normalize(decodeURIComponent(url.pathname)));
        if (!target.startsWith(STATIC_DIR)) { response.writeHead(403); response.end(); return; }
        if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
        if (!existsSync(target)) { response.writeHead(404); response.end(); return; }
        response.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
        createReadStream(target).pipe(response);
    });
    return new Promise((resolveServer) => {
        server.listen(0, () => resolveServer({ server, port: server.address().port }));
    });
}

async function measure() {
    if (!existsSync(STATIC_DIR)) {
        console.error('\nNo built catalog. Run `npm run build-storybook` first.\n');
        process.exit(1);
    }

    const { server, port } = await startServer();
    const base = `http://127.0.0.1:${port}`;
    const index = await (await fetch(`${base}/index.json`)).json();
    const known = new Set(
        Object.values(index.entries || {}).filter((entry) => entry.type !== 'docs').map((entry) => entry.id),
    );

    const { chromium } = await import('@playwright/test');
    // Same override `playwright.config.cjs` and `check-table-layout.mjs` use, so
    // this runs in a sandbox whose system Chromium is not the pinned build.
    const executablePath = process.env.PW_CHROMIUM_EXECUTABLE;
    const browser = await chromium.launch(executablePath ? { executablePath } : {});

    const measured = {};
    let probesRun = 0;

    for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
        const page = await context.newPage();

        for (const probe of PROBES) {
            const story = known.has(probe.story) ? probe.story
                : (probe.fallbackStory && known.has(probe.fallbackStory) ? probe.fallbackStory : null);
            if (!story) {
                console.error(`\nProbe story not found: ${probe.story}. A renamed story silently stops being measured, so this is an error.\n`);
                await browser.close(); server.close();
                process.exit(1);
            }

            await page.goto(`${base}/iframe.html?id=${story}&viewMode=story`, { waitUntil: 'networkidle' });
            // Observable state, not a flat delay — the lesson `check-table-layout`
            // records. Fonts settle, then two painted frames.
            await page.evaluate(() => document.fonts.ready);
            await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

            const readings = await page.evaluate(({ selectors, properties }) => {
                const round = (value) => {
                    const numeric = Number.parseFloat(value);
                    return Number.isNaN(numeric) ? value : `${Math.round(numeric * 100) / 100}px`;
                };
                const result = {};
                for (const [name, selector] of Object.entries(selectors)) {
                    const element = document.querySelector(selector);
                    if (!element) { result[name] = null; continue; }
                    const computed = getComputedStyle(element);
                    const entry = {};
                    for (const property of properties) {
                        const raw = computed[property];
                        entry[property] = /^[\d.]+px$/.test(raw) ? round(raw) : raw;
                    }
                    result[name] = entry;
                }
                return result;
            }, { selectors: probe.selectors, properties: probe.properties });

            for (const [name, reading] of Object.entries(readings)) {
                if (reading === null) {
                    console.error(`\nProbe selector matched nothing: ${probe.story} → ${name}. A guard that measures nothing is not a guard.\n`);
                    await browser.close(); server.close();
                    process.exit(1);
                }
                measured[`${viewport.label} · ${probe.label} · ${name}`] = reading;
                probesRun += 1;
            }
        }
        await context.close();
    }

    await browser.close();
    server.close();
    return { measured, probesRun };
}

function main() {
    return measure().then(({ measured, probesRun }) => {
        if (probesRun === 0) {
            console.error('\nZero probes ran. That is a broken check, not a clean result.\n');
            process.exit(1);
        }

        if (process.argv.includes('--update')) {
            writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(measured, null, 2)}\n`);
            console.log(`Visual contract snapshot updated: ${probesRun} measurements.`);
            return;
        }

        let expected;
        try {
            expected = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8'));
        } catch {
            console.error('\nNo visual contract snapshot. Run with `--update` and commit the result.\n');
            process.exit(1);
        }

        const differences = [];
        for (const [key, reading] of Object.entries(measured)) {
            const before = expected[key];
            if (!before) { differences.push(`  + ${key} (new measurement)`); continue; }
            for (const [property, value] of Object.entries(reading)) {
                if (before[property] !== value) {
                    differences.push(`  ~ ${key} · ${property}: ${before[property]} -> ${value}`);
                }
            }
        }
        for (const key of Object.keys(expected)) {
            if (!measured[key]) differences.push(`  - ${key} (no longer measured)`);
        }

        if (differences.length > 0) {
            console.error('\nThe design system\'s geometry changed:\n');
            for (const line of differences) console.error(line);
            console.error('\nIf the change is intended, run');
            console.error('`npm run check:visual-contract -- --update` and commit the snapshot, so the');
            console.error('change is reviewed as a diff of values rather than discovered on a screen.\n');
            process.exit(1);
        }

        console.log(`Visual contract intact: ${probesRun} measurements across ${VIEWPORTS.length} widths, all unchanged.`);
    });
}

main().catch((error) => {
    console.error(`\nVisual contract check could not run: ${error.message}\n`);
    process.exit(1);
});
