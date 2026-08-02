import { httpsCallable } from 'firebase/functions';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { auth, functions } from '@lib/firebase';

/**
 * Client for the Environment & Integrations vault callables.
 *
 * Every function here sends exactly one entry identifier and receives at most
 * one value. Nothing is cached, memoised or written to storage: a revealed value
 * lives in React state for at most 30 seconds and nowhere else.
 */

/** The typed failure the backend raises when the session is too old. */
const REAUTH_SENTINEL = 'REAUTH_REQUIRED';

/**
 * Thrown when the operator dismisses the re-authentication prompt.
 *
 * This is not a failure to report — it means the operation never started, so
 * callers must neither claim success nor show an error. It exists as its own
 * type precisely so "the user backed out" cannot be confused with "the server
 * refused", which is how a cancelled mutation would otherwise be announced as a
 * completed one.
 */
export class ReauthCancelledError extends Error {
    constructor() {
        super('Re-authentication was cancelled.');
        this.name = 'ReauthCancelledError';
    }
}

/** True when an operation stopped because the operator dismissed the prompt. */
export function isReauthCancelled(error) {
    return error instanceof ReauthCancelledError || error?.name === 'ReauthCancelledError';
}

/**
 * True when a callable failure means "re-enter your password", rather than a
 * genuine denial. Matched on the sentinel rather than the whole message so
 * wording can change without breaking the flow.
 */
export function isReauthRequired(error) {
    return error?.code === 'functions/failed-precondition'
        && typeof error?.message === 'string'
        && error.message.includes(REAUTH_SENTINEL);
}

/**
 * User-facing text for a callable failure.
 *
 * Backend messages are already value-free, but they are not all written for an
 * operator, so the common codes are mapped to stable sentences and only
 * deliberate `failed-precondition` explanations (which carry the registry's own
 * restriction wording) are passed through.
 */
export function describeVaultError(error, fallback = 'That operation could not be completed.') {
    if (!error) return fallback;
    switch (error.code) {
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/permission-denied':
            return 'Super Admin access is required for this action.';
        case 'functions/resource-exhausted':
            return 'Too many requests. Wait a moment and try again.';
        case 'functions/not-found':
            return 'That configuration entry no longer exists. Refresh the inventory.';
        case 'functions/already-exists':
            return 'That key already has a stored value.';
        case 'functions/invalid-argument':
        case 'functions/failed-precondition':
            return error.message?.replace(/^.*?:\s*/, '') || fallback;
        default:
            return fallback;
    }
}

export async function listEnvironmentAndIntegrations(payload = {}) {
    const call = httpsCallable(functions, 'listEnvironmentAndIntegrations');
    const result = await call(payload);
    return result.data;
}

export async function revealEnvironmentValue(entryId) {
    const call = httpsCallable(functions, 'revealEnvironmentValue');
    const result = await call({ entryId });
    return result.data;
}

export async function updateEnvironmentValue(entryId, value) {
    const call = httpsCallable(functions, 'updateEnvironmentValue');
    const result = await call({ entryId, value });
    return result.data;
}

export async function addEnvironmentValue(entryId, value) {
    const call = httpsCallable(functions, 'addEnvironmentValue');
    const result = await call({ entryId, value });
    return result.data;
}

export async function deleteEnvironmentValue(entryId, confirmation) {
    const call = httpsCallable(functions, 'deleteEnvironmentValue');
    const result = await call({ entryId, confirmation });
    return result.data;
}

export async function testManagedIntegration(entryId) {
    const call = httpsCallable(functions, 'testManagedIntegration');
    const result = await call({ entryId });
    return result.data;
}

/**
 * Re-authenticates the signed-in operator with their password.
 *
 * `reauthenticateWithCredential` is what moves the token's `auth_time`, which is
 * the claim the backend checks. Refreshing the ID token alone does not, which is
 * precisely why the recency requirement cannot be bypassed by the client.
 */
export async function reauthenticateWithPassword(password) {
    const user = auth.currentUser;
    if (!user?.email) {
        throw new Error('No signed-in account to re-authenticate.');
    }
    const credential = EmailAuthProvider.credential(user.email, password);
    await reauthenticateWithCredential(user, credential);
    // Force a fresh ID token so the next callable carries the new auth_time.
    await user.getIdToken(true);
}
