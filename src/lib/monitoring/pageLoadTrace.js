/**
 * One `page_load` trace per page load in Firebase Performance Monitoring: the
 * time to the end of the load event, the Core Web Vitals as metrics, and the
 * route pattern, site, release and navigation type as attributes. Loaded only
 * by `src/app/startup/speedMonitoring.js`, once the page is idle, which also
 * keeps it off pages opened at a secret address. This module is type-checked,
 * so it imports nothing from `@app`: the caller passes `isSecretPath`.
 *
 * The privacy design rests on the SDK (`@firebase/performance` 0.7.7,
 * `dist/esm/index.esm2017.js`); `firebasePerformanceSdk.contract.test.js` pins
 * each point, so an update that changes one fails there.
 * - Every event carries `web_app_info.page_url`, the address when it is queued
 *   (:941), with the query cut off but the path kept (:155). So nothing is
 *   recorded while the current path is secret.
 * - `instrumentationEnabled: false` stops the automatic page-load trace, named
 *   `_wt_` + that address (:1254-1259), and the network traces, which name
 *   Storage paths and callables (:831-836, :870-874).
 * - On a hidden page only a flush sends: the SDK flushes once, one task after
 *   the first hidden `visibilitychange` (:1406-1417, :1289-1290). The trace is
 *   recorded synchronously in that event, so it is queued before the flush.
 * - `record()` checks no attribute (:1139-1141) and throws on a non-positive
 *   start or duration (:1126-1136), so values are cut and checked here.
 * - Any `performance.measure()` becomes a custom trace (:1386-1404), so this
 *   module never marks, measures, starts or stops one.
 */
import { initializePerformance, trace } from 'firebase/performance';
import { onCLS, onFCP, onINP, onLCP, onTTFB } from 'web-vitals/attribution';
import { app } from '@lib/firebase/config';

const MAX_ATTRIBUTE_LENGTH = 100;

/**
 * Each vital, the metric it is recorded as, and its scale (CLS is a fraction).
 * @type {ReadonlyArray<[
 *   (report: (metric: { value: number }) => void, options: { reportAllChanges: boolean }) => void,
 *   string,
 *   number,
 * ]>}
 */
const VITALS = Object.freeze([
    [onLCP, 'lcp_ms', 1],
    [onFCP, 'fcp_ms', 1],
    [onTTFB, 'ttfb_ms', 1],
    [onINP, 'inp_ms', 1],
    [onCLS, 'cls_x1000', 1000],
]);

let started = false;

function attributesOf(values) {
    /** @type {Record<string, string>} */
    const attributes = {};
    for (const [name, value] of Object.entries(values)) {
        const text = String(value ?? '').slice(0, MAX_ATTRIBUTE_LENGTH);
        if (text) attributes[name] = text;
    }
    return attributes;
}

/**
 * Sets up the trace; it is recorded when the page is first hidden. Once per
 * page. Returns `false` when nothing was set up: a second call, a tab loaded in
 * the background (it has no meaningful load time, and gets no installation), or
 * any failure.
 *
 * @param {{ route: string, site: string, release: string }} labels
 * @param {{
 *   isSecretPath: (pathname: string) => boolean,
 *   doc?: Pick<Document, 'visibilityState' | 'addEventListener'>,
 *   win?: { location: { pathname: string }, addEventListener: Window['addEventListener'] },
 *   perfApi?: Pick<Performance, 'timeOrigin' | 'getEntriesByType'>,
 * }} options
 * @returns {boolean}
 */
export function startPageLoadTrace({ route, site, release }, { isSecretPath, doc = document, win = globalThis, perfApi = performance }) {
    if (started) return false;
    started = true;
    try {
        if (doc.visibilityState !== 'visible') return false;
        const perf = initializePerformance(app, { instrumentationEnabled: false, dataCollectionEnabled: true });

        /** @type {Record<string, number>} */
        const metrics = {};
        const options = { reportAllChanges: true };
        for (const [onVital, name, scale] of VITALS) {
            onVital((metric) => { metrics[name] = Math.round(metric.value * scale); }, options);
        }

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            try {
                if (isSecretPath(win.location.pathname)) return;
                const nav = /** @type {PerformanceNavigationTiming | undefined} */ (perfApi.getEntriesByType('navigation')[0]);
                const duration = Math.round(nav?.loadEventEnd ?? 0);
                if (!(duration > 0)) return;
                trace(perf, 'page_load').record(perfApi.timeOrigin, duration, {
                    attributes: attributesOf({ route, site, release, nav: nav.type }),
                    metrics: { ...metrics },
                });
            } catch {
                // Speed data is never worth an error on the page.
            }
        };
        doc.addEventListener('visibilitychange', () => {
            if (doc.visibilityState === 'hidden') finish();
        });
        win.addEventListener('pagehide', finish);
        return true;
    } catch {
        return false;
    }
}
