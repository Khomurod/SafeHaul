// @vitest-environment node
/**
 * Pins what the privacy design in `pageLoadTrace.js` relies on in the installed
 * Firebase Performance SDK, so an update that changes it fails here instead of
 * sending a secret address. Read from the files the browser build bundles.
 *
 * Assertions are booleans on purpose: a failing `toContain` on the SDK source
 * would print the whole file into the log, and the SDK carries a Google API key.
 * That key's line is never read, matched or copied here; the secret scan would
 * refuse this file if it were.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CHANGED = '@firebase/performance changed: re-check the privacy design in pageLoadTrace.js before updating this test';

const nodeModules = resolve(process.cwd(), 'node_modules');
const readPackage = (name) => JSON.parse(readFileSync(resolve(nodeModules, name, 'package.json'), 'utf8'));
const browserSource = (name) => readFileSync(resolve(nodeModules, name, readPackage(name).exports['.'].default), 'utf8');

const performanceSdk = browserSource('@firebase/performance');
const installationsSdk = browserSource('@firebase/installations');
const has = (source, needle) => (typeof needle === 'string' ? source.includes(needle) : needle.test(source));
const majorOf = (version) => Number(/(\d+)/.exec(version)?.[1]);

describe('the installed Firebase Performance SDK', () => {
    it('cuts the query off the page address', () => {
        expect(has(performanceSdk, /getUrl\(\) \{[^}]*return this\.windowLocation\.href\.split\('\?'\)\[0\];/), CHANGED).toBe(true);
    });

    it('attaches the current page address to every event, which is why secret pages record nothing', () => {
        expect(has(performanceSdk, 'page_url: Api.getInstance().getUrl()'), CHANGED).toBe(true);
    });

    it('keeps its automatic page-load and network traces behind instrumentationEnabled', () => {
        expect(has(performanceSdk, '!settingsService.instrumentationEnabled && trace.isAuto'), CHANGED).toBe(true);
        expect(has(performanceSdk, 'if (!settingsService.instrumentationEnabled) {'), CHANGED).toBe(true);
    });

    it('flushes on the first hidden page after a deferral, so a trace recorded in that event is sent', () => {
        expect(has(performanceSdk, /setTimeout\(\(\) => \{\s*Trace\.createOobTrace\(/), CHANGED).toBe(true);
        expect(has(performanceSdk, /logTrace\(trace\);\s*flushLogs\(\);/), CHANGED).toBe(true);
    });

    it('uses the same web-vitals as the app, so the bundle holds one copy', () => {
        expect(has(performanceSdk, "from 'web-vitals/attribution';"), CHANGED).toBe(true);
        const wanted = readPackage('@firebase/performance').dependencies['web-vitals'];
        expect(majorOf(readPackage('web-vitals').version), CHANGED).toBe(majorOf(wanted));
    });

    it('talks to the origins the Content Security Policy allows', () => {
        expect(has(performanceSdk, 'https://firebaseremoteconfig.googleapis.com/v1/projects/'), CHANGED).toBe(true);
        expect(has(installationsSdk, "'https://firebaseinstallations.googleapis.com/v1'"), CHANGED).toBe(true);
        // The log endpoint is stored as two interleaved halves; only its own line is read.
        const halves = /flTransportEndpointUrl = mergeStrings\('([^']*)', '([^']*)'\)/.exec(performanceSdk);
        expect(halves, CHANGED).not.toBeNull();
        const [, first, second] = halves;
        const merged = [...first].map((char, i) => char + (second[i] ?? '')).join('');
        expect(merged, CHANGED).toBe('https://firebaselogging-pa.googleapis.com/v1/firelog/legacy/log');
    });
});
