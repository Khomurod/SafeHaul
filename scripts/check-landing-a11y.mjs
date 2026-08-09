#!/usr/bin/env node
/**
 * Accessibility audit for the static marketing site.
 *
 * ## Why this is a script and not a Playwright spec
 *
 * `playwright.config.cjs` boots the React application on port 5000 and points
 * `baseURL` at it. The marketing site is a different deployment with no build
 * step, so a spec under `e2e/` would need a second web server on a second port
 * — which is exactly the shared-server arrangement `AGENTS.md` warns about, and
 * it would collide with the sharded browser suite. This serves the folder
 * itself, on its own port, and exits.
 *
 * ## What it checks
 *
 * axe-core at three widths, plus the two keyboard behaviours axe cannot see:
 * the FAQ answers open from the keyboard, and focus is trapped inside the lead
 * dialog. Both were genuinely broken before the redesign — the FAQ was a `div`
 * with a click handler, and the dialog let Tab walk straight out into the page
 * behind it.
 *
 * Usage: `node scripts/check-landing-a11y.mjs`
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING = path.join(ROOT, 'landing');
const PORT = Number(process.env.LANDING_A11Y_PORT || 8137);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain; charset=utf-8',
};

function serveLanding() {
    const server = createServer(async (req, res) => {
        const url = decodeURIComponent((req.url || '/').split('?')[0]);
        let filePath = path.join(LANDING, url === '/' ? 'index.html' : url);

        // Contain every request to the landing folder.
        if (!filePath.startsWith(LANDING)) {
            res.writeHead(403).end('forbidden');
            return;
        }
        if (existsSync(filePath) && statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }
        if (!existsSync(filePath)) {
            res.writeHead(404).end('not found');
            return;
        }

        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
        res.end(await readFile(filePath));
    });

    return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const VIEWPORTS = [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
];

async function main() {
    const server = await serveLanding();
    const base = `http://127.0.0.1:${PORT}`;
    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
    });

    let failures = 0;

    for (const page of ['/', '/privacy.html']) {
        for (const viewport of VIEWPORTS) {
            const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
            const tab = await context.newPage();
            await tab.goto(`${base}${page}`, { waitUntil: 'load' });
            // The news strip fetches and then swaps in its fallback; auditing
            // before that settles would audit a placeholder.
            await tab.waitForTimeout(1500);

            const results = await new AxeBuilder({ page: tab })
                .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
                .analyze();

            if (results.violations.length === 0) {
                console.log(`ok      ${page.padEnd(14)} ${viewport.name}`);
            } else {
                failures += results.violations.length;
                for (const violation of results.violations) {
                    console.error(`FAIL    ${page} ${viewport.name}: ${violation.id} — ${violation.help}`);
                    for (const node of violation.nodes.slice(0, 3)) {
                        console.error(`        ${node.target.join(' ')}`);
                    }
                }
            }
            await context.close();
        }
    }

    // Keyboard behaviours axe cannot observe.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const tab = await context.newPage();
    await tab.goto(base, { waitUntil: 'load' });
    await tab.waitForTimeout(800);

    const faq = tab.locator('.faq-question').first();
    await faq.focus();
    await tab.keyboard.press('Enter');
    await tab.waitForTimeout(200);
    const faqOpened = await faq.getAttribute('aria-expanded') === 'true'
        && await tab.locator('#faq-a1').isVisible();
    console.log(`${faqOpened ? 'ok     ' : 'FAIL   '} FAQ answers open from the keyboard`);
    if (!faqOpened) failures += 1;

    await tab.getByRole('button', { name: 'Get started' }).first().click();
    await tab.waitForTimeout(400);
    const focusedIntoDialog = await tab.evaluate(
        () => !!document.activeElement?.closest('#leadModal'),
    );
    let trapped = true;
    for (let i = 0; i < 10; i += 1) {
        await tab.keyboard.press('Tab');
        // eslint-disable-next-line no-await-in-loop
        const inside = await tab.evaluate(() => !!document.activeElement?.closest('#leadModal'));
        if (!inside) { trapped = false; break; }
    }
    console.log(`${focusedIntoDialog ? 'ok     ' : 'FAIL   '} focus moves into the lead dialog`);
    console.log(`${trapped ? 'ok     ' : 'FAIL   '} focus stays inside the lead dialog`);
    if (!focusedIntoDialog) failures += 1;
    if (!trapped) failures += 1;

    await browser.close();
    server.close();

    if (failures > 0) {
        console.error(`\n${failures} accessibility problem(s).`);
        process.exit(1);
    }
    console.log('\nNo accessibility violations found.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
