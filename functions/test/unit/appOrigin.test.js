/**
 * A signing link carries the document's access token, so it is built only on
 * the app's own sites, whatever base URL a browser sent.
 */
const { trustedAppBaseUrl } = require('../../shared/appOrigin');

describe('trustedAppBaseUrl', () => {
    const saved = process.env.APP_BASE_URL;
    afterEach(() => {
        if (saved === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = saved;
    });

    it.each([
        ['https://app.safehaul.io', 'https://app.safehaul.io'],
        ['https://truckerapp-system.web.app/', 'https://truckerapp-system.web.app'],
        ['https://TRUCKERAPP-SYSTEM.firebaseapp.com/apply/x', 'https://truckerapp-system.firebaseapp.com'],
        ['https://safehaul-app-production.web.app', 'https://safehaul-app-production.web.app'],
    ])('keeps the app site %s, as its origin', (candidate, expected) => {
        expect(trustedAppBaseUrl(candidate)).toBe(expected);
    });

    it.each([
        ['another host', 'https://evil.example'],
        ['a look-alike host', 'https://app.safehaul.io.evil.example'],
        ['plain http', 'http://app.safehaul.io'],
        ['another port', 'https://app.safehaul.io:8443'],
        ['another scheme', 'javascript:alert(1)'],
        ['nothing', ''],
        ['not a string', { href: 'https://evil.example' }],
    ])('falls back to the configured base for %s', (_label, candidate) => {
        delete process.env.APP_BASE_URL;
        expect(trustedAppBaseUrl(candidate)).toBe('https://app.safehaul.io');
        process.env.APP_BASE_URL = 'https://truckerapp-system.web.app';
        expect(trustedAppBaseUrl(candidate)).toBe('https://truckerapp-system.web.app');
    });
});

// The browser names the same sites (`src/app/startup/site.js`, speed data): a
// site added to one list and not the other would get its links built on
// Production, or count as no site.
describe('the list of app sites', () => {
    it("is the browser's list of sites", () => {
        const fs = require('fs');
        const path = require('path');
        const root = path.join(__dirname, '..', '..', '..', 'src', 'app', 'startup');
        const site = fs.readFileSync(path.join(root, 'site.js'), 'utf8');
        const indexing = fs.readFileSync(path.join(root, 'searchIndexing.js'), 'utf8');
        const canonical = indexing.match(/CANONICAL_APP_HOST\s*=\s*['"]([^'"]+)['"]/)[1];
        const listed = [...site.matchAll(/\[\s*['"]([a-z0-9.-]+)['"]\s*,\s*['"](?:production|testing)['"]\s*\]/g)].map((m) => m[1]);
        const { APP_HOSTS } = require('../../shared/appOrigin');

        expect([...APP_HOSTS].sort()).toEqual([canonical, ...listed].sort());
    });
});
