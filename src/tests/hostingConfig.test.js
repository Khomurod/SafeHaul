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
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
const robotsTxt = readFileSync(resolve(root, 'web/robots.txt'), 'utf8');
const publicApi = readFileSync(resolve(root, 'functions/blog/publicApi.js'), 'utf8');

// The target ALIASES are still `landing-*` because they map to the Firebase
// Hosting sites `safehaul-landing-{testing,production}`, and a site cannot be
// renamed. The marketing page they were named for is gone; what they serve now
// is `web/` — the blog's assets and the `serveBlogPublic` rewrites.
const PUBLIC_TARGETS = ['landing-testing', 'landing-production'];

function target(name) {
    const found = config.hosting.find((entry) => entry.target === name);
    expect(found, `hosting target ${name} is missing`).toBeDefined();
    return found;
}

function sources(name) {
    return target(name).rewrites.map((rewrite) => rewrite.source);
}

describe('firebase.json — landing rewrite order', () => {
    it.each(PUBLIC_TARGETS)('%s rewrites every news route', (name) => {
        const list = sources(name);
        for (const source of ['/news', '/news/**', '/api/news/**', '/sitemap.xml']) {
            expect(list.indexOf(source), `${source} is not rewritten`).toBeGreaterThan(-1);
        }
    });

    it.each(PUBLIC_TARGETS)('%s keeps any catch-all last', (name) => {
        // The catch-all went with the marketing homepage: it pointed at an
        // `/index.html` that `web/` does not contain, so it could only ever have
        // produced a 404 with extra steps. The ASSERTION stays, conditional,
        // because the original hazard was never the catch-all existing — it was
        // a news rewrite sitting after one and therefore never firing. If anyone
        // adds a catch-all back, it has to be last for the same reason as before.
        const list = sources(name);
        const catchAll = list.indexOf('**');
        if (catchAll === -1) return;
        expect(catchAll, 'the catch-all must be last').toBe(list.length - 1);
    });

    it.each(PUBLIC_TARGETS)('%s routes /news before /news/**', (name) => {
        // `/news/**` does not match `/news` itself, so both are needed; the
        // exact match first keeps the index page independent of glob semantics.
        const list = sources(name);
        expect(list.indexOf('/news')).toBeLessThan(list.indexOf('/news/**'));
    });

    it.each(PUBLIC_TARGETS)('%s sends the news routes to serveBlogPublic', (name) => {
        for (const rewrite of target(name).rewrites) {
            if (rewrite.source === '**') continue;
            expect(rewrite.function?.functionId).toBe('serveBlogPublic');
            expect(rewrite.function?.region).toBe('us-central1');
        }
    });

    it.each(PUBLIC_TARGETS)('%s no longer exposes the marketing lead endpoint', (name) => {
        // `/api/landing-lead` existed for a form on the marketing homepage. That
        // page is gone, so the public route is dead configuration pointing at a
        // callable nothing can reach. The `submitLandingLead` FUNCTION and the
        // leads it already captured are deliberately untouched — only the public
        // route is removed — so this asserts the route, not the function.
        expect(sources(name)).not.toContain('/api/landing-lead');
    });

    it.each(PUBLIC_TARGETS)('%s sends a bare visit to the articles', (name) => {
        // Without a homepage, `/` has nothing to serve. Hosting applies redirects
        // before rewrites, so this is what stops the apex domain 404ing.
        const redirect = target(name).redirects?.find((entry) => entry.source === '/');
        expect(redirect, 'the root redirect is missing').toBeDefined();
        expect(redirect.destination).toBe('/news');
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
    it.each(PUBLIC_TARGETS)('%s does not rewrite /robots.txt', (name) => {
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

    it('is not excluded from the public deploy artifact', () => {
        for (const name of PUBLIC_TARGETS) {
            const entry = target(name);
            expect(entry.public).toBe('web');
            // `**/.*` only hides dotfiles; robots.txt must not be listed.
            expect(entry.ignore).not.toContain('robots.txt');
        }
    });

    it('ships the standalone privacy policy', () => {
        // The marketing site is gone; this page is not. It is the only public
        // statement of how SafeHaul handles personal data, and a reachable
        // privacy URL is relied on by OAuth consent screens, app-store listings
        // and privacy law -- so losing it silently is a compliance failure, not
        // a broken link. The blog footer links it, and this asserts the file the
        // link resolves to actually deploys.
        expect(existsSync(resolve(root, 'web/privacy.html'))).toBe(true);
        const privacy = readFileSync(resolve(root, 'web/privacy.html'), 'utf8');
        expect(privacy).toContain('<title>Privacy Policy — SafeHaul</title>');
        expect(privacy).toContain('rel="canonical" href="https://safehaul.io/privacy.html"');
        // It carries no script: there is no build step and nothing to wire one to.
        expect(privacy).not.toMatch(/<script/i);
        // And it must not link back into the removed marketing site.
        expect(privacy).not.toMatch(/href="\/#/);
    });

    it('links the privacy policy from the blog footer', () => {
        expect(publicApi).toContain('href="/privacy.html"');
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
        // Both public sites deploy the same `web/` directory, so they ship
        // the same permissive robots.txt. A header is the only per-site control,
        // and without it the test site is duplicate content for the real one.
        expect(headerValue('landing-testing', 'X-Robots-Tag')).toBe('noindex, nofollow');
    });

    it('does not mark landing-production noindex', () => {
        expect(headerValue('landing-production', 'X-Robots-Tag')).toBeUndefined();
    });

    it('keeps the existing security headers on both landing sites', () => {
        for (const name of PUBLIC_TARGETS) {
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
