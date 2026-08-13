#!/usr/bin/env node
/**
 * Holds the marketing site to the product's own verified capability package.
 *
 * ## Why this exists
 *
 * `functions/ai/knowledge/safehaulCapabilities.js` is the single approved
 * description of what SafeHaul does. Its `PROHIBITED_CLAIMS` list was written
 * with a remark that is the whole reason for this script: that several of the
 * claims on it were on the public landing page at the time.
 *
 * They were. The page promised "free forever" beside its own $199 and $299
 * plans, advertised a job board that does not exist in the codebase, described
 * document-expiry monitoring and renewal reminders that were never built, and
 * listed App Check, which had been deliberately removed with the residual risk
 * formally accepted. The automated blog was already forbidden from repeating
 * any of it — but nothing stopped the marketing page from saying it in the
 * first place.
 *
 * So the same deterministic check the article pipeline runs on every draft now
 * runs on the shipped HTML. It is the identical `checkClaims()` export, not a
 * copy, which is what stops the two drifting apart.
 *
 * Usage: `node scripts/check-landing-claims.mjs` (wired into `npm run lint`).
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANDING_DIR = path.join(ROOT, 'landing');

const { checkClaims, PROHIBITED_CLAIMS } = require(
    path.join(ROOT, 'functions/ai/knowledge/safehaulCapabilities.js'),
);

/**
 * Reduces a page to the words a visitor actually reads.
 *
 * Comments and markup are stripped first. A comment explaining *why* a claim is
 * not made would otherwise trip the very check it is documenting, and an
 * attribute value such as a URL is not a promise to a customer.
 */
function visibleText(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ');
}

const pages = readdirSync(LANDING_DIR).filter((file) => file.endsWith('.html'));

if (pages.length === 0) {
    console.error('check:landing-claims — no HTML found in landing/. That is not a pass.');
    process.exit(1);
}

let failures = 0;

for (const page of pages) {
    const html = readFileSync(path.join(LANDING_DIR, page), 'utf8');
    const result = checkClaims(visibleText(html));

    if (result.ok) {
        console.log(`ok      landing/${page}`);
        continue;
    }

    failures += result.violations.length;
    for (const violation of result.violations) {
        const reason = PROHIBITED_CLAIMS.find((entry) => entry.claim === violation.claim)?.reason;
        console.error(`FAIL    landing/${page}: ${violation.claim}`);
        if (reason) console.error(`        reason: ${reason}`);
    }
}

if (failures > 0) {
    console.error(
        `\n${failures} prohibited claim(s) on the marketing site.\n` +
        'Every product claim must trace to an `available` or `partial` entry in\n' +
        'functions/ai/knowledge/safehaulCapabilities.js. If the product genuinely\n' +
        'gained the capability, update that package first — it is the source of truth,\n' +
        'and the blog is generated from it.',
    );
    process.exit(1);
}

console.log(`\n${pages.length} page(s) clear of every prohibited claim.`);
