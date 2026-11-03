import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A value the server computes (a count, a sum), read again when the data
 * behind it changes.
 *
 * - `run` is an async function, read when it runs; a new function on each
 *   render runs nothing again.
 * - Turning `enabled` on runs it at once and is `isLoading` in that same render
 *   (render-time adjustment). Disabled: no call, `value` null, a pending timer
 *   cleared, an answer still in flight dropped.
 * - Each later `refreshKey` change starts ONE timer of `intervalMs` unless one
 *   is pending; changes meanwhile fold into it. A fixed batch window, not a
 *   debounce: a steady stream of changes still refreshes every `intervalMs`.
 * - `refresh()` runs at once (Try again). Only the newest run's answer is kept.
 * - A failure is logged, `value` is null and `error` is set, so a screen shows
 *   it rather than a number that is no longer true. The previous value stays
 *   while a refresh is in flight.
 */
export function useServerAggregate({ run, enabled, refreshKey, intervalMs = 2000 }) {
    const isEnabled = Boolean(enabled);
    const [shownEnabled, setShownEnabled] = useState(isEnabled);
    const [value, setValue] = useState(null);
    const [isLoading, setIsLoading] = useState(isEnabled);
    const [error, setError] = useState(null);
    const runRef = useRef(run);
    const refreshKeyRef = useRef(refreshKey);
    const seenKeyRef = useRef(refreshKey);
    const versionRef = useRef(0);
    const timerRef = useRef(null);

    if (shownEnabled !== isEnabled) {
        setShownEnabled(isEnabled);
        setValue(null);
        setError(null);
        setIsLoading(isEnabled);
    }

    useEffect(() => {
        runRef.current = run;
        refreshKeyRef.current = refreshKey;
    });

    const execute = useCallback(() => {
        const version = ++versionRef.current;
        setIsLoading(true);
        Promise.resolve()
            .then(() => runRef.current())
            .then(
                (result) => {
                    if (version !== versionRef.current) return;
                    setValue(result);
                    setError(null);
                    setIsLoading(false);
                },
                (err) => {
                    console.error('Could not read a server total:', err);
                    if (version !== versionRef.current) return;
                    setValue(null);
                    setError(err ?? new Error('Could not read a server total.'));
                    setIsLoading(false);
                },
            );
    }, []);

    // Turned on: run now. Turned off or unmounted: drop what is in flight.
    useEffect(() => {
        if (!isEnabled) return undefined;
        seenKeyRef.current = refreshKeyRef.current;
        execute();
        return () => {
            versionRef.current += 1;
            clearTimeout(timerRef.current);
            timerRef.current = null;
        };
    }, [isEnabled, execute]);

    // The data changed: one run per batch window.
    useEffect(() => {
        if (!isEnabled || seenKeyRef.current === refreshKey) return;
        seenKeyRef.current = refreshKey;
        if (timerRef.current !== null) return;
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            execute();
        }, intervalMs);
    }, [isEnabled, refreshKey, intervalMs, execute]);

    const refresh = useCallback(() => {
        if (!isEnabled) return;
        clearTimeout(timerRef.current);
        timerRef.current = null;
        setError(null);
        execute();
    }, [isEnabled, execute]);

    return { value, isLoading, error, refresh };
}

export default useServerAggregate;
