/**
 * Speed monitoring loads only in a production build on one of the five known
 * hosts, and never on a page whose address is a secret: the Performance SDK
 * attaches the page address to everything it sends, so on those pages it must
 * not even be downloaded.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isSecretPath } from '@app/routes/routePattern';
import { LANDING_PATH, startSpeedMonitoring } from './speedMonitoring';

const PROD = Object.freeze({ PROD: true, VITE_RELEASE_SHA: 'abc1234def5678' });

function loader(result = true) {
  const startPageLoadTrace = vi.fn(() => result);
  const load = vi.fn(async () => ({ startPageLoadTrace }));
  return { load, startPageLoadTrace };
}

describe('starting speed monitoring', () => {
  it('captures the address the page was opened at, before the router can redirect', () => {
    expect(LANDING_PATH).toBe(window.location.pathname);
  });

  it.each([
    ['in development', { env: { ...PROD, PROD: false } }],
    ['in an E2E build', { env: { ...PROD, VITE_E2E_TEST_MODE: '1' } }],
    ['on a host that is neither Testing nor Production', { hostname: 'localhost' }],
    ['on a preview channel', { hostname: 'truckerapp-system--pr1-abc.web.app' }],
    ['on a verification link', { landingPath: '/verify/x' }],
    ['on a change-review link, even one no route matches', { landingPath: '/review-change/x/y' }],
  ])('loads nothing %s', async (_, overrides) => {
    const { load } = loader();
    const started = await startSpeedMonitoring({
      env: PROD, hostname: 'truckerapp-system.web.app', landingPath: '/apply/acme', load, ...overrides,
    });
    expect(started).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('loads once and names the page load by route, site and release', async () => {
    const { load, startPageLoadTrace } = loader();
    const started = await startSpeedMonitoring({
      env: PROD, hostname: 'truckerapp-system.web.app', landingPath: '/apply/acme', load,
    });
    expect(started).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(startPageLoadTrace).toHaveBeenCalledTimes(1);
    expect(startPageLoadTrace).toHaveBeenCalledWith(
      { route: '/apply/:slug', site: 'testing', release: 'abc1234' },
      { isSecretPath },
    );
  });

  it('measures the signing room on Production, and names a release it does not know', async () => {
    const { load, startPageLoadTrace } = loader();
    await startSpeedMonitoring({
      env: { PROD: true }, hostname: 'app.safehaul.io', landingPath: '/sign/c1/r1', load,
    });
    expect(startPageLoadTrace).toHaveBeenCalledWith(
      { route: '/sign/:companyId/:requestId', site: 'production', release: 'unknown' },
      { isSecretPath },
    );
  });

  it('resolves false, and never throws, when the chunk cannot load or the trace fails', async () => {
    const base = { env: PROD, hostname: 'truckerapp-system.web.app', landingPath: '/login' };
    await expect(startSpeedMonitoring({ ...base, load: () => Promise.reject(new Error('offline')) }))
      .resolves.toBe(false);
    await expect(startSpeedMonitoring({ ...base, load: async () => ({ startPageLoadTrace: () => { throw new Error('x'); } }) }))
      .resolves.toBe(false);
    await expect(startSpeedMonitoring({ ...base, load: async () => ({ startPageLoadTrace: () => false }) }))
      .resolves.toBe(false);
  });

  it('starts from main.jsx once the page is idle, and not from the start-up guards', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.jsx'), 'utf8');
    expect(main).toContain("import { startSpeedMonitoring } from '@app/startup/speedMonitoring';");
    expect(main).toMatch(/whenIdle\(\(\) => \{[^}]*\bstartSpeedMonitoring\(\);[^}]*\}\);/);
    const guards = readFileSync(resolve(process.cwd(), 'src/app/startup/startupGuards.jsx'), 'utf8');
    expect(guards).not.toMatch(/speedMonitoring|pageLoadTrace/);
  });
});
