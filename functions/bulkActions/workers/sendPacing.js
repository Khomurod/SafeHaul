// functions/bulkActions/workers/sendPacing.js
//
// The pause between two sends of a bulk session: the next send starts three
// seconds after the last one started, and the loop pauses at least a tenth of
// a second, however long a send took. Its own module so a test can answer the
// pause at once, and still assert the pauses the loop asked for, instead of
// sleeping three real seconds for every recipient.

/** The next send starts this long after the last one started. */
const SEND_INTERVAL_MS = 3000;
/** The shortest pause, even after a send slower than the interval. */
const MIN_PAUSE_MS = 100;

/** How long to pause after a send that took `elapsedMs`. */
const pauseAfter = (elapsedMs) => Math.max(SEND_INTERVAL_MS - elapsedMs, MIN_PAUSE_MS);

const pauseBeforeNextSend = (elapsedMs) => new Promise((resolve) => {
    setTimeout(resolve, pauseAfter(elapsedMs));
});

module.exports = { SEND_INTERVAL_MS, MIN_PAUSE_MS, pauseAfter, pauseBeforeNextSend };
