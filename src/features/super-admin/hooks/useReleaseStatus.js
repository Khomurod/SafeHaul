import { useCallback, useEffect, useRef, useState } from 'react';
import { describeReleaseError, getReleaseStatus } from '../services/releaseManagement';

/**
 * Loads the authoritative release state and keeps it fresh while a release runs.
 *
 * ## Why it polls, and why only sometimes
 *
 * A release takes minutes and its outcome is decided by GitHub and Firebase, not
 * by this screen. Reporting "Released" the moment the button was pressed would
 * be a lie the operator could act on, so the screen never claims an outcome it
 * has not read back from the server. While a release is in flight it re-reads
 * every few seconds; when nothing is happening it stops, because a status page
 * that polls forever is a status page nobody leaves open.
 *
 * The hook holds no credential and no secret. Everything it stores is a public
 * release identifier: commit SHAs, Hosting version ids, a run id, timestamps.
 */

/** How often to re-read while a release is running. */
const ACTIVE_POLL_MS = 6000;

/** Phases the screen renders. Derived from the server, never assumed locally. */
export const RELEASE_PHASES = Object.freeze({
    IDLE: 'idle',
    STARTING: 'starting',
    RUNNING: 'running',
    SUCCEEDED: 'succeeded',
    FAILED: 'failed',
});

/**
 * Turns the server's promotion record into one of five phases.
 *
 * `activePromotion` is GitHub's own answer to "is a release running", so a
 * release started from anywhere — this screen, or a manual dispatch during an
 * incident — is reflected here.
 */
export function derivePhase(status) {
    if (!status) return RELEASE_PHASES.IDLE;

    const active = status.activePromotion;
    if (active) {
        return active.status === 'queued' ? RELEASE_PHASES.STARTING : RELEASE_PHASES.RUNNING;
    }

    const latest = status.latestPromotion;
    if (!latest) return RELEASE_PHASES.IDLE;

    if (latest.status === 'dispatched' && !latest.runId) return RELEASE_PHASES.STARTING;
    if (latest.status && latest.status !== 'completed') return RELEASE_PHASES.RUNNING;
    if (latest.conclusion === 'success') return RELEASE_PHASES.SUCCEEDED;
    if (latest.conclusion) return RELEASE_PHASES.FAILED;
    return RELEASE_PHASES.IDLE;
}

const IN_FLIGHT = new Set([RELEASE_PHASES.STARTING, RELEASE_PHASES.RUNNING]);

export function useReleaseStatus() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Every completed read, successful or not. The polling effect keys off this
    // rather than off `status`, because a FAILED read leaves `status` byte-for-
    // byte identical — so the effect would not re-run, the next timer would
    // never be scheduled, and a single transient network blip would leave the
    // screen frozen on "Releasing…" until someone pressed Refresh. Which is the
    // worst possible moment for a status page to quietly stop updating.
    const [tick, setTick] = useState(0);
    const mounted = useRef(true);
    const timer = useRef(null);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);

    const load = useCallback(async ({ quiet = false } = {}) => {
        if (!quiet) setLoading(true);
        try {
            const data = await getReleaseStatus();
            if (!mounted.current) return null;
            setStatus(data);
            setError(null);
            return data;
        } catch (err) {
            if (!mounted.current) return null;
            // A failed poll must not erase a good reading: the previous state is
            // still the last thing the server actually said.
            setError(describeReleaseError(err, 'The release status could not be loaded.'));
            return null;
        } finally {
            if (mounted.current) {
                if (!quiet) setLoading(false);
                setTick((previous) => previous + 1);
            }
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    // Poll only while something is actually happening.
    const phase = derivePhase(status);
    useEffect(() => {
        if (!IN_FLIGHT.has(phase)) return undefined;
        timer.current = setTimeout(() => { load({ quiet: true }); }, ACTIVE_POLL_MS);
        return () => { if (timer.current) clearTimeout(timer.current); };
        // `tick` is in the dependency list on purpose: every completed read —
        // including a failed one — schedules the next.
    }, [phase, tick, load]);

    return { status, phase, loading, error, reload: load };
}
