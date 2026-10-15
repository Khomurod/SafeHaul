import React, { useCallback, useState } from 'react';
import { ReauthenticateModal } from '../components/environment/ReauthenticateModal';
import { isReauthRequired, ReauthCancelledError } from '../services/environmentVault';

/**
 * The owner panel's guard for actions the server allows only after a recent
 * sign-in (the vault, AI keys, blog, alerts and releases).
 *
 * `runGuarded(operation)` runs the operation; when the server answers that the
 * sign-in is too old, it asks for the password and runs it once more. A second
 * stale-session refusal is a real failure and is reported as one rather than
 * looping the prompt. The promise settles only when the operation itself has
 * run, and rejects with `ReauthCancelledError` when the operator backs out, so a
 * cancelled prompt is never reported as a finished action.
 *
 * The screen renders `reauthPrompt` once; it is null while nothing is waiting.
 */
export function useReauthGuard() {
    const [pending, setPending] = useState(null);

    const requestReauth = useCallback(() => new Promise((resolve, reject) => {
        setPending({ resolve, reject });
    }), []);

    const runGuarded = useCallback(async (operation) => {
        try {
            return await operation();
        } catch (error) {
            if (!isReauthRequired(error)) throw error;
            await requestReauth();
            return operation();
        }
    }, [requestReauth]);

    const reauthPrompt = pending ? (
        <ReauthenticateModal
            onSuccess={() => {
                setPending(null);
                pending.resolve();
            }}
            onCancel={() => {
                setPending(null);
                pending.reject(new ReauthCancelledError());
            }}
        />
    ) : null;

    return { runGuarded, reauthPrompt };
}
