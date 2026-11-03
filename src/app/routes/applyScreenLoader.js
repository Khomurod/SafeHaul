/**
 * The driver application's screen code, asked for at most once per page.
 *
 * Two callers share it: the route's lazy screen (`featureRegistry.jsx`) and, on
 * an apply page, the start-up warm-up (`@app/startup/warmApplyScreen`), which
 * asks before React renders. Both get this one promise, so the screen downloads
 * once, and a download that fails reaches the route as it always did: one
 * attempt, one `vite:preloadError` for the stale-release reload, and the
 * route's error screen. React.lazy keeps its first result too, so a failed
 * screen was never retried within a page.
 */
let screenCode;

export function loadPublicApplyHandler() {
  screenCode ??= import('@features/driver-app/components/application/PublicApplyHandler');
  return screenCode;
}
