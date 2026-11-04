/**
 * What the dashboard's "Needs attention" shows: `getDashboardAttention`, the
 * server's counts for the company (`functions/dashboardAttention.js` says what
 * each one counts), read when the dashboard opens and never live.
 *
 * The answer is kept for two minutes for this sign-in and company, so going
 * back to the dashboard soon after does not count again: each count is a billed
 * aggregation. A failed read, or an answer without rows, is not kept, so Try
 * again reads anew. For admins and the team alike. E2E test mode never reads:
 * nothing needs attention there.
 */
import { useCallback, useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';

/** How long an answer is kept. */
export const ATTENTION_KEEP_MS = 2 * 60 * 1000;

const QUIET = Object.freeze({ rows: Object.freeze({}), windows: Object.freeze({}) });

let kept = null;

async function callAttention(companyId) {
    const { data } = await httpsCallable(functions, 'getDashboardAttention')({ companyId });
    if (!data || typeof data.rows !== 'object' || data.rows === null) {
        throw new Error('The answer carried no counts.');
    }
    return data;
}

/** The kept answer while it is fresh for this company and sign-in, else a new read. */
function readAttention(companyId) {
    const session = auth.currentUser;
    const now = Date.now();
    if (kept && kept.companyId === companyId && kept.session === session && now - kept.at < ATTENTION_KEEP_MS) {
        return kept.promise;
    }
    const entry = { companyId, session, at: now, promise: callAttention(companyId) };
    kept = entry;
    entry.promise.catch(() => {
        if (kept === entry) kept = null;
    });
    return entry.promise;
}

/** Forgets the kept answer, so the next dashboard reads again. */
export function forgetDashboardAttention() {
    kept = null;
}

/**
 * `{ isLoading, attention, failed, retry }`: `attention` is the callable's
 * answer once read (`{ rows, windows }`), else null; `failed` when it could not
 * be read; `retry` reads again.
 */
export function useDashboardAttention({ companyId }) {
    const [attempt, setAttempt] = useState(0);
    const [state, setState] = useState({ key: null, attention: null, failed: false });
    const key = companyId ? `${companyId}#${attempt}` : null;

    useEffect(() => {
        if (!key || isE2ETestMode) return undefined;
        let current = true;
        readAttention(companyId).then(
            (attention) => {
                if (current) setState({ key, attention, failed: false });
            },
            (error) => {
                // The code only: a message could carry server details.
                console.warn('[useDashboardAttention] Could not read what needs attention:', error?.code || 'error');
                if (current) setState({ key, attention: null, failed: true });
            },
        );
        return () => { current = false; };
    }, [companyId, key]);

    const retry = useCallback(() => setAttempt((count) => count + 1), []);

    if (!companyId) return { isLoading: false, attention: null, failed: false, retry };
    if (isE2ETestMode) return { isLoading: false, attention: QUIET, failed: false, retry };
    const settled = state.key === key;
    return {
        isLoading: !settled,
        attention: settled ? state.attention : null,
        failed: settled && state.failed,
        retry,
    };
}

export default useDashboardAttention;
