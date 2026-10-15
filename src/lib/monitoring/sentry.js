/**
 * Sentry wiring, apart from `main.jsx` so the decisions in it can be tested
 * rather than trusted.
 *
 * 1. Session Replay is NOT part of `init`. It is the largest optional piece of
 *    the entry bundle (~125 kB before compression) and nothing about the first
 *    screen needs it, so it is attached once the page has loaded and the browser
 *    is idle, through a dynamic import — Sentry's own guidance for bundlers.
 *    Rollup then splits `@sentry-internal/replay` into its own chunk: measured
 *    on the production build, the entry fell from 1,184 kB to 1,069 kB
 *    (376 → 339 kB gzip), and `scripts/check-bundle-budget.mjs` refuses an entry
 *    that carries the recorder again.
 *
 * 2. The replay sample rates live on the client whether or not the integration
 *    is attached yet, so attaching later changes WHEN the recorder starts, not
 *    how often it records. An error in the first couple of seconds has no replay
 *    buffer behind it; that is the accepted cost, and the event itself still
 *    arrives with its breadcrumbs.
 *
 * 3. Tracing (`browserTracingIntegration`) is attached with Replay, from the same
 *    chunk: it was 19 kB of the first download's gzip. Errors are still captured
 *    from `init` on. The page-load span still starts at the navigation's time
 *    origin, which the SDK takes from the Performance API when the integration
 *    is set up, and web vitals are read from buffered entries; requests made
 *    before the attach carry no trace headers, and the first interactions are
 *    not measured.
 */
import * as Sentry from '@sentry/react';
import { scrub } from '@shared/utils/scrub';

const DEFAULT_TRACES_SAMPLE_RATE = 0.2;

export function initSentry(env = import.meta.env) {
    const configured = env.PROD ? Number(env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? DEFAULT_TRACES_SAMPLE_RATE) : 1.0;
    Sentry.init({
        dsn: env.VITE_SENTRY_DSN,
        // Tag events with the build SHA so they resolve against the sourcemaps CI
        // uploads for that release. Undefined in local/PR builds — harmless.
        release: env.VITE_RELEASE_SHA || undefined,
        // Nothing optional at start-up: tracing and Replay arrive together once
        // the page is idle (`attachDeferredIntegrations`).
        integrations: [],
        tracesSampleRate: Number.isFinite(configured) ? configured : DEFAULT_TRACES_SAMPLE_RATE,
        replaysSessionSampleRate: 0.1,
        replaysOnErrorSampleRate: 1.0,
        // A5: deep-scrub PII from every event and breadcrumb before it leaves the browser.
        beforeSend: (event) => scrub(event),
        beforeBreadcrumb: (breadcrumb) => scrub(breadcrumb),
    });
}

/**
 * Runs `task` after the page has finished loading and the browser reports
 * idle time (falling back to a short timer where `requestIdleCallback` is
 * missing, as in Safari), so the deferred work never competes with the first
 * screen for bandwidth or the main thread.
 */
export function whenIdle(task, { win = globalThis } = {}) {
    const idle = () => (typeof win.requestIdleCallback === 'function'
        ? win.requestIdleCallback(() => task(), { timeout: 4000 })
        : win.setTimeout(() => task(), 2000));
    if (win.document?.readyState === 'complete') idle();
    else win.addEventListener('load', idle, { once: true });
}

/**
 * The two integrations, named where the module is imported. Rollup keeps only
 * the exports a dynamic import's `then` destructures; when the whole module
 * was passed on, the chunk carried all of `@sentry/react` — the Feedback widget
 * and Replay's canvas recording among it — 120 kB gzip instead of 58 kB, which
 * every page downloads once idle.
 */
const loadDeferredIntegrations = () => import('@sentry/react')
    .then(({ browserTracingIntegration, replayIntegration }) => ({ browserTracingIntegration, replayIntegration }));

/**
 * Attaches tracing and Session Replay to the running client, from one lazily
 * loaded chunk. Resolves `true` when attached and `false` when the chunk could
 * not be loaded — a monitoring add-on must never take the application down with
 * it.
 */
export function attachDeferredIntegrations({ load = loadDeferredIntegrations } = {}) {
    return load()
        .then((lazy) => {
            Sentry.addIntegration(lazy.browserTracingIntegration());
            Sentry.addIntegration(lazy.replayIntegration());
            return true;
        })
        .catch(() => false);
}
