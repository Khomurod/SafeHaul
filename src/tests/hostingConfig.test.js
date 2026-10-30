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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const config = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
const robotsTxt = readFileSync(resolve(root, 'web/robots.txt'), 'utf8');
// FR-8 split the blog surface: `publicApi.js` keeps the router and
// `functions/blog/publicApi/` holds what it serves. The footer link and the
// robots backstop may live in any of those files, so this guard reads them
// all — and asserts it actually found a substantial surface, because a scan
// that silently reads nothing passes every toContain the wrong way.
const publicApiFiles = [
    resolve(root, 'functions/blog/publicApi.js'),
    ...readdirSync(resolve(root, 'functions/blog/publicApi'))
        .filter((name) => name.endsWith('.js'))
        .map((name) => resolve(root, 'functions/blog/publicApi', name)),
];
const publicApi = publicApiFiles.map((file) => readFileSync(file, 'utf8')).join('\n');

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
        // callable nothing could reach. `submitLandingLead` has since been retired
        // with the rest of the capture machinery; the leads it captured are
        // deliberately preserved and read through `listLandingLeads`.
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

    it('reads the whole split blog surface, not a stale path', () => {
        expect(publicApiFiles.length).toBeGreaterThan(3);
        expect(publicApi.length).toBeGreaterThan(10000);
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

describe('firebase.json — application sites: framing and Content Security Policy', () => {
    const APP_TARGETS = ['testing', 'production'];

    function appHeader(name, key) {
        const block = target(name).headers?.find((entry) => entry.source === '**');
        return block?.headers?.find((header) => header.key === key)?.value;
    }

    function directives(policy) {
        return Object.fromEntries(policy.split(';').map((part) => part.trim()).filter(Boolean)
            .map((part) => {
                const [name, ...values] = part.split(/\s+/);
                return [name, values];
            }));
    }

    // A CSP host source: `https://host`, or `https://*.domain` for subdomains.
    function allows(sources, url) {
        const { protocol, host } = new URL(url);
        return sources.some((source) => {
            if (source === `${protocol}`) return true;
            const match = /^(https?:)\/\/(\*\.)?(.+)$/.exec(source);
            if (!match || match[1] !== protocol) return false;
            return match[2] ? host.endsWith(`.${match[3]}`) : host === match[3];
        });
    }

    const reportOnly = directives(appHeader('production', 'Content-Security-Policy-Report-Only') ?? '');

    it.each(APP_TARGETS)('%s refuses to be framed by any other site', (name) => {
        // `frame-ancestors` is ignored in a report-only policy, so the framing rule
        // is enforced on its own; X-Frame-Options covers browsers without CSP 2.
        // SAMEORIGIN, not DENY: nothing frames the app from outside (it signs in
        // with email and password, so Firebase's auth iframe is never used), and
        // the app's own pages stay free to frame each other.
        expect(appHeader(name, 'X-Frame-Options')).toBe('SAMEORIGIN');
        expect(appHeader(name, 'Content-Security-Policy')).toBe("frame-ancestors 'self'");
    });

    it.each(APP_TARGETS)('%s enforces nothing but the framing rule', (name) => {
        // The full policy has not been proven against real traffic yet. Until it
        // has, an enforced directive other than frame-ancestors could break sign-in,
        // uploads, E-Docs or the Facebook integration for real users.
        expect(Object.keys(directives(appHeader(name, 'Content-Security-Policy')))).toEqual(['frame-ancestors']);
    });

    it('ships the same policy to testing and production', () => {
        // Production is a promoted Testing version and both use one backend, so a
        // difference here could only mean one site was edited and the other forgotten.
        for (const key of ['X-Frame-Options', 'Content-Security-Policy', 'Content-Security-Policy-Report-Only']) {
            expect(appHeader('testing', key)).toBe(appHeader('production', key));
        }
    });

    it('monitors a policy that allows no inline or evaluated script', () => {
        expect(reportOnly['default-src']).toEqual(["'self'"]);
        expect(reportOnly['script-src']).toContain("'self'");
        expect(reportOnly['script-src']).not.toContain("'unsafe-inline'");
        expect(reportOnly['script-src']).not.toContain("'unsafe-eval'");
        expect(reportOnly['object-src']).toEqual(["'none'"]);
        expect(reportOnly['base-uri']).toEqual(["'self'"]);
        // Ignored in report-only mode; it is enforced in its own header instead.
        expect(reportOnly['frame-ancestors']).toBeUndefined();
    });

    it('allows the Firebase services the app talks to', () => {
        for (const url of [
            'https://firestore.googleapis.com',
            'https://identitytoolkit.googleapis.com',
            'https://securetoken.googleapis.com',
            'https://firebasestorage.googleapis.com',
            'https://storage.googleapis.com',
            'https://us-central1-truckerapp-system.cloudfunctions.net',
            'https://o1.ingest.us.sentry.io',
            // Firestore's WebChannel loads //www.google.com/images/cleardot.gif to
            // tell a dead network from a failed request; seen on the E2E run.
            'https://www.google.com',
        ]) {
            expect(allows(reportOnly['connect-src'], url), url).toBe(true);
        }
        // Uploaded documents are previewed in an iframe straight from Storage, or
        // from an object URL when only `getBlob` can read them (`useAppFetch`).
        expect(allows(reportOnly['frame-src'], 'https://firebasestorage.googleapis.com')).toBe(true);
        expect(reportOnly['frame-src']).toContain('blob:');
        expect(reportOnly['connect-src']).toContain('blob:');
        // pdf.js runs from /pdf.worker.min.mjs; Sentry Replay compresses in a blob worker.
        expect(reportOnly['worker-src']).toEqual(["'self'", 'blob:']);
    });

    it('allows every external address the app hardcodes', () => {
        // Read from the code that makes the requests, so a new or moved
        // integration fails here instead of in a user's browser once enforced.
        const read = (file) => readFileSync(resolve(root, file), 'utf8');
        const hostsIn = (file) => [...read(file).matchAll(/https:\/\/[a-z0-9.-]+\.[a-z]{2,}/g)].map(([url]) => url);
        const expectations = [
            ['src/shared/services/fmcsaEmployerSocrata.js', 'connect-src'],
            ['src/shared/hooks/useBulkImport.js', 'connect-src'],
            ['src/features/settings/components/IntegrationsTab.jsx', null],
        ];
        for (const [file, directive] of expectations) {
            const urls = hostsIn(file);
            expect(urls.length, `${file} names no external address`).toBeGreaterThan(0);
            for (const url of urls) {
                const sources = directive
                    ? reportOnly[directive]
                    : [...reportOnly['script-src'], ...reportOnly['connect-src']];
                expect(allows(sources, url), `${url} from ${file}`).toBe(true);
            }
        }
        expect(read('src/features/api-guide/apiGuideContent.js'))
            .toContain('https://us-central1-truckerapp-system.cloudfunctions.net/');
        expect(read('src/lib/firebase/config.js')).toMatch(/getFunctions\(app\)/);
    });
});

describe('firebase.json — application sites: nosniff and long-lived build assets', () => {
    const APP_TARGETS = ['testing', 'production'];
    const IMMUTABLE = 'public, max-age=31536000, immutable';

    function block(name, source) {
        return target(name).headers?.find((entry) => entry.source === source);
    }

    function headerIn(name, source, key) {
        return block(name, source)?.headers?.find((header) => header.key === key)?.value;
    }

    it.each(APP_TARGETS)('%s tells browsers not to guess content types', (name) => {
        // Hosting already serves every built type correctly (`.js`, `.mjs`, `.css`,
        // `.woff2`, `.json`, `.ico`, `.svg`, checked on Testing), so nothing the
        // app loads can be refused for its type.
        expect(headerIn(name, '**', 'X-Content-Type-Options')).toBe('nosniff');
    });

    it.each(APP_TARGETS)('%s lets browsers keep /assets/ files until a release replaces them', (name) => {
        expect(headerIn(name, '/assets/**', 'Cache-Control')).toBe(IMMUTABLE);
        // Its own rule, with nothing else in it, so it cannot change any other header.
        expect(block(name, '/assets/**').headers).toHaveLength(1);
    });

    it.each(APP_TARGETS)('%s caches nothing else for long', (name) => {
        // index.html, /release.json and /pdf.worker.min.mjs keep their names across
        // releases, so they must stay on Hosting's one-hour default: a long cache
        // on them would hold browsers on an old build.
        for (const entry of target(name).headers) {
            if (entry.source === '/assets/**') continue;
            expect(entry.headers.map((header) => header.key)).not.toContain('Cache-Control');
        }
    });

    it('applies the same rules to testing and production', () => {
        expect(target('testing').headers).toEqual(target('production').headers);
    });

    it('puts only content-hashed files under /assets/', () => {
        // The long cache is safe only because every file there changes its name
        // when its content changes. Vite names them `[name]-[hash]` by default;
        // a custom naming pattern must keep the hash, and nothing in public/ may
        // land in /assets/ under a fixed name.
        expect(existsSync(resolve(root, 'public/assets'))).toBe(false);
        const vite = readFileSync(resolve(root, 'vite.config.js'), 'utf8');
        for (const option of ['assetFileNames', 'chunkFileNames', 'entryFileNames']) {
            const match = new RegExp(`${option}\\s*:\\s*['"\`]([^'"\`]+)`).exec(vite);
            if (match) expect(match[1], option).toContain('[hash]');
        }
        expect(vite).not.toMatch(/assetsDir\s*:/);
    });
});

describe('firebase.json — Firestore rules and indexes stay wired', () => {
    it('points at the committed rules and index files', () => {
        expect(config.firestore.rules).toBe('src/firestore.rules');
        expect(config.firestore.indexes).toBe('firestore.indexes.json');
        expect(config.storage.rules).toBe('src/storage.rules');
    });
});
