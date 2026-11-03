/**
 * On the driver application's pages, asks for the screen's code as the app
 * starts, so it downloads while React renders and the session settles rather
 * than after (T1-F, `docs/qa/mobile-speed-baseline.md`). Other pages ask for
 * nothing. On `/sandbox/apply` it asks for the same screen, which the sandbox
 * wraps; the sandbox's own small chunk still loads with its route.
 *
 * `main.jsx` imports this right after the start-up guards, so the stale-release
 * reload is listening before the request starts. The loader is the route's own
 * (`applyScreenLoader.js`): the route gets this same request, and a failed
 * download ends as it did before. The `catch` only keeps this caller from
 * raising an unhandled rejection; the route still receives the failure.
 */
import { isApplyPagePath } from '@app/routes/applyPagePaths';
import { loadPublicApplyHandler } from '@app/routes/applyScreenLoader';

if (isApplyPagePath(window.location.pathname)) {
  loadPublicApplyHandler().catch(() => {});
}
