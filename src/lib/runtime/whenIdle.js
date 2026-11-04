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
