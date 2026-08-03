/**
 * Firebase Hosting configuration guard.
 *
 * `firebase.json` is deployment configuration with no type checking, no linting
 * and no runtime that exercises it before it reaches production. Two of its
 * properties are load-bearing for News & Insights and both failed silently once:
 *
 *  1. **Rewrite order.** Hosting applies the *first* rewrite whose source
 *     matches. The landing site ends with a `**` catch-all to `/index.html`, so
 *     a news rewrite placed after it would never fire and `/news` would quietly
 *     serve the marketing homepage — which is exactly what happened before the
 *     order was fixed.
 *
 *  2. **`/robots.txt` is not rewritable.** Hosting's documented priority order
 *     is reserved namespaces → redirects → exact-match static content →
 *     rewrites. A rewrite of `/robots.txt` to `serveBlogPublic` was deployed to
 *     both landing sites and never fired; both returned an empty `404`. The file
 *     is now static, and this suite fails if anyone re-adds the rewrite.
 *
 * These assertions read the real `firebase.json`, so they hold the deployed
 * configuration to a contract rather than describing an intention.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
const robotsTxt = readFileSync(resolve(root, 'landing/robots.txt'), 'utf8');
const publicApi = readFileSync(resolve(root, 'functions/blog/publicApi.js'), 'utf8');

const LANDING_TARGETS = ['landing-testing', 'landing-production'];

function target(name) {
    const found = config.hosting.find((entry) => entry.target === name);
    expect(found, `hosting target ${name} is missing`).toBeDefined();
    return found;
}

function sources(name) {
    return target(name).rewrites.map((rewrite) => rewrite.source);
}

describe('firebase.json — landing rewrite order', () => {
    it.each(LANDING_TARGETS)('%s puts every specific rewrite before the catch-all', (name) => {
        const list = sources(name);
        const catchAll = list.indexOf('**');

        expect(catchAll, 'the catch-all rewrite is missing').toBeGreaterThan(-1);
        expect(catchAll, 'the catch-all must be last').toBe(list.length - 1);

        for (const source of ['/news', '/news/**', '/api/news/**', '/sitemap.xml', '/api/landing-lead']) {
            const position = list.indexOf(source);
            expect(position, `${source} is not rewritten`).toBeGreaterThan(-1);
            expect(position).toBeLessThan(catchAll);
        }
    });

    it.each(LANDING_TARGETS)('%s routes /news before /news/**', (name) => {
        // `/news/**` does not match `/news` itself, so both are needed; the
        // exact match first keeps the index page independent of glob semantics.
        const list = sources(name);
        expect(list.indexOf('/news')).toBeLessThan(list.indexOf('/news/**'));
    });

    it.each(LANDING_TARGETS)('%s sends the news routes to serveBlogPublic', (name) => {
        for (const rewrite of target(name).rewrites) {
            if (rewrite.source === '**' || rewrite.source === '/api/landing-lead') continue;
            expect(rewrite.function?.functionId).toBe('serveBlogPublic');
            expect(rewrite.function?.region).toBe('us-central1');
        }
    });

    it.each(LANDING_TARGETS)('%s leaves the existing lead endpoint first and intact', (name) => {
        // A pre-existing endpoint. News routing must not have reordered it.
        const first = target(name).rewrites[0];
        expect(first.source).toBe('/api/landing-lead');
        expect(first.function.functionId).toBe('submitLandingLead');
    });

    it('does not add news rewrites to the application targets', () => {
        // The SPA hosts are a different product surface; /news belongs to the
        // marketing site only.
        for (const name of ['testing', 'production']) {
            expect(sources(name)).toEqual(['**']);
        }
    });
});

describe('firebase.json — /robots.txt is served statically, never rewritten', () => {
    it.each(LANDING_TARGETS)('%s does not rewrite /robots.txt', (name) => {
        // Hosting resolves this path before rewrites. A rewrite here is dead
        // configuration that produces an empty 404, not a robots file.
        expect(sources(name)).not.toContain('/robots.txt');
    });

    it('ships a static robots.txt that Hosting will serve', () => {
        expect(robotsTxt).toMatch(/^User-agent: \*/m);
        expect(robotsTxt).toMatch(/^Allow: \/$/m);
    });

    it('points crawlers at the sitemap the function generates', () => {
        expect(robotsTxt).toContain('Sitemap: https://safehaul.io/sitemap.xml');
    });

    it('is not excluded from the landing deploy artifact', () => {
        for (const name of LANDING_TARGETS) {
            const entry = target(name);
            expect(entry.public).toBe('landing');
            // `**/.*` only hides dotfiles; robots.txt must not be listed.
            expect(entry.ignore).not.toContain('robots.txt');
        }
    });

    it('matches the body the function backstop returns', () => {
        // The function keeps a /robots.txt branch for direct hits on its own
        // URL. Two sources of truth for one file is how they drift apart, so
        // the pieces the static file asserts must appear there too.
        expect(publicApi).toContain("'User-agent: *'");
        expect(publicApi).toContain("'Allow: /'");
        expect(publicApi).toContain('Sitemap: ${ORIGIN}/sitemap.xml');
    });
});

describe('firebase.json — the testing landing site must not be indexed', () => {
    function headerValue(name, key) {
        const block = target(name).headers?.find((entry) => entry.source === '**');
        return block?.headers?.find((header) => header.key === key)?.value;
    }

    it('marks landing-testing noindex, so it cannot compete with production', () => {
        // Both landing sites deploy the same `landing/` directory, so they ship
        // the same permissive robots.txt. A header is the only per-site control,
        // and without it the test site is duplicate content for the real one.
        expect(headerValue('landing-testing', 'X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('does not mark landing-production noindex', () => {
        expect(headerValue('landing-production', 'X-Robots-Tag')).toBeUndefined();
    });

    it('keeps the existing security headers on both landing sites', () => {
        for (const name of LANDING_TARGETS) {
            expect(headerValue(name, 'X-Content-Type-Options')).toBe('nosniff');
            expect(headerValue(name, 'X-Frame-Options')).toBe('DENY');
            expect(headerValue(name, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
            expect(headerValue(name, 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
        }
    });
});

describe('firebase.json — Firestore rules and indexes stay wired', () => {
    it('points at the committed rules and index files', () => {
        expect(config.firestore.rules).toBe('src/firestore.rules');
        expect(config.firestore.indexes).toBe('firestore.indexes.json');
        expect(config.storage.rules).toBe('src/storage.rules');
    });
});
