import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMock = vi.hoisted(() => ({
    init: vi.fn(),
    addIntegration: vi.fn(),
    browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
    replayIntegration: vi.fn(() => ({ name: 'Replay' })),
}));
vi.mock('@sentry/react', () => sentryMock);
vi.mock('@shared/utils/scrub', () => ({ scrub: (value) => ({ scrubbed: value }) }));

import { attachSessionReplay, initSentry, whenIdle } from './sentry';

beforeEach(() => {
    vi.resetAllMocks();
});

describe('initSentry', () => {
    it('starts WITHOUT Session Replay and keeps the replay sample rates on the client', () => {
        initSentry({ PROD: true, VITE_SENTRY_DSN: 'dsn', VITE_RELEASE_SHA: 'abc', VITE_SENTRY_TRACES_SAMPLE_RATE: '0.05' });
        expect(sentryMock.init).toHaveBeenCalledTimes(1);
        const options = sentryMock.init.mock.calls[0][0];
        expect(options.integrations.map((i) => i.name)).toEqual(['BrowserTracing']);
        expect(sentryMock.replayIntegration).not.toHaveBeenCalled();
        expect(options).toMatchObject({ dsn: 'dsn', release: 'abc', tracesSampleRate: 0.05, replaysSessionSampleRate: 0.1, replaysOnErrorSampleRate: 1.0 });
        expect(options.beforeSend({ a: 1 })).toEqual({ scrubbed: { a: 1 } });
        expect(options.beforeBreadcrumb({ b: 2 })).toEqual({ scrubbed: { b: 2 } });
    });

    it('samples every trace outside production, and falls back to 0.2 when the configured rate is not a number', () => {
        initSentry({ PROD: false });
        expect(sentryMock.init.mock.calls[0][0].tracesSampleRate).toBe(1.0);
        initSentry({ PROD: true, VITE_SENTRY_TRACES_SAMPLE_RATE: 'lots' });
        expect(sentryMock.init.mock.calls[1][0].tracesSampleRate).toBe(0.2);
        expect(sentryMock.init.mock.calls[1][0].release).toBeUndefined();
    });
});

describe('attachSessionReplay', () => {
    it('adds the replay integration from the lazily loaded module', async () => {
        const load = vi.fn(async () => ({ replayIntegration: sentryMock.replayIntegration }));
        await expect(attachSessionReplay({ load })).resolves.toBe(true);
        expect(load).toHaveBeenCalledTimes(1);
        expect(sentryMock.addIntegration).toHaveBeenCalledWith({ name: 'Replay' });
    });

    it('swallows a failed chunk load instead of taking the app down', async () => {
        await expect(attachSessionReplay({ load: async () => { throw new Error('offline'); } })).resolves.toBe(false);
        expect(sentryMock.addIntegration).not.toHaveBeenCalled();
    });
});

describe('whenIdle', () => {
    const fakeWindow = (readyState) => {
        const listeners = {};
        return {
            document: { readyState },
            addEventListener: (type, fn) => { listeners[type] = fn; },
            requestIdleCallback: vi.fn((fn) => fn()),
            fire: (type) => listeners[type]?.(),
        };
    };

    it('waits for load, then for idle time', () => {
        const win = fakeWindow('loading');
        const task = vi.fn();
        whenIdle(task, { win });
        expect(task).not.toHaveBeenCalled();
        win.fire('load');
        expect(win.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 4000 });
        expect(task).toHaveBeenCalledTimes(1);
    });

    it('goes straight to idle on an already-loaded page, and uses a timer where requestIdleCallback is missing', () => {
        vi.useFakeTimers();
        const win = { document: { readyState: 'complete' }, addEventListener: vi.fn(), setTimeout: (fn, ms) => setTimeout(fn, ms) };
        const task = vi.fn();
        whenIdle(task, { win });
        expect(win.addEventListener).not.toHaveBeenCalled();
        expect(task).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2000);
        expect(task).toHaveBeenCalledTimes(1);
        vi.useRealTimers();
    });
});
