import { useCallback, useEffect, useRef, useState } from 'react';
import { readBrowserVisibleValue } from '../config/browserVisibleEnvironment';
import { isReauthCancelled } from '../services/environmentVault';

/**
 * Owns the single revealed value on the Environment & Integrations page.
 *
 * ## Why exactly one slot
 *
 * The state holds one entry id and one value. That is not a simplification — it
 * is the mechanism by which "revealing one row never reveals another" is true:
 * there is nowhere for a second plaintext value to live, so a second reveal
 * necessarily evicts the first.
 *
 * ## Why in-flight requests carry a generation
 *
 * Only the row being revealed has its control disabled, so an operator can start
 * a reveal for row A and then start one for row B before A's response lands. If
 * A resolved last it would overwrite B's value and restart the countdown — a
 * secret the page had already evicted would reappear, attached to the wrong row.
 * Every request takes a generation number; a response whose generation is no
 * longer current is discarded. `hide()` bumps the generation too, so an
 * explicit hide cannot be undone by a request that was already in the air.
 *
 * ## Where a revealed value is *not*
 *
 * React state only. It is never written to `localStorage`, `sessionStorage`,
 * IndexedDB, a data attribute, the URL, a log line, an analytics event or a
 * Sentry breadcrumb, and it is never copied to the clipboard automatically. A
 * page refresh loses it because nothing persisted it.
 *
 * ## Everything that clears it
 *
 * The eye pressed again, a second reveal, the tab becoming hidden, the hook
 * unmounting (view change, logout, row unmount), and a 30-second timer. The
 * timer ticks once a second so the countdown shown next to the value is the real
 * remaining time rather than a decoration.
 *
 * @param {object} params
 * @param {(entryId: string) => Promise<object>} params.request Performs one
 *   reveal. The view supplies a wrapper that handles re-authentication, so this
 *   hook never has to know about session recency.
 */

export const REVEAL_WINDOW_SECONDS = 30;

export function useRevealedValue({ request }) {
    const [revealedId, setRevealedId] = useState(null);
    const [revealedValue, setRevealedValue] = useState(null);
    const [unavailableReason, setUnavailableReason] = useState(null);
    const [secondsRemaining, setSecondsRemaining] = useState(0);
    const [pendingId, setPendingId] = useState(null);
    const [error, setError] = useState(null);

    const timerRef = useRef(null);
    const generationRef = useRef(0);

    const clearTimer = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    /** Invalidates any in-flight reveal and clears whatever is on screen. */
    const hide = useCallback(() => {
        generationRef.current += 1;
        clearTimer();
        setRevealedId(null);
        setRevealedValue(null);
        setUnavailableReason(null);
        setSecondsRemaining(0);
        setPendingId(null);
    }, [clearTimer]);

    // Unmount — view change, logout, or the row's owner going away.
    useEffect(() => hide, [hide]);

    // A backgrounded tab is an unattended screen. Nothing stays revealed on one.
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') hide();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, [hide]);

    const startCountdown = useCallback(() => {
        clearTimer();
        setSecondsRemaining(REVEAL_WINDOW_SECONDS);
        timerRef.current = setInterval(() => {
            setSecondsRemaining((remaining) => {
                if (remaining <= 1) {
                    // Clearing inside the tick keeps the value and the countdown
                    // in one place; a separate timeout could drift apart from it.
                    clearTimer();
                    setRevealedId(null);
                    setRevealedValue(null);
                    setUnavailableReason(null);
                    return 0;
                }
                return remaining - 1;
            });
        }, 1000);
    }, [clearTimer]);

    /**
     * Reveals one entry. Always goes through the callable first — even for
     * build-time browser values, which the server cannot read — so that
     * authorisation, recency, rate limiting and the audit record apply
     * uniformly to every reveal.
     */
    const reveal = useCallback(async (entry) => {
        if (!entry) return;
        if (revealedId === entry.id) {
            hide();
            return;
        }

        // Evict the previous value before the request, not after: an in-flight
        // reveal must never leave an older secret on screen. This also bumps the
        // generation, invalidating any request still in the air.
        hide();
        setError(null);
        setPendingId(entry.id);
        const generation = generationRef.current;

        try {
            const result = await request(entry.id);
            // Superseded by a later reveal, an explicit hide, or an unmount.
            if (generationRef.current !== generation) return;

            let value = result?.value ?? null;
            let reason = result?.unavailableReason ?? null;

            if (result?.readFrom === 'client-bundle') {
                value = readBrowserVisibleValue(entry.key);
                if (value === null) reason = 'This build-time value is not set in the deployed bundle.';
            }

            setRevealedId(entry.id);
            setRevealedValue(value);
            setUnavailableReason(value === null ? (reason || 'No value is available from this source.') : null);
            startCountdown();
        } catch (caught) {
            if (generationRef.current !== generation) return;
            // The operator dismissed the re-authentication prompt. Nothing
            // happened, so nothing is reported.
            if (isReauthCancelled(caught)) return;
            setError({ entryId: entry.id, error: caught });
        } finally {
            if (generationRef.current === generation) setPendingId(null);
        }
    }, [hide, request, revealedId, startCountdown]);

    return {
        revealedId,
        revealedValue,
        unavailableReason,
        secondsRemaining,
        pendingId,
        error,
        reveal,
        hide,
    };
}
