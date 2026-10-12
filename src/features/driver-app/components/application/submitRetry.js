/**
 * The wait before the page tries a failed submission again: one second after
 * the first attempt, two after the second.
 *
 * Its own module so the contract suites can answer the wait at once, and still
 * assert which waits the page asked for, instead of sleeping three real seconds
 * in every test of a failed delivery.
 */

/** How long to wait after `attempt` (1-based) failed. */
export const retryDelayMs = (attempt) => 1000 * 2 ** (attempt - 1);

export const waitBeforeRetry = (attempt) => new Promise((resolve) => {
  setTimeout(resolve, retryDelayMs(attempt));
});
