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

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const STATIC_DIR = resolve(REPO_ROOT, 'storybook-static');
const SNAPSHOT_PATH = resolve(REPO_ROOT, 'src/design-system/tests/visual-contract.snapshot.json');

const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.woff': 'font/woff', '.woff2': 'font/woff2', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.map': 'application/json',
};

/**
 * What gets measured, and at which story.
 *
 * Each probe names a story, a selector, and the properties that are part of the
 * contract. Nothing here is incidental: every property is one the campaign
 * decided deliberately and that a careless change would silently undo.
 */
const PROBES = [
    {
        story: 'patterns-modal-chrome--sizes',
        label: 'the dialog chrome, and the eight widths that replaced thirty class lists',
        /*
         * Specimens rather than eight dialogs, because eight `position: fixed`
         * overlays would each cover the last and nothing could be measured. What
         * is under test is the CSS contract, and this reads it directly: the
         * widths, plus the surface, hairline border, radius and shadow that a
         * caller may no longer choose. A `className` slipping back onto a call
         * site is invisible to every static rule; a width that stops resolving
         * is not invisible here.
         */
        selectors: Object.fromEntries(
            ['sm', 'md', 'lg', 'xl', '2xl', '4xl', '5xl', '7xl'].map(
                (size) => [`panel[${size}]`, `.ds-modal__panel[data-size='${size}']`],
            ),
        ),
        properties: [
            'maxWidth', 'maxHeight', 'borderRadius', 'borderTopWidth', 'borderTopColor',
            'backgroundColor', 'boxShadow',
        ],
    },
    {
        story: 'components-modal--default',
        label: 'the dialog overlay, whose stacking layer is not a caller decision',
        /*
         * `zIndex` is the point. The mobile navigation drawer sits at
         * `--ds-z-modal` too, and every dialog that still replaces its own
         * overlay writes a bare `z-50` — which renders it BEHIND the drawer.
         * Nine hand-written workarounds exist for that. This reading is what
         * stops the contract's own overlay drifting back down.
         */
        selectors: { overlay: '.ds-modal' },
        properties: ['zIndex', 'backgroundColor', 'paddingTop', 'alignItems'],
    },
    {
        story: 'foundations-control-scale--input-and-button',
        label: 'the control scale, and the pairing it exists for',
        selectors: {
            'input[md]': '.ds-form-control:not([data-size])',
            'input[sm]': ".ds-form-control[data-size='sm']",
            'input[lg]': ".ds-form-control[data-size='lg']",
            'button[md]': ".ds-button[data-size='md']:not(.ds-icon-button)",
            'button[sm]': ".ds-button[data-size='sm']:not(.ds-icon-button)",
            'button[lg]': ".ds-button[data-size='lg']:not(.ds-icon-button)",
            'iconButton[md]': ".ds-icon-button[data-size='md']",
        },
        properties: ['height', 'fontSize', 'borderRadius', 'paddingLeft', 'paddingRight'],
    },
    {
        story: 'foundations-control-scale--every-control',
        label: 'an input and a select are the same control, and must look it',
        selectors: {
            // `backgroundColor` is the point. `.ds-form-control:read-only` used to
            // match every `<select>` — the pseudo-class means "not `:read-write`",
            // and only inputs and textareas ever are — so every dropdown in the
            // product wore the greyed read-only treatment. Height and type matched,
            // which is exactly why nobody caught it.
            'input[md]': 'input.ds-form-control:not([data-size])',
            'select[md]': 'select.ds-form-control:not([data-size])',
        },
        properties: ['height', 'fontSize', 'backgroundColor', 'borderColor', 'color'],
    },
    {
        story: 'components-button--link-variant',
        label: 'the one variant that leaves the control scale, and the one that does not',
        selectors: {
            // Pinned because the whole point of `link` is the absence of a box:
            // if a future edit lets the control height back in, every form row
            // carrying one silently grows and the link stops reading as text.
            'button[link]': ".ds-button[data-variant='link']",
            'button[ghost]': ".ds-button[data-variant='ghost']",
        },
        properties: ['height', 'fontSize', 'paddingLeft', 'paddingRight'],
    },
    {
        /*
         * The icon scale itself: six steps, measured, in one frame.
         *
         * `Icon.css` states these through `:where()`, which has ZERO specificity
         * — deliberately, so the container rules below still win. That makes the
         * scale unusually easy to lose: any stylesheet that mentions `.ds-icon`
         * at all outranks it, and the failure is a glyph quietly rendering at
         * the wrong size rather than an error. This reads the numbers back.
         */
        story: 'foundations-icons--scale',
        label: 'every step of the icon scale',
        selectors: {
            'icon[xs]': ".ds-icon[data-size='xs']",
            'icon[sm]': ".ds-icon[data-size='sm']",
            'icon[md]': ".ds-icon[data-size='md']",
            'icon[lg]': ".ds-icon[data-size='lg']",
            'icon[xl]': ".ds-icon[data-size='xl']",
            'icon[2xl]': ".ds-icon[data-size='2xl']",
            'icon[3xl]': ".ds-icon[data-size='3xl']",
        },
        properties: ['width', 'height'],
    },
    {
        /*
         * And the rule that outranks it. Every glyph in this story is written
         * `size="md"`; each renders at the size its CONTAINER decided. If the
         * `:where()` above were ever written as a plain class selector these
         * three would all read 16px and two buttons in a row would carry
         * different-sized glyphs — which is the defect the control scale was
         * built to end, arriving through the icon contract instead.
         */
        story: 'foundations-icons--inside-controls',
        label: 'a container still outranks the icon scale',
        selectors: {
            'icon in button[sm]': ".ds-button[data-size='sm'] .ds-button__content > svg",
            'icon in button[md]': ".ds-button[data-size='md'] .ds-button__content > svg",
            'icon in button[lg]': ".ds-button[data-size='lg'] .ds-button__content > svg",
        },
        properties: ['width', 'height'],
    },
    {
        story: 'foundations-control-scale--icon-normalisation',
        label: 'icon size is the system\'s decision, not the call site\'s',
        selectors: {
            'icon in button[md]': ".ds-button[data-size='md'] .ds-button__content > svg",
            'icon in button[sm]': ".ds-button[data-size='sm'] .ds-button__content > svg",
            'icon in button[lg]': ".ds-button[data-size='lg'] .ds-button__content > svg",
        },
        properties: ['width', 'height'],
    },
    {
        /*
         * The gap between a glyph and its label — the other half of the rule.
         *
         * The design system owns this as well as the icon size: `.ds-button` sets
         * `gap: var(--ds-space-2)` and `.ds-button__content` inherits it. Only
         * the icon size was measured until 2026-08-25, so a re-tuned gap would
         * have surfaced as a pixel diff on `button-with-icons` — which says a
         * screenshot changed — rather than as `columnGap: 8px -> 12px`, which
         * says what moved. Its own probe rather than extra properties on the one
         * above, because asking an `svg` for its `columnGap` records `normal`
         * three times and calls it a measurement.
         */
        story: 'foundations-control-scale--icon-normalisation',
        label: 'the gap between a glyph and its label is the system\'s too',
        selectors: {
            'gap in button[md]': ".ds-button[data-size='md'] .ds-button__content",
            'gap in button[sm]': ".ds-button[data-size='sm'] .ds-button__content",
            'gap in button[lg]': ".ds-button[data-size='lg'] .ds-button__content",
        },
        properties: ['columnGap'],
    },
    {
        story: 'components-card--padding',
        fallbackStory: 'components-card--default',
        label: 'the surface geometry every card shares',
        selectors: { card: '.ds-card' },
        properties: ['borderRadius', 'padding', 'borderTopWidth', 'backgroundColor'],
    },
    {
        story: 'components-badge--tones',
        fallbackStory: 'components-badge--default',
        label: 'badges hug their label and never stretch',
        selectors: { badge: '.ds-badge' },
        properties: ['height', 'fontSize', 'borderRadius', 'width'],
    },
    {
        /*
         * The native-table contract, measured because the roadmap approves a
         * native `<table>` for editable matrices and per-row interactive rows —
         * and because on 2026-08-25 seven of the eleven that use that permission
         * turned out to reference no `--ds-table-*` role at all, with three
         * different inline cell paddings between them. These are the numbers that
         * make the two kinds of table one table.
         */
        story: 'patterns-native-table--editable-matrix',
        label: 'a native table is the same table as DataTable',
        selectors: {
            // The surface is on the ROW; a header cell is transparent, so
            // measuring the cell's background would record nothing useful.
            'nativeTable.headerRow': '.ds-native-table thead tr',
            'nativeTable.headerCell': '.ds-native-table thead th',
            'nativeTable.cell': '.ds-native-table tbody td',
        },
        properties: ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'backgroundColor', 'height'],
    },
    {
        /*
         * The frozen first column, measured because it is the one cell in a native
         * table that must NOT be transparent. The surface is painted on the row,
         * so a `position: sticky` cell with no background of its own lets the
         * scrolled columns paint straight through it — which is what happened to
         * the Super Admin feature matrix when its hand-picked `bg-ds-surface` was
         * removed in favour of the contract, and what a review on 2026-08-25
         * caught. An `rgba(0, 0, 0, 0)` here is the regression.
         */
        story: 'patterns-native-table--sticky-first-column',
        label: 'a frozen column is opaque',
        selectors: {
            'stickyTable.headerCell': '.ds-native-table thead th.sticky',
            'stickyTable.rowHeader': '.ds-native-table tbody th.sticky',
        },
        properties: ['backgroundColor', 'position', 'left'],
    },
    {
        story: 'components-datatable--default',
        label: 'table density: row height and cell padding',
        selectors: {
            headerCell: '.ds-data-table th',
            bodyCell: '.ds-data-table td',
        },
        properties: ['height', 'paddingLeft', 'paddingRight', 'fontSize'],
    },
    {
        story: 'components-tabs--default',
        label: 'a tab is a control, at the control height',
        selectors: { tab: '.ds-tab' },
        properties: ['height', 'fontSize'],
    },
    {
        story: 'components-switch--states',
        label: 'switch geometry',
        selectors: { switch: '.ds-switch' },
        properties: ['width', 'height', 'borderRadius'],
    },
    {
        story: 'patterns-page-states--full-page-states',
        label: 'the three page states are the same shape as each other',
        selectors: {
            state: '.ds-page-state',
            title: '.ds-page-state__title',
            description: '.ds-page-state__description',
        },
        properties: ['padding', 'fontSize', 'maxWidth'],
    },
];

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
