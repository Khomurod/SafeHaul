/**
 * The same build runs on Testing and, once promoted, on Production, so the site
 * a page load belongs to is read from the host it runs on.
 */
import { describe, expect, it } from 'vitest';
import { siteOf } from './site';

describe('the site a page runs on', () => {
  it.each([
    ['app.safehaul.io', 'production'],
    ['safehaul-app-production.web.app', 'production'],
    ['safehaul-app-production.firebaseapp.com', 'production'],
    ['truckerapp-system.web.app', 'testing'],
    ['truckerapp-system.firebaseapp.com', 'testing'],
  ])('%s is %s, in any case', (hostname, site) => {
    expect(siteOf(hostname)).toBe(site);
    expect(siteOf(hostname.toUpperCase())).toBe(site);
  });

  it.each([
    'localhost',
    '127.0.0.1',
    'truckerapp-system--pr1-abc.web.app',
    'example.com',
    '',
    undefined,
  ])('%s is no site we measure', (hostname) => {
    expect(siteOf(hostname)).toBeNull();
  });
});
