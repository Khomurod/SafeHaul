/**
 * Which site a page runs on, for speed data. Production is promoted by cloning
 * the tested Testing version, so the build is the same on both and only the host
 * tells them apart; Hosting serves each site at `.web.app` and
 * `.firebaseapp.com` too. Any other host (a preview channel, localhost) is no
 * site we measure.
 */
import { CANONICAL_APP_HOST } from './searchIndexing';

const SITES = new Map([
  [CANONICAL_APP_HOST, 'production'],
  ['safehaul-app-production.web.app', 'production'],
  ['safehaul-app-production.firebaseapp.com', 'production'],
  ['truckerapp-system.web.app', 'testing'],
  ['truckerapp-system.firebaseapp.com', 'testing'],
]);

/** `'production'`, `'testing'`, or `null` for any other host. */
export function siteOf(hostname) {
  return SITES.get(String(hostname ?? '').toLowerCase()) ?? null;
}
