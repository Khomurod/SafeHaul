/**
 * The browser half of the inventory guard.
 *
 * `functions/test/unit/environmentRegistry.inventory.test.js` proves the backend
 * registry knows every configuration key. This proves the *client* can resolve
 * every build-time one, because a `VITE_*` variable added to the app but not to
 * `browserVisibleEnvironment.js` would silently reveal as "not set" — a
 * confident, wrong answer, which is worse than an obvious gap.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    BROWSER_VISIBLE_KEYS,
    isBrowserValueConfigured,
    readBrowserVisibleValue,
} from './browserVisibleEnvironment';

const SRC_ROOT = path.resolve(__dirname, '../../..');
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', 'storybook-static']);

function walk(dir, out = []) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRECTORIES.has(item.name)) continue;
        const abs = path.join(dir, item.name);
        if (item.isDirectory()) walk(abs, out);
        else if (/\.(js|jsx)$/.test(item.name)) out.push(abs);
    }
    return out;
}

/** Every `VITE_*` key the application source reads, excluding test stubs. */
function viteKeysUsedInSource() {
    const keys = new Set();
    for (const file of walk(SRC_ROOT)) {
        if (/\.(test|spec)\.(js|jsx)$/.test(file)) continue;
        if (file.endsWith(path.join('config', 'browserVisibleEnvironment.js'))) continue;
        const source = fs.readFileSync(file, 'utf8');
        for (const match of source.matchAll(/import\.meta\.env\.(VITE_[A-Za-z0-9_]+)/g)) {
            keys.add(match[1]);
        }
    }
    return [...keys].sort();
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
});

describe('browser-visible environment map', () => {
    it('resolves every VITE_ variable the application reads', () => {
        const used = viteKeysUsedInSource();
        expect(used.length).toBeGreaterThan(5);
        expect(used.filter((key) => !BROWSER_VISIBLE_KEYS.includes(key))).toEqual([]);
    });

    it('reports presence without exposing the value', () => {
        // `src/tests/setup.js` stubs the Firebase keys for the Vitest run.
        expect(isBrowserValueConfigured('VITE_FIREBASE_PROJECT_ID')).toBe(true);
        expect(typeof isBrowserValueConfigured('VITE_FIREBASE_PROJECT_ID')).toBe('boolean');
    });

    /**
     * The module captures its values at import time, so the stub has to be in
     * place before a fresh import. Asserting against the ambient environment
     * instead would pass locally (no `.env`) and fail in CI, where the workflow
     * injects these variables — which is exactly what happened.
     */
    it('returns null for an unset variable rather than an empty string', async () => {
        vi.stubEnv('VITE_SOCRATA_APP_TOKEN', '');
        vi.resetModules();
        const reloaded = await import('./browserVisibleEnvironment.js');

        expect(reloaded.readBrowserVisibleValue('VITE_SOCRATA_APP_TOKEN')).toBeNull();
        expect(reloaded.isBrowserValueConfigured('VITE_SOCRATA_APP_TOKEN')).toBe(false);
    });

    it('resolves a variable that is set', async () => {
        vi.stubEnv('VITE_SOCRATA_APP_TOKEN', 'artificial-token');
        vi.resetModules();
        const reloaded = await import('./browserVisibleEnvironment.js');

        expect(reloaded.readBrowserVisibleValue('VITE_SOCRATA_APP_TOKEN')).toBe('artificial-token');
        expect(reloaded.isBrowserValueConfigured('VITE_SOCRATA_APP_TOKEN')).toBe(true);
    });

    it('refuses to resolve a key it does not know', () => {
        expect(readBrowserVisibleValue('VITE_NOT_A_REAL_KEY')).toBeNull();
        expect(readBrowserVisibleValue('PATH')).toBeNull();
        expect(readBrowserVisibleValue('constructor')).toBeNull();
    });
});
