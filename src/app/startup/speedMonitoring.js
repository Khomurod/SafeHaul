/**
 * Real-user speed monitoring: one `page_load` trace per page load in Firebase
 * Performance Monitoring (`src/lib/monitoring/pageLoadTrace.js`). `main.jsx`
 * starts it once the page is idle, and the SDK arrives in a chunk of its own, so
 * the first screen downloads nothing more (`check:bundle-budget`).
 *
 * Nothing is loaded in development or E2E builds, on any host but Testing's and
 * Production's, or on a page opened at a secret address: the SDK attaches the
 * page address to everything it sends, so on those it is not even downloaded.
 * The app layer decides this, because route code cannot live in `src/lib`
 * (`npm run typecheck` would then check `src/app/auth/roles.js`).
 */
import { isSecretPath, routePatternOf } from '@app/routes/routePattern';
import { siteOf } from './site';

/**
 * Where the page was opened. Read as this module is evaluated: `main.jsx`
 * evaluates its imports before it renders, so React Router has not redirected.
 */
export const LANDING_PATH = globalThis.location?.pathname ?? '/';

/**
 * Resolves `true` once the trace is set up, `false` when nothing was loaded or
 * anything failed. It never throws: a monitoring add-on must never take the
 * application down with it.
 */
export function startSpeedMonitoring({
  env = import.meta.env,
  hostname = globalThis.location?.hostname,
  landingPath = LANDING_PATH,
  load = () => import('@lib/monitoring/pageLoadTrace'),
} = {}) {
  const site = siteOf(hostname);
  if (!env.PROD || env.VITE_E2E_TEST_MODE === '1' || !site || isSecretPath(landingPath)) {
    return Promise.resolve(false);
  }
  const labels = {
    route: routePatternOf(landingPath),
    site,
    release: String(env.VITE_RELEASE_SHA || 'unknown').slice(0, 7),
  };
  return load()
    .then((module) => module.startPageLoadTrace(labels, { isSecretPath }))
    .catch(() => false);
}
