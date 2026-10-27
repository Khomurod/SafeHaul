/**
 * The two Sentry integrations attached once the page is idle, and nothing else.
 *
 * Imported only dynamically (`sentry.js`). The dynamic import names this small
 * module rather than `@sentry/react` itself, which every page loads at start-up:
 * a bundler that cannot see which exports a dynamic import of an
 * already-loaded module uses (Rolldown, from Vite 8) keeps all of them, and
 * the start-up chunk then carried Replay's recorder and tracing.
 * `check:bundle-budget` refuses either in the first download.
 */
export { browserTracingIntegration, replayIntegration } from '@sentry/react';
