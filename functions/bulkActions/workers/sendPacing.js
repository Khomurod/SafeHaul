// functions/bulkActions/workers/sendPacing.js
//
// The pause between two sends of a bulk session: the next send starts three
// seconds after the last one started, and the loop pauses at least a tenth of
// a second, however long a send took. Also how long one batch keeps starting
// sends (`SEND_WINDOW_MS`). Its own module so a test can answer the
// pause at once, and still assert the pauses the loop asked for, instead of
// sleeping three real seconds for every recipient.

/** The next send starts this long after the last one started. */
const SEND_INTERVAL_MS = 3000;
/** The shortest pause, even after a send slower than the interval. */
const MIN_PAUSE_MS = 100;
/**
 * A batch starts no new send once this long has passed since its loop began,
 * so a slow SMS provider cannot run the 540-second worker out of time in the
 * middle of a send (Cloud Tasks would then run the batch again); the next batch
 * carries on. A normal batch takes about 150 s (50 sends, 3 s apart), so a
 * provider answering in 5 s still fits. The 270 s left cover the slowest single
 * recipient with 20-second request limits (re-log-in up to 40 s, a quick refusal
 * and a from-line fallback, 4 send attempts, 3 re-log-ins and 35 s of rate-limit
 * waits: about 235 s), plus the writes at the end of the batch.
 */
const SEND_WINDOW_MS = 270000;

/** How long to pause after a send that took `elapsedMs`. */
const pauseAfter = (elapsedMs) => Math.max(SEND_INTERVAL_MS - elapsedMs, MIN_PAUSE_MS);

const pauseBeforeNextSend = (elapsedMs) => new Promise((resolve) => {
    setTimeout(resolve, pauseAfter(elapsedMs));
});

module.exports = { SEND_INTERVAL_MS, MIN_PAUSE_MS, SEND_WINDOW_MS, pauseAfter, pauseBeforeNextSend };
