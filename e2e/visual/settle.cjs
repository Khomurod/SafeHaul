/**
 * Shared preparation for a screenshot.
 *
 * Two things matter and both were learned elsewhere in this repository:
 *
 *  1. **Settle on observable state, not a delay.** `check-table-layout.mjs`
 *     records that a flat 80ms wait produced a silently clean result. Fonts
 *     ready, then two painted frames.
 *
 *  2. **Fail loudly on a font difference, once.** Text is most of every
 *     screenshot, so if the runner rasterises with different glyphs then *every*
 *     baseline differs for a reason that has nothing to do with the design
 *     system. One assertion naming the font is a diagnosis; two hundred pixel
 *     diffs are a mystery.
 *
 *     This used to be an unavoidable hazard rather than a guard: the application
 *     fetched Inter from rsms.me and the catalog omitted it, so neither half had
 *     a font it controlled. Inter is served from `design-system/fonts/` now, so
 *     the assertion below is a real invariant — the font either loaded from the
 *     repository or something is broken.
 */
/**
 * The instant every baseline is captured at.
 *
 * Without this, any screen that renders "now" re-baselines itself every day —
 * the company dashboard's leaderboard date range is stamped with today's date,
 * so its baseline would have failed the morning after it was recorded. That is
 * the fastest possible way to teach a team to ignore a visual lane.
 *
 * `setFixedTime` rather than `clock.install()`: it fixes `Date.now()` and
 * `new Date()` while leaving timers running, so the application still finishes
 * loading. Installing the full fake clock pauses timers, and this app's mocked
 * data paths use them.
 */
const BASELINE_INSTANT = new Date('2026-06-15T12:00:00Z');

async function freezeClock(page) {
    await page.clock.setFixedTime(BASELINE_INSTANT);
}

async function settle(page) {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/**
 * A fingerprint of the font that actually rasterised.
 *
 * Two independent readings, because they fail differently.
 *
 * `interLoaded` comes from `document.fonts.check()`, which answers "can this
 * text be rendered with a face that is actually loaded" — so it distinguishes
 * "Inter is missing" from every other cause in one sentence. Deliberately not
 * `getComputedStyle().fontFamily`: that returns the *declared* stack, which
 * names Inter whether or not Inter loaded, and asserting on it is how a font
 * substitution goes unnoticed for a whole campaign.
 *
 * `width` is the metrics reading: the rendered width of a fixed pangram at a
 * fixed size. It catches the case `check()` cannot — a *different build* of
 * Inter, whose glyphs differ while the family name matches. Together they mean
 * a font problem is one legible failure rather than 150 pixel diffs.
 */
async function fontFingerprint(page) {
    return page.evaluate(() => {
        const probe = document.createElement('span');
        // A pangram: exercises enough glyphs that a substituted font shifts the
        // total width measurably, rather than coincidentally matching.
        probe.textContent = 'The quick brown fox jumps over the lazy dog 0123456789';
        probe.style.cssText = 'position:absolute;left:-9999px;white-space:nowrap;font-size:16px;font-weight:400';
        document.body.appendChild(probe);
        const width = Math.round(probe.getBoundingClientRect().width * 100) / 100;
        const family = getComputedStyle(probe).fontFamily;
        probe.remove();
        return { family, width, interLoaded: document.fonts.check('400 16px Inter') };
    });
}

/**
 * Options every screenshot in this suite uses.
 *
 * `animations: 'disabled'` freezes the loading medallion's spin and every
 * transition. `caret: 'hide'` stops a blinking cursor in a focused field from
 * making a screenshot non-deterministic. `scale: 'css'` keeps a 2x device pixel
 * ratio from doubling the baseline's size on a mobile lane.
 */
const SHOT = {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    /*
     * An absolute pixel budget, not a ratio.
     *
     * The first version of this used `maxDiffPixelRatio: 0.02`, which sounds
     * strict and is not: these are *full-page* screenshots, so on a 1440x900
     * capture 2% is roughly 26,000 pixels. Recolouring the danger badge changes
     * about 1,900 — so the lane sat green through a deliberate colour
     * regression, which is exactly the failure mode it exists to prevent. That
     * was caught by mutation-testing the guard rather than by trusting it.
     *
     * 100 pixels is well under any real change and well over the zero that two
     * runs of the same build actually produce. `threshold` stays at Playwright's
     * default 0.2 so per-pixel anti-aliasing noise is still absorbed.
     */
    maxDiffPixels: 100,
    /*
     * `threshold` is a *per-pixel* colour tolerance, and Playwright's default of
     * 0.2 is far more permissive than it sounds. Recolouring the danger badge
     * from `#fee2e2` to `#fef3c7` — two pale tints — produced a per-pixel delta
     * inside that default, so every pixel compared as "unchanged" and the lane
     * stayed green through a deliberate colour regression. Both this and the
     * pixel budget above were found by mutating the design system and checking
     * the guard actually failed, rather than by trusting it because it was
     * green.
     *
     * 0.02 still absorbs anti-aliasing (two runs of the same build produce zero
     * differing pixels, so there is headroom) while catching a tint change a
     * reviewer would notice.
     */
    threshold: 0.02,
};

module.exports = { BASELINE_INSTANT, freezeClock, settle, fontFingerprint, SHOT };
