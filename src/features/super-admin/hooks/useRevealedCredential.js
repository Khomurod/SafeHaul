import { useCallback, useEffect, useRef, useState } from 'react';
import { isReauthCancelled } from '../services/aiIntegrations';

/**
 * Owns the single revealed AI credential on the AI Integrations page.
 *
 * ## Why this is a sibling of `useRevealedValue` rather than a shared hook
 *
 * The two enforce the same invariants — one slot, generation-guarded requests,
 * cleared on re-reveal, hide, tab-hidden, unmount and a 30-second timer — but
 * they reveal different things. The environment vault has a build-time branch
 * that reads a `VITE_*` value out of the shipped bundle because the server
 * cannot see it; an AI credential has no such case and must never grow one,
 * since every AI credential lives in Secret Manager. The vault's hook is also
 * pinned by a ~40-case contract suite. Generalising it to serve both would put
 * a bundle-reading branch on a path that must never have one, to save about a
 * hundred lines. The invariants are restated in tests for both.
 *
 * ## Why the slot is keyed on provider *and* field
 *
 * Cloudflare has a token and an account id; a provider can have more than one
 * credential field. The slot identity is `${providerId}:${field}` so revealing
 * Cloudflare's token cannot leave Cloudflare's other field revealed, and so a
 * second reveal anywhere on the page evicts the first.
 *
 * ## Where a revealed value is not
 *
 * React state only. Never `localStorage`, `sessionStorage`, IndexedDB, a `data-`
 * attribute, a `title`, the URL, a log line, an analytics event or a Sentry
 * breadcrumb, and never copied to the clipboard automatically. A refresh loses
 * it because nothing persisted it.
 */

export const REVEAL_WINDOW_SECONDS = 30;

/** The single slot's identity. */
export function credentialSlotId(providerId, field) {
    return `${providerId}:${field}`;
}

/**
 * @param {object} params
 * @param {(providerId: string, field: string) => Promise<object>} params.request
 *   Performs one reveal. The view supplies a wrapper that handles
 *   re-authentication, so this hook never has to know about session recency.
 */
export function useRevealedCredential({ request }) {
    const [revealedSlot, setRevealedSlot] = useState(null);
    const [revealedValue, setRevealedValue] = useState(null);
    const [unavailableReason, setUnavailableReason] = useState(null);
    const [secondsRemaining, setSecondsRemaining] = useState(0);
    const [pendingSlot, setPendingSlot] = useState(null);
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
        setRevealedSlot(null);
        setRevealedValue(null);
        setUnavailableReason(null);
        setSecondsRemaining(0);
        setPendingSlot(null);
    }, [clearTimer]);

    // Unmount — view change, logout, or the row's owner going away.
    useEffect(() => hide, [hide]);

    // A backgrounded tab is an unattended screen.
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
                    // in one place; a separate timeout could drift from it.
                    clearTimer();
                    setRevealedSlot(null);
                    setRevealedValue(null);
                    setUnavailableReason(null);
                    return 0;
                }
                return remaining - 1;
            });
        }, 1000);
    }, [clearTimer]);

    const reveal = useCallback(async (providerId, field) => {
        if (!providerId || !field) return;
        const slot = credentialSlotId(providerId, field);

        if (revealedSlot === slot) {
            hide();
            return;
        }

        // Evict the previous value before the request, not after: an in-flight
        // reveal must never leave an older secret on screen. This also bumps the
        // generation, invalidating any request still in the air.
        hide();
        setError(null);
        setPendingSlot(slot);
        const generation = generationRef.current;

        try {
            const result = await request(providerId, field);
            // Superseded by a later reveal, an explicit hide, or an unmount.
            if (generationRef.current !== generation) return;

            const value = result?.value ?? null;
            setRevealedSlot(slot);
            setRevealedValue(value);
            setUnavailableReason(value === null
                ? (result?.unavailableReason || 'This credential is not configured.')
                : null);
            startCountdown();
        } catch (caught) {
            if (generationRef.current !== generation) return;
            // The operator dismissed the re-authentication prompt. Nothing
            // happened, so nothing is reported.
            if (isReauthCancelled(caught)) return;
            setError({ slot, error: caught });
        } finally {
            if (generationRef.current === generation) setPendingSlot(null);
        }
    }, [hide, request, revealedSlot, startCountdown]);

    return {
        revealedSlot,
        revealedValue,
        unavailableReason,
        secondsRemaining,
        pendingSlot,
        error,
        reveal,
        hide,
    };
}
