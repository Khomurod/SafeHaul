/**
 * One answer kept in memory for a short while, so a page opened again soon
 * after does not read it again: the company dashboard's counts, its "Needs
 * attention", its hiring brief and its "Company setup" each keep one.
 *
 * The answer is kept for one key (the company, and what else it depends on) and
 * this sign-in (`auth.currentUser`, a new object after any sign-in), so another
 * company or another sign-in reads anew. Only the latest key is kept. A read
 * that fails, or an answer `keep` turns down, is not kept, so Try again reads
 * anew. Nothing about roles or access is kept here: callers decide who may see
 * an answer on every render.
 */
import { auth } from '@lib/firebase';

/** How long the company dashboard keeps what it read. */
export const DASHBOARD_KEEP_MS = 2 * 60 * 1000;

/**
 * `{ read(key, load), forget() }`: `read` returns the kept answer's promise
 * while it is fresh for `key` and this sign-in, else calls `load()` and keeps
 * its promise; `forget` drops the kept answer, so the next `read` loads.
 */
export function keptAnswer({ keepMs = DASHBOARD_KEEP_MS, keep = () => true } = {}) {
    let kept = null;

    function read(key, load) {
        const session = auth.currentUser;
        const now = Date.now();
        if (kept && kept.key === key && kept.session === session && now - kept.at < keepMs) {
            return kept.promise;
        }
        const entry = { key, session, at: now, promise: (async () => load())() };
        kept = entry;
        const drop = () => {
            if (kept === entry) kept = null;
        };
        entry.promise.then((answer) => {
            if (!keep(answer)) drop();
        }, drop);
        return entry.promise;
    }

    return {
        read,
        forget() {
            kept = null;
        },
    };
}

export default keptAnswer;
