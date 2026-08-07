#!/usr/bin/env node
/**
 * Confirm a Hosting site is really serving the release we think we shipped.
 *
 * A successful `firebase` exit code says the CLI accepted the work, not that the
 * CDN is handing the new bundle to users. This reads `release.json` back off the
 * live origin — the same file any human can curl — and fails the promotion if the
 * SHA does not match, so a silent partial rollout is reported rather than
 * recorded as a success.
 *
 * Usage: node scripts/verify-live-release.mjs <origin> <expectedSha>
 */

const [, , origin, expectedSha] = process.argv;

if (!origin || !expectedSha) {
    console.error('Usage: verify-live-release.mjs <origin> <expectedSha>');
    process.exit(1);
}

const ATTEMPTS = 6;
const DELAY_MS = 10_000;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

let lastSeen = '(nothing)';

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
        // cache-bust so an edge copy of the previous release cannot answer for us
        const response = await fetch(`${origin}/release.json?at=${Date.now()}`, {
            headers: { 'Cache-Control': 'no-cache' },
        });

        if (!response.ok) {
            lastSeen = `HTTP ${response.status}`;
        } else if (!(response.headers.get('content-type') || '').includes('json')) {
            // The app targets rewrite `**` to /index.html, and Hosting only serves
            // a static file when one exists. So an HTML 200 here does not mean the
            // site is broken — it means this release has no release.json and the
            // SPA catch-all answered instead. Name that, rather than surfacing it
            // as an opaque JSON parse error at 2am.
            lastSeen = 'HTML from the SPA rewrite (no release.json in this build)';
        } else {
            const manifest = await response.json();
            lastSeen = manifest?.sha ?? '(no sha field)';
            if (lastSeen === expectedSha) {
                console.log(`${origin} is serving ${expectedSha} (verified on attempt ${attempt}).`);
                process.exit(0);
            }
        }
    } catch (error) {
        lastSeen = `request failed: ${error.message}`;
    }

    if (attempt < ATTEMPTS) {
        console.log(`Attempt ${attempt}: ${origin} still reports ${lastSeen}; retrying...`);
        await sleep(DELAY_MS);
    }
}

console.error(
    `${origin} did not serve ${expectedSha} within ${(ATTEMPTS * DELAY_MS) / 1000}s ` +
    `(last seen: ${lastSeen}).`,
);
process.exit(1);
