import { useEffect, useRef, useState } from 'react';
import { connectPlatformAlertChat } from '../../services/platformAlerts';

/**
 * How often the page asks while a Start link waits, at most: 50 times in five
 * minutes, within the server's 60, however often the page is hidden and shown.
 */
export const START_CHECK_INTERVAL_MS = 6000;
/** No link outlives this, so a page left open stops asking on its own. */
const MAX_WATCH_MS = 20 * 60 * 1000;
/** Telegram or the network, briefly: the next check may well get through. */
const TRANSIENT = new Set(['functions/unavailable', 'functions/deadline-exceeded']);

/**
 * Asks, while a one-time Start link waits, whether the operator has pressed
 * Start on it, so the chat connects without a second press, and the bot's
 * confirmation arrives in Telegram while the person is still looking at it.
 *
 * It asks every few seconds whether or not the page is visible, and at once when
 * the page becomes visible again, the moment a person comes back from Telegram.
 * It stops when the chat connects, when the server says the link expired with no
 * Start in time, on any refusal but a brief outage, and when the page leaves.
 *
 * @param {object} options
 * @param {string|null} options.link the waiting link, or null when none waits
 * @param {(chat: { title: string }) => void} options.onConnected
 * @param {() => void} options.onExpired
 * @param {(error: Error) => void} options.onError
 * @returns {{ strayStart: boolean }} whether Telegram heard a Start without this link
 */
export function useStartLinkWatch({ link, onConnected, onExpired, onError }) {
    // Kept with the link it is about, so a new link starts without the old warning.
    const [stray, setStray] = useState({ link: null, value: false });
    // The latest handlers, so a re-render does not restart the watch.
    const handlers = useRef({ onConnected, onExpired, onError });
    useEffect(() => {
        handlers.current = { onConnected, onExpired, onError };
    });

    useEffect(() => {
        if (!link) return undefined;

        let stopped = false;
        let inFlight = false;
        let timer = null;
        let lastAskedAt = 0;
        const startedAt = Date.now();

        function stop() {
            stopped = true;
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
        }

        function schedule() {
            clearTimeout(timer);
            if (!stopped) timer = setTimeout(check, START_CHECK_INTERVAL_MS);
        }

        async function check() {
            if (stopped || inFlight) return;
            if (Date.now() - startedAt > MAX_WATCH_MS) {
                stop();
                return;
            }
            inFlight = true;
            lastAskedAt = Date.now();
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
                setStray({ link, value: Boolean(result.strayStart) });
            } catch (error) {
                if (stopped) return;
                if (!TRANSIENT.has(error?.code)) {
                    stop();
                    handlers.current.onError(error);
                    return;
                }
            } finally {
                inFlight = false;
            }
            schedule();
        }

        function onVisible() {
            if (document.visibilityState === 'visible' && Date.now() - lastAskedAt >= START_CHECK_INTERVAL_MS) check();
        }

        document.addEventListener('visibilitychange', onVisible);
        schedule();
        return stop;
    }, [link]);

    return { strayStart: Boolean(link) && stray.link === link && stray.value };
}
