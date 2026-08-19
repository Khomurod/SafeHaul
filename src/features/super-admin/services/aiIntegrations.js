import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';

/**
 * Client for the Super Admin AI Integrations callables.
 *
 * Mirrors `./environmentVault.js` deliberately: the two consoles share the same
 * backend guards, the same recent-authentication contract and the same audit
 * trail, so they share the same client shape too. Re-authentication detection
 * and the cancellation type are imported from there rather than reimplemented,
 * because two divergent copies of that logic is how one of them ends up
 * reporting a cancelled mutation as a completed one.
 *
 * A revealed credential is returned to the caller and nowhere else. Nothing in
 * this module caches, memoises or persists a value.
 */

export {
    ReauthCancelledError,
    isReauthCancelled,
    isReauthRequired,
    reauthenticateWithPassword,
} from './environmentVault';

/**
 * User-facing text for a callable failure.
 *
 * Backend messages are already credential-free and already category-only for
 * provider failures, so `failed-precondition` and `invalid-argument` are passed
 * through: those carry the registry's own explanation, such as which
 * non-secret setting is missing or that a provider has been retired.
 */
export function describeAiError(error, fallback = 'That operation could not be completed.') {
    if (!error) return fallback;
    switch (error.code) {
        case 'functions/unauthenticated':
            return 'Your session has ended. Sign in again to continue.';
        case 'functions/permission-denied':
            return 'Super Admin access is required for this action.';
        case 'functions/resource-exhausted':
            return 'Too many requests. Wait a moment and try again.';
        case 'functions/not-found':
            return 'That provider or credential field is not recognised.';
        case 'functions/invalid-argument':
        case 'functions/failed-precondition':
            return error.message?.replace(/^.*?:\s*/, '') || fallback;
        default:
            return fallback;
    }
}

export async function listAiProviders() {
    const call = httpsCallable(functions, 'listAiProviders');
    const result = await call({});
    return result.data;
}

/**
 * AI transactions for the Logs tab.
 *
 * `ai_telemetry` is server-only in the security rules, so there is no
 * `onSnapshot` alternative here — this callable is the only way to read it.
 *
 * The response carries `truncated` alongside the entries: provider and
 * free-text filtering happen server-side but *in memory*, over the page
 * Firestore returned, so matches can exist beyond that window. The UI says so
 * rather than presenting a partial list as a complete one.
 *
 * @param {object} [filters] `{ taskType, outcome, providerId, search, from, to, limit }`
 */
export async function listAiTelemetry(filters = {}) {
    const call = httpsCallable(functions, 'listAiTelemetry');
    const result = await call(filters);
    return result.data;
}

/** Reveals exactly one credential field of one provider. */
export async function revealAiCredential(providerId, field) {
    const call = httpsCallable(functions, 'revealAiCredential');
    const result = await call({ providerId, field });
    return result.data;
}

export async function saveAiCredential(providerId, field, value) {
    const call = httpsCallable(functions, 'saveAiCredential');
    const result = await call({ providerId, field, value });
    return result.data;
}

/** `confirmation` must be the provider's display name; the server re-checks it. */
export async function deleteAiCredential(providerId, field, confirmation) {
    const call = httpsCallable(functions, 'deleteAiCredential');
    const result = await call({ providerId, field, confirmation });
    return result.data;
}

export async function setAiProviderEnabled(providerId, enabled) {
    const call = httpsCallable(functions, 'setAiProviderEnabled');
    const result = await call({ providerId, enabled });
    return result.data;
}

/**
 * Replaces the global order the router tries providers in.
 *
 * The server validates every id against the frozen registry and rejects the
 * whole list if one is unknown or repeated, so a partial write cannot silently
 * shrink the order. It returns the *effective* order — providers the list did
 * not name are appended in registry order — which is what the screen should
 * then show.
 */
export async function setAiProviderPriority(providerIds) {
    const call = httpsCallable(functions, 'setAiProviderPriority');
    const result = await call({ providerIds });
    return result.data;
}

export async function updateAiProviderConfig(providerId, settings) {
    const call = httpsCallable(functions, 'updateAiProviderConfig');
    const result = await call({ providerId, settings });
    return result.data;
}

export async function testAiProvider(providerId) {
    const call = httpsCallable(functions, 'testAiProvider');
    const result = await call({ providerId });
    return result.data;
}

/**
 * Reconciles every registry model pin against the vendors' live catalogues.
 *
 * Makes model drift checkable on demand instead of on incident. A pin is only a
 * string until a request is made with it, so nothing in CI can notice a vendor
 * retiring a model — this asks the vendor, server-side, with the credential
 * already configured. No credential is returned.
 */
export async function diagnoseAiModelPins() {
    const call = httpsCallable(functions, 'diagnoseAiModelPins');
    const result = await call({});
    return result.data;
}

/**
 * Asks both Functions generations whether they can read the AI credentials.
 *
 * Both, not one, and that is the whole point: 1st generation functions default
 * to the App Engine service account and 2nd generation ones to the Compute
 * Engine account, so a Secret Manager grant can fix some AI entry points and
 * leave others refused. CDL auto-fill is 1st generation; the E-Doc assistant,
 * this console and the blog scheduler are 2nd. A single answer cannot show that.
 *
 * The two run concurrently and are reported independently, so one generation
 * failing still yields the other's answer — a diagnosis that needs both halves
 * to succeed would be useless in exactly the situation it is for.
 */
export async function diagnoseAiCredentialAccess() {
    const [gen2, gen1] = await Promise.allSettled([
        httpsCallable(functions, 'diagnoseAiCredentialAccess')({}),
        httpsCallable(functions, 'diagnoseAiCredentialAccessV1')({}),
    ]);

    const unwrap = (settled, generation) => (
        settled.status === 'fulfilled'
            ? { generation, ok: true, report: settled.value.data }
            : { generation, ok: false, error: describeAiError(settled.reason, 'This check could not be run.') }
    );

    return {
        generations: [unwrap(gen2, 'v2'), unwrap(gen1, 'v1')],
    };
}

/**
 * Copies the legacy Groq deploy binding into the managed credential store.
 * The token is moved server-side; it is never returned here.
 */
export async function migrateGroqCredential() {
    const call = httpsCallable(functions, 'migrateGroqCredential');
    const result = await call({});
    return result.data;
}

// --- Research & Media -----------------------------------------------------

export async function listMediaProviders() {
    const call = httpsCallable(functions, 'listMediaProviders');
    const result = await call({});
    return result.data;
}

export async function saveMediaCredential(providerId, field, value) {
    const call = httpsCallable(functions, 'saveMediaCredential');
    const result = await call({ providerId, field, value });
    return result.data;
}

export async function deleteMediaCredential(providerId, field) {
    const call = httpsCallable(functions, 'deleteMediaCredential');
    const result = await call({ providerId, field });
    return result.data;
}
