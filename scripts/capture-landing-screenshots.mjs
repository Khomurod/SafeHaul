#!/usr/bin/env node
/**
 * Captures the product screenshots used on the marketing site.
 *
 * ## Why this script exists
 *
 * The screenshots that shipped on the landing page before it were taken by hand
 * against a real tenant. They contained real driver names and real phone
 * numbers — personal data published on a public page — and one of them showed
 * "SafeHaul Network Leads", a feature that has since been removed from the
 * product. Both problems come from the same root cause: a manual capture from
 * production has nothing stopping it.
 *
 * So captures are automated against the fixture tenant instead. The app runs
 * with `VITE_E2E_TEST_MODE=1`, which points Firestore at a closed port and
 * serves in-memory fixtures, and `?demo=marketing` renames the tenant to a
 * fictional carrier. There is no route from this script to production data.
 *
 * ## Usage
 *
 *   VITE_E2E_TEST_MODE=1 npm run dev          # in one terminal
 *   node scripts/capture-landing-screenshots.mjs
 *
 * Add `--url=http://localhost:5000` to point elsewhere. Set `PW_CHROMIUM_EXECUTABLE`
 * if Playwright's bundled browser is not installed (sandboxes usually need this).
 */

import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'landing/assets/images/screenshots');

const argOf = (name, fallback) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
};

const BASE_URL = argOf('url', 'http://localhost:5000');
const DEMO = 'demo=marketing';

/**
 * Each capture names the story it supports on the landing page, so a future
 * change to the page can tell which shots still have a home.
 */
const SHOTS = [
    {
        name: 'pipeline',
        story: 'Hero + "Hire" story block',
        url: `/company/drivers/applications?e2eAuth=company_admin&${DEMO}`,
        waitFor: 'Driver Applications',
        viewport: { width: 1440, height: 900 },
    },
    {
        name: 'dashboard',
        story: 'Analytics bento tile',
        url: `/company/dashboard?e2eAuth=company_admin&${DEMO}`,
        waitFor: null,
        viewport: { width: 1440, height: 900 },
    },
    {
        name: 'campaigns',
        story: 'Bulk messaging bento tile',
        url: `/company/campaigns?e2eAuth=company_admin&e2eCampaign=mock&${DEMO}`,
        waitFor: 'Campaigns',
        viewport: { width: 1440, height: 900 },
    },
    {
        name: 'edocs',
        story: '"Sign" story block',
        url: `/company/e-docs?e2eAuth=company_admin&e2eEdoc=mock&${DEMO}`,
        waitFor: null,
        viewport: { width: 1440, height: 900 },
    },
    {
        name: 'signing-consent',
        story: '"Sign" story block, signer side',
        url: `/sign/e2e-company/e2e-request?token=e2e-token&e2eSign=mock&${DEMO}`,
        waitFor: 'Electronic Signature Consent',
        viewport: { width: 1200, height: 860 },
    },
    {
        name: 'driver-application-mobile',
        story: 'Driver experience block',
        url: `/apply/e2e-company?${DEMO}`,
        waitFor: 'Personal Information',
        viewport: { width: 390, height: 844 },
    },
    {
        name: 'super-admin',
        story: 'Multi-company management',
        url: `/super-admin?e2eAuth=super_admin&${DEMO}`,
        waitFor: 'Super Admin',
        viewport: { width: 1440, height: 900 },
    },
];

/**
 * Removes every animation and transition before the screenshot.
 *
 * Combined with the CDP capture below, this is what makes the output
 * byte-comparable between runs.
 */
const FREEZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
  /* Scrollbars differ between machines and would show up as diff noise. */
  ::-webkit-scrollbar { display: none !important; }
`;

async function main() {
    await mkdir(OUT_DIR, { recursive: true });

    const browser = await chromium.launch({
        executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined,
    });

    const results = [];

    for (const shot of SHOTS) {
        const context = await browser.newContext({
            viewport: shot.viewport,
            // 2x so the images stay sharp on the retina displays most buyers use.
            deviceScaleFactor: 2,
            isMobile: shot.viewport.width < 500,
            hasTouch: shot.viewport.width < 500,
        });
        const page = await context.newPage();

        try {
            await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });

            if (shot.waitFor) {
                await page.getByText(shot.waitFor, { exact: false }).first()
                    .waitFor({ timeout: 25000 });
            }
            // Let lazy chunks and fixture rendering settle.
            await page.waitForTimeout(5000);
            await page.addStyleTag({ content: FREEZE_CSS });
            await page.waitForTimeout(300);

            // Captured through CDP rather than `page.screenshot()` on purpose.
            // Playwright's screenshot waits for the page to be *visually
            // stable* — two identical frames — and the company workspace never
            // reaches that state reliably, so the call times out after 30s
            // instead of producing an image. The frozen CSS above already
            // removes the motion that the stability check exists to catch, so
            // the wait buys nothing here and costs every workspace capture.
            const client = await page.context().newCDPSession(page);
            const { data } = await client.send('Page.captureScreenshot', {
                format: 'png',
                captureBeyondViewport: false,
            });

            const file = path.join(OUT_DIR, `${shot.name}.png`);
            await writeFile(file, Buffer.from(data, 'base64'));
            results.push({ name: shot.name, ok: true, story: shot.story });
            console.log(`captured  ${shot.name.padEnd(28)} ${shot.story}`);
        } catch (error) {
            results.push({ name: shot.name, ok: false, story: shot.story });
            console.error(`FAILED    ${shot.name.padEnd(28)} ${String(error.message).split('\n')[0]}`);
        } finally {
            await context.close();
        }
    }

    await browser.close();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} captured into ${path.relative(ROOT, OUT_DIR)}`);

    // A partial capture is reported as a failure. Silently shipping a page with
    // a missing screenshot is exactly the sort of thing nobody notices until a
    // customer does.
    if (failed.length) {
        console.error(`Missing: ${failed.map((f) => f.name).join(', ')}`);
        process.exitCode = 1;
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
