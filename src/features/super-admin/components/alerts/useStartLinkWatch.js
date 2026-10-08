import { useEffect, useRef, useState } from 'react';
import { connectPlatformAlertChat } from '../../services/platformAlerts';

/**
 * How often a visible page asks while a Start link waits, at most: 50 times in
 * five minutes, within the server's 60, however often it is hidden and shown.
 */
export const START_CHECK_INTERVAL_MS = 6000;
/**
 * A hidden page still asks, so the bot's confirmation arrives while the person
 * is in Telegram, but less often: the server's budget is per person, and a
 * second page shares it.
 */
export const HIDDEN_CHECK_INTERVAL_MS = 30000;
/** After the server's "too many requests", such as two visible pages sharing one budget. */
export const RATE_LIMITED_PAUSE_MS = 60000;
/** No link outlives this, so a page left open stops asking on its own. */
const MAX_WATCH_MS = 20 * 60 * 1000;
/**
 * The refusals asking again cannot change: signed out, no longer allowed, the
 * bot gone or unable to write to the chat. Anything else is asked again: a
 * request that never got through reaches the browser as `functions/internal`,
 * a bad gateway as `unknown`, an offline token refresh as an `auth/` error.
 */
const FINAL = new Set([
    'functions/permission-denied', 'functions/unauthenticated', 'functions/failed-precondition',
    'functions/invalid-argument', 'functions/not-found',
]);
/** Errors in a row double the wait, up to this. */
export const MAX_ERROR_BACKOFF_MS = 60000;

/**
 * Asks, while a one-time Start link waits, whether the operator has pressed
 * Start on it, so the chat connects without a second press, and the bot's
 * confirmation arrives in Telegram while the person is still looking at it.
 *
 * It asks every few seconds while the page is visible, less often while it is
 * hidden, and at once when it becomes visible again, the moment a person comes
 * back from Telegram. Told to slow down, it pauses for a minute and goes on;
 * after an error it asks again, later each time. It stops when the chat
 * connects, when the server says the link expired with no Start in time, when
 * the server holds a different link (another page asked for one), at a refusal
 * asking again cannot change (`stopped`), and when the page leaves. A press of
 * Connect chat starts it again (`restart`), whatever stopped it.
 *
 * @param {object} options
 * @param {string|null} options.link the waiting link, or null when none waits
 * @param {(chat: { title: string }) => void} options.onConnected
 * @param {() => void} options.onExpired
 * @param {() => void} options.onLinkChanged the server holds another link: reload it
 * @param {(error: Error) => void} options.onError
 * @param {number} [options.restart] changed by each press, which starts the watch again
 * @returns {{ strayStart: boolean, stopped: boolean }} whether Telegram heard a Start
 *   without this link, and whether a refusal ended the watch for it
 */
export function useStartLinkWatch({ link, onConnected, onExpired, onLinkChanged, onError, restart = 0 }) {
    // Kept with the link and the press they are about, so a new one starts clean.
    const [stray, setStray] = useState({ link: null, value: false });
    const [refused, setRefused] = useState({ link: null, restart: null });
    // The latest handlers, so a re-render does not restart the watch.
    const handlers = useRef({ onConnected, onExpired, onLinkChanged, onError });
    useEffect(() => {
        handlers.current = { onConnected, onExpired, onLinkChanged, onError };
    });

    useEffect(() => {
        if (!link) return undefined;

        let stopped = false;
        let inFlight = false;
        let timer = null;
        let lastAskedAt = 0;
        let pausedUntil = 0;
        let errorsInARow = 0;
        const startedAt = Date.now();
        const interval = () => (document.visibilityState === 'hidden' ? HIDDEN_CHECK_INTERVAL_MS : START_CHECK_INTERVAL_MS);

        function stop() {
            stopped = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
        }

        function schedule(delayMs) {
            clearTimeout(timer);
            if (!stopped) timer = setTimeout(check, delayMs);
        }

        async function check() {
            if (stopped || inFlight) return;
            if (Date.now() - startedAt > MAX_WATCH_MS) {
                stop();
                return;
            }
            inFlight = true;
            lastAskedAt = Date.now();
            let nextMs = null;
            try {
                const result = await connectPlatformAlertChat({ checkOnly: true });
                if (stopped) return;
                if (result?.chat) {
                    stop();
                    handlers.current.onConnected(result.chat);
                    return;
                }
                if (!result?.pending) {
                    stop();
                    handlers.current.onExpired();
                    return;
                }
                if (result.pending.link && result.pending.link !== link) {
                    stop();
                    handlers.current.onLinkChanged();
                    return;
                }
                errorsInARow = 0;
                setStray({ link, value: Boolean(result.strayStart) });
            } catch (error) {
                if (stopped) return;
                if (error?.code === 'functions/resource-exhausted') {
                    pausedUntil = Date.now() + RATE_LIMITED_PAUSE_MS;
                    nextMs = RATE_LIMITED_PAUSE_MS;
                } else if (FINAL.has(error?.code)) {
                    stop();
                    setRefused({ link, restart });
                    handlers.current.onError(error);
                    return;
                } else {
                    errorsInARow += 1;
                    nextMs = Math.min(MAX_ERROR_BACKOFF_MS, interval() * 2 ** (errorsInARow - 1));
                }
            } finally {
                inFlight = false;
            }
            schedule(nextMs ?? interval());
        }

        function onVisible() {
            if (document.visibilityState !== 'visible' || Date.now() < pausedUntil) return;
            if (Date.now() - lastAskedAt >= START_CHECK_INTERVAL_MS) check();
        }

        document.addEventListener('visibilitychange', onVisible);
        schedule(interval());
        return stop;
    }, [link, restart]);

    return {
        strayStart: Boolean(link) && stray.link === link && stray.value,
        stopped: Boolean(link) && refused.link === link && refused.restart === restart,
    };
}
