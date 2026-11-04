import { describe, expect, it, vi } from 'vitest';

import { whenIdle } from './whenIdle';

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
