/**
 * Only `app.safehaul.io` may be indexed. Testing shares the real backend, and its
 * Hosting headers are cloned onto Production, so the rule lives in the bundle.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CANONICAL_APP_HOST, keepNonCanonicalHostsOutOfSearch } from './searchIndexing';

const robots = () => document.head.querySelectorAll('meta[name="robots"]');

beforeEach(() => {
    document.head.innerHTML = '';
});

describe('keeping non-production hosts out of search', () => {
    it.each([
        'truckerapp-system.web.app',
        'truckerapp-system.firebaseapp.com',
        'safehaul-app-production.web.app',
        'localhost',
    ])('marks %s noindex, nofollow', (hostname) => {
        keepNonCanonicalHostsOutOfSearch(document, { hostname });
        expect(robots()).toHaveLength(1);
        expect(robots()[0].content).toBe('noindex, nofollow');
    });

    it('leaves app.safehaul.io indexable', () => {
        keepNonCanonicalHostsOutOfSearch(document, { hostname: CANONICAL_APP_HOST });
        expect(robots()).toHaveLength(0);
    });

    it('adds the tag once', () => {
        keepNonCanonicalHostsOutOfSearch(document, { hostname: 'truckerapp-system.web.app' });
        keepNonCanonicalHostsOutOfSearch(document, { hostname: 'truckerapp-system.web.app' });
        expect(robots()).toHaveLength(1);
    });

    it('is not a static tag or a Hosting header, which would reach Production', () => {
        // index.html is the same file on every host, and Production clones the
        // Testing Hosting version with its headers.
        const root = process.cwd();
        expect(readFileSync(resolve(root, 'index.html'), 'utf8')).not.toMatch(/name=["']robots["']/);
        const config = JSON.parse(readFileSync(resolve(root, 'firebase.json'), 'utf8'));
        for (const name of ['testing', 'production']) {
            const keys = (config.hosting.find((entry) => entry.target === name).headers || [])
                .flatMap((entry) => entry.headers.map((header) => header.key));
            expect(keys).not.toContain('X-Robots-Tag');
        }
        expect(readFileSync(resolve(root, 'src/main.jsx'), 'utf8')).toContain('keepNonCanonicalHostsOutOfSearch();');
    });
});
