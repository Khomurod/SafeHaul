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
/** Telegram or the network, briefly: the next check may well get through. */
const TRANSIENT = new Set(['functions/unavailable', 'functions/deadline-exceeded']);

/**
 * Asks, while a one-time Start link waits, whether the operator has pressed
 * Start on it, so the chat connects without a second press, and the bot's
 * confirmation arrives in Telegram while the person is still looking at it.
 *
 * It asks every few seconds while the page is visible, less often while it is
 * hidden, and at once when it becomes visible again, the moment a person comes
 * back from Telegram. Told to slow down, it pauses for a minute and goes on.
 * It stops when the chat connects, when the server says the link expired with no
 * Start in time, when the server holds a different link (another page asked for
 * one), on any refusal but a brief outage, and when the page leaves.
 *
 * @param {object} options
 * @param {string|null} options.link the waiting link, or null when none waits
 * @param {(chat: { title: string }) => void} options.onConnected
 * @param {() => void} options.onExpired
 * @param {() => void} options.onLinkChanged the server holds another link: reload it
 * @param {(error: Error) => void} options.onError
 * @returns {{ strayStart: boolean }} whether Telegram heard a Start without this link
 */
export function useStartLinkWatch({ link, onConnected, onExpired, onLinkChanged, onError }) {
    // Kept with the link it is about, so a new link starts without the old warning.
    const [stray, setStray] = useState({ link: null, value: false });
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
                setStray({ link, value: Boolean(result.strayStart) });
            } catch (error) {
                if (stopped) return;
                if (error?.code === 'functions/resource-exhausted') {
                    pausedUntil = Date.now() + RATE_LIMITED_PAUSE_MS;
                    nextMs = RATE_LIMITED_PAUSE_MS;
                } else if (!TRANSIENT.has(error?.code)) {
                    stop();
                    handlers.current.onError(error);
                    return;
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
    }, [link]);

    return { strayStart: Boolean(link) && stray.link === link && stray.value };
}
