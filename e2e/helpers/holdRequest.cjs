// Holds matching requests at the network edge until the test releases them, so a
// loading state that is normally gone in a blink stays on screen to be checked.

/**
 * The dev server's module URL for the driver application's lazy screen. Both
 * the functional and the pixel lanes run on `npm run dev` (`playwright.config.cjs`
 * `webServer`), where each module is its own request.
 */
const APPLY_SCREEN_CODE = /\/PublicApplyHandler\.jsx(\?.*)?$/;

/**
 * Holds every request matching `pattern` until `release()`. `matched()` counts
 * the requests it held, so a test can prove the hold held something: a pattern
 * that matches nothing proves nothing.
 */
async function holdRequests(page, pattern) {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let matched = 0;
    await page.route(pattern, async (route) => {
        matched += 1;
        await gate;
        // The page may have closed while the request waited.
        await route.continue().catch(() => {});
    });
    return { release, matched: () => matched };
}

module.exports = { APPLY_SCREEN_CODE, holdRequests };
