import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { retryDelayMs, waitBeforeRetry } from './submitRetry';

describe('the wait before a failed submission is tried again', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is one second after the first attempt and two after the second', () => {
    expect([retryDelayMs(1), retryDelayMs(2)]).toEqual([1000, 2000]);
  });

  it('really waits that long', async () => {
    let done = false;
    waitBeforeRetry(2).then(() => { done = true; });

    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
