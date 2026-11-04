/**
 * A component used against its contract: an unknown tone, a blank label, a
 * heading level that is not one.
 *
 * Outside a production build — Vitest, `vite dev`, Playwright, Storybook — this
 * throws a `TypeError` with the message, so the misuse is caught where it is
 * written. A production build (Testing and Production) reports it once per
 * message, to the console, and returns: the caller then renders its default.
 * One such check once took a whole step of the driver application down over a
 * company question with a blank option.
 *
 * `PROD` is read on every call, so a test can stub it.
 */
const reported = new Set();

export function contractViolation(message) {
    const error = new TypeError(message);
    if (!import.meta.env.PROD) throw error;
    if (reported.has(message)) return;
    reported.add(message);
    console.error(error);
}
