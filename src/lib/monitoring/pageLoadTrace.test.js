/**
 * One `page_load` per page load, recorded when the page is first hidden, with
 * the route pattern, site, release and navigation type, and only the vitals
 * that reported. Nothing on a page whose current address is a secret, nothing
 * from a tab that started in the background, and nothing that can break the
 * page. The SDK, web-vitals and the Firebase app are stand-ins; what the real
 * SDK does with the trace is pinned by `firebasePerformanceSdk.contract.test.js`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A stand-in for the caller's check (`src/app/routes/routePattern.js`, tested
// there): nothing under `src/lib` imports the app layer.
const isSecretPath = (pathname) => /^\/(?:verify|review-change)\//i.test(pathname);

const sdk = vi.hoisted(() => {
    const record = vi.fn(() => {});
    const start = vi.fn(() => {});
    const stop = vi.fn(() => {});
    const perf = { name: 'performance-instance' };
    return {
        record,
        start,
        stop,
        perf,
        initializePerformance: vi.fn(() => perf),
        trace: vi.fn(() => ({ record, start, stop })),
    };
});
vi.mock('firebase/performance', () => ({
    initializePerformance: sdk.initializePerformance,
    trace: sdk.trace,
}));

const vitals = vi.hoisted(() => {
    const reported = {};
    const register = (name) => vi.fn((callback, options) => { reported[name] = { callback, options }; });
    return {
        reported,
        onCLS: register('CLS'),
        onFCP: register('FCP'),
        onINP: register('INP'),
        onLCP: register('LCP'),
        onTTFB: register('TTFB'),
    };
});
vi.mock('web-vitals/attribution', () => ({
    onCLS: vitals.onCLS,
    onFCP: vitals.onFCP,
    onINP: vitals.onINP,
    onLCP: vitals.onLCP,
    onTTFB: vitals.onTTFB,
}));

// The real module waits for the Hosting config at top level.
const firebaseApp = vi.hoisted(() => ({ name: '[DEFAULT]' }));
vi.mock('@lib/firebase/config', () => ({ app: firebaseApp }));

const LABELS = Object.freeze({ route: '/apply/:slug', site: 'testing', release: 'abc1234' });
const TIME_ORIGIN = 1_762_000_000_000.25;

function fakePage({ visibilityState = 'visible', pathname = '/apply/acme', loadEventEnd = 1234.6, type = 'navigate' } = {}) {
    const listeners = { doc: {}, win: {} };
    const listen = (bucket) => (name, handler) => { (bucket[name] ||= []).push(handler); };
    const doc = { visibilityState, addEventListener: listen(listeners.doc) };
    const win = { location: { pathname }, addEventListener: listen(listeners.win) };
    const perfApi = {
        timeOrigin: TIME_ORIGIN,
        getEntriesByType: (kind) => (kind === 'navigation' ? [{ loadEventEnd, type }] : []),
        mark: vi.fn(() => {}),
        measure: vi.fn(() => {}),
    };
    const fire = (handlers) => { for (const handler of handlers || []) handler(); };
    return {
        doc,
        win,
        perfApi,
        listeners,
        hide: () => { doc.visibilityState = 'hidden'; fire(listeners.doc.visibilitychange); },
        show: () => { doc.visibilityState = 'visible'; fire(listeners.doc.visibilitychange); },
        pagehide: () => fire(listeners.win.pagehide),
    };
}

function report(name, value) {
    vitals.reported[name].callback({ name, value });
}

async function freshModule() {
    vi.resetModules();
    return import('./pageLoadTrace');
}

async function startOn(page, labels = LABELS) {
    const { startPageLoadTrace } = await freshModule();
    const started = startPageLoadTrace(labels, { isSecretPath, doc: page.doc, win: page.win, perfApi: page.perfApi });
    return { started, startPageLoadTrace };
}

beforeEach(() => {
    vi.resetAllMocks();
    for (const name of Object.keys(vitals.reported)) delete vitals.reported[name];
});

describe('the page_load trace', () => {
    it('starts Performance Monitoring with its automatic traces off', async () => {
        const page = fakePage();
        const { started } = await startOn(page);
        expect(started).toBe(true);
        expect(sdk.initializePerformance).toHaveBeenCalledTimes(1);
        expect(sdk.initializePerformance).toHaveBeenCalledWith(firebaseApp, {
            instrumentationEnabled: false,
            dataCollectionEnabled: true,
        });
    });

    it('follows every change of the five vitals', async () => {
        await startOn(fakePage());
        for (const name of ['CLS', 'FCP', 'INP', 'LCP', 'TTFB']) {
            expect(vitals.reported[name]?.options, name).toEqual({ reportAllChanges: true });
        }
    });

    it('initialises nothing in a tab that started in the background', async () => {
        const page = fakePage({ visibilityState: 'hidden' });
        const { started } = await startOn(page);
        expect(started).toBe(false);
        expect(sdk.initializePerformance).not.toHaveBeenCalled();
        expect(vitals.onLCP).not.toHaveBeenCalled();
        expect(page.listeners).toEqual({ doc: {}, win: {} });
    });

    it('records exactly one page_load when the page is first hidden, in that same event', async () => {
        const page = fakePage();
        await startOn(page);
        report('LCP', 2000);
        report('LCP', 2500.4);
        report('FCP', 1200.6);
        report('TTFB', 300.2);
        report('INP', 88.5);
        report('CLS', 0.0123);
        page.show();
        expect(sdk.record).not.toHaveBeenCalled();

        page.hide();

        expect(sdk.trace).toHaveBeenCalledTimes(1);
        expect(sdk.trace).toHaveBeenCalledWith(sdk.perf, 'page_load');
        expect(sdk.record).toHaveBeenCalledTimes(1);
        expect(sdk.record).toHaveBeenCalledWith(TIME_ORIGIN, 1235, {
            attributes: { route: '/apply/:slug', site: 'testing', release: 'abc1234', nav: 'navigate' },
            metrics: { lcp_ms: 2500, fcp_ms: 1201, ttfb_ms: 300, inp_ms: 89, cls_x1000: 12 },
        });
    });

    it('records nothing more on a later hidden event or pagehide', async () => {
        const page = fakePage();
        await startOn(page);
        page.hide();
        page.show();
        page.hide();
        page.pagehide();
        expect(sdk.record).toHaveBeenCalledTimes(1);
    });

    it('records exactly once when pagehide comes first', async () => {
        const page = fakePage({ type: 'reload' });
        await startOn(page);
        page.pagehide();
        page.hide();
        expect(sdk.record).toHaveBeenCalledTimes(1);
        expect(sdk.record.mock.calls[0][2].attributes.nav).toBe('reload');
    });

    it.each(['/verify/x', '/review-change/x/y'])('records nothing while the address is %s', async (pathname) => {
        const page = fakePage();
        await startOn(page);
        page.win.location.pathname = pathname;
        page.hide();
        page.pagehide();
        expect(sdk.trace).not.toHaveBeenCalled();
        expect(sdk.record).not.toHaveBeenCalled();
    });

    it('records nothing before the load event has ended', async () => {
        const page = fakePage({ loadEventEnd: 0 });
        await startOn(page);
        page.hide();
        expect(sdk.record).not.toHaveBeenCalled();
    });

    it('leaves out the vitals that never reported', async () => {
        const page = fakePage();
        await startOn(page);
        report('LCP', 1999.5);
        page.hide();
        expect(sdk.record.mock.calls[0][2].metrics).toEqual({ lcp_ms: 2000 });
    });

    it('cuts attribute values to 100 characters and drops empty ones', async () => {
        const page = fakePage({ type: '' });
        await startOn(page, { route: `/${'x'.repeat(150)}`, site: 'production', release: '' });
        page.hide();
        const { attributes } = sdk.record.mock.calls[0][2];
        expect(attributes).toEqual({ route: `/${'x'.repeat(99)}`, site: 'production' });
    });

    it('runs once per page', async () => {
        const page = fakePage();
        const { startPageLoadTrace } = await startOn(page);
        expect(startPageLoadTrace(LABELS, { isSecretPath, doc: page.doc, win: page.win, perfApi: page.perfApi })).toBe(false);
        expect(sdk.initializePerformance).toHaveBeenCalledTimes(1);
    });

    it('never marks, measures, starts or stops a trace', async () => {
        const page = fakePage();
        await startOn(page);
        page.hide();
        expect(sdk.record).toHaveBeenCalledTimes(1);
        expect(page.perfApi.mark).not.toHaveBeenCalled();
        expect(page.perfApi.measure).not.toHaveBeenCalled();
        expect(sdk.start).not.toHaveBeenCalled();
        expect(sdk.stop).not.toHaveBeenCalled();
    });

    it('returns false when the SDK refuses to start', async () => {
        sdk.initializePerformance.mockImplementation(() => { throw new Error('no indexedDB'); });
        const { started } = await startOn(fakePage());
        expect(started).toBe(false);
    });

    it('returns false when listening fails', async () => {
        const page = fakePage();
        page.doc.addEventListener = () => { throw new Error('closed'); };
        const { started } = await startOn(page);
        expect(started).toBe(false);
    });

    it('swallows a failure while recording, so the page never sees it', async () => {
        const page = fakePage();
        await startOn(page);
        sdk.record.mockImplementation(() => { throw new Error('nonpositive trace duration'); });
        expect(() => page.hide()).not.toThrow();
        expect(sdk.record).toHaveBeenCalledTimes(1);
    });

    it('swallows a failure reading the navigation entry', async () => {
        const page = fakePage();
        page.perfApi.getEntriesByType = () => { throw new Error('gone'); };
        await startOn(page);
        expect(() => page.hide()).not.toThrow();
        expect(sdk.record).not.toHaveBeenCalled();
    });
});
