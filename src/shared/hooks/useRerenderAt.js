/**
 * Re-renders the caller just after `atMillis` (epoch milliseconds), for a view
 * whose state turns with the clock: a signing link that runs out, a seal that
 * counts as unfinished after ten minutes. Such views read the clock only when
 * they render, so without this the change waits for an unrelated render.
 *
 * Returns a count that grows on each such re-render, for a `useMemo` that reads
 * the clock. Nothing is scheduled for a time that is missing or already past.
 */
import { useEffect, useState } from 'react';

// Fire a little after the moment, so a strict "before now" comparison has turned.
const AFTER_MS = 1000;
// setTimeout's longest delay; a later moment is re-scheduled when this fires.
const MAX_DELAY_MS = 2 ** 31 - 1 - AFTER_MS;

export function useRerenderAt(atMillis) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        if (typeof atMillis !== 'number' || !Number.isFinite(atMillis)) return undefined;
        const delay = atMillis - Date.now();
        if (delay < 0) return undefined;
        const timer = setTimeout(() => setTick((count) => count + 1), Math.min(delay, MAX_DELAY_MS) + AFTER_MS);
        return () => clearTimeout(timer);
    }, [atMillis, tick]);

    return tick;
}

export default useRerenderAt;
