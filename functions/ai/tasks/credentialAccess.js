/**
 * Credential-access diagnosis.
 *
 * Answers one question that nothing in SafeHaul could previously answer, and
 * that no fixture can ever answer: **can this runtime actually read the AI
 * credentials, and if not, which identity is being refused?**
 *
 * ## Why this exists
 *
 * AI credentials are read at runtime with the Secret Manager client rather than
 * through `secrets: [...]` deploy bindings, for good reasons documented in
 * ../credentials/secretManager.js. The cost of that choice is that nothing
 * grants the runtime service account access automatically — a deploy binding
 * would have — so `roles/secretmanager.secretAccessor` is a manual step, and a
 * missing binding is invisible: the credential is present and correct, and every
 * provider that needs it is skipped.
 *
 * Two things made that worse than a missing checkbox.
 *
 * **1st and 2nd generation functions default to different service accounts.**
 * 1st gen runs as the App Engine default account
 * (`<project>@appspot.gserviceaccount.com`); 2nd gen runs as the Compute Engine
 * default account (`<project-number>-compute@developer.gserviceaccount.com`).
 * SafeHaul deploys both — `parseCdlWithGroq` is 1st gen while the E-Doc
 * assistant, the AI Integrations console and the blog scheduler are 2nd gen —
 * and sets no explicit `serviceAccount`. A grant made to one account therefore
 * fixes some AI entry points and not others, which reads from the outside as
 * "AI works sometimes". This diagnosis is exposed from **both** generations so
 * that difference is something an operator can see rather than deduce.
 *
 * **The console can create a secret it cannot read.** `saveAiCredential` creates
 * the secret and adds a version; neither act grants read access. An operator who
 * granted `secretAccessor` on the secrets that existed at the time gets a
 * silently unreadable credential the next time they add a provider.
 *
 * ## What it will not do
 *
 * It never returns, logs or infers a credential value — not the value, not its
 * length, not a prefix. Per field it reports only whether a secret exists,
 * whether this runtime could read it, and a gRPC-derived reason code when it
 * could not. Secret *ids* are included because they are derived names, are
 * already shown in Environment & Integrations, and are the thing an operator has
 * to type into a `gcloud` command.
 */

const { PROVIDERS, requireProvider, isRetired } = require('../registry/providers');
const { buildSecretId, readSecret, clearCache } = require('../credentials/secretManager');

/**
 * How long to wait for the metadata server.
 *
 * It is a link-local address that answers in single-digit milliseconds inside
 * Google infrastructure and does not exist anywhere else, so a short timeout
 * costs nothing in production and keeps a local or CI run from stalling.
 */
const METADATA_TIMEOUT_MS = 1500;
const METADATA_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';

/**
 * Reason codes for a failed read, derived from the gRPC status code only.
 *
 * A code, never the error message: a Secret Manager error names the resource it
 * refused, and `../credentials/secretManager.js` exists partly to keep resource
 * names out of places they can leak from. `permission_denied` is the one that
 * matters — it is what a missing `secretAccessor` binding looks like — and it is
 * worth distinguishing from a transient `unavailable`, because one needs an
 * administrator and the other needs a retry.
 */
function readFailureReason(error) {
    switch (error?.code) {
        case 7: return 'permission_denied';
        case 8: return 'resource_exhausted';
        case 14: return 'unavailable';
        case 16: return 'unauthenticated';
        default:
            // Fall back to the shape of the message rather than its content, so
            // a client library that reports codes differently still classifies.
            if (/PERMISSION_DENIED/i.test(error?.message || '')) return 'permission_denied';
            if (/UNAVAILABLE/i.test(error?.message || '')) return 'unavailable';
            return 'error';
    }
}

/**
 * The service account this runtime is actually running as.
 *
 * Read from the metadata server rather than assumed, because assuming is what
 * produced the problem: the runbook named the App Engine account and half the AI
 * entry points run as the Compute Engine one.
 *
 * @returns {Promise<{ serviceAccount: string|null, source: string }>}
 */
async function readRuntimeServiceAccount({ fetchImpl = fetch } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);
    try {
        const response = await fetchImpl(METADATA_URL, {
            headers: { 'Metadata-Flavor': 'Google' },
            signal: controller.signal,
        });
        if (!response.ok) {
            return { serviceAccount: null, source: 'metadata_unavailable' };
        }
        const email = (await response.text()).trim();
        // An email address is not a credential, but it is still worth refusing
        // anything that does not look like one rather than echoing a response
        // body back to a console.
        if (!/^[^\s@]{1,128}@[^\s@]{1,255}$/.test(email)) {
            return { serviceAccount: null, source: 'metadata_unexpected' };
        }
        return { serviceAccount: email, source: 'metadata' };
    } catch {
        // Local development and CI have no metadata server. Saying so is more
        // useful than reporting an error for a condition that is expected there.
        return { serviceAccount: null, source: 'metadata_unreachable' };
    } finally {
        clearTimeout(timer);
    }
}

/** One row per declared credential field. */
async function checkSecret(provider, field, options) {
    const secretId = buildSecretId(provider.id, field.name);
    // A diagnosis must not answer from the 60-second value cache: a stale
    // "absent" is exactly the answer that would send an operator in circles.
    clearCache(secretId);

    try {
        const value = await readSecret(provider.id, field.name, options);
        return {
            field: field.name,
            label: field.label,
            secretId,
            exists: Boolean(value),
            readable: true,
            reason: null,
        };
    } catch (error) {
        console.error(`[ai/credentialAccess] ${secretId} unreadable: ${readFailureReason(error)}`);
        return {
            field: field.name,
            label: field.label,
            secretId,
            // Unknown, not false. A read that was refused says nothing about
            // whether the secret is there, and guessing "absent" is the original
            // defect this whole diagnosis exists to correct.
            exists: null,
            readable: false,
            reason: readFailureReason(error),
        };
    }
}

/**
 * Diagnoses credential access for every registered provider.
 *
 * @param {object} [options]
 * @param {string} [options.generation] which Functions generation is asking —
 *   the whole point of running this from two entry points.
 * @returns {Promise<object>} a value-free report.
 */
async function diagnoseCredentialAccess(options = {}) {
    const { generation = 'unknown', fetchImpl, ...secretOptions } = options;
    const runtime = await readRuntimeServiceAccount(fetchImpl ? { fetchImpl } : {});

    const providers = [];
    for (const provider of PROVIDERS) {
        if (isRetired(provider)) {
            providers.push({
                providerId: provider.id,
                displayName: provider.displayName,
                retired: true,
                secrets: [],
                legacyBinding: false,
            });
            continue;
        }

        const secrets = [];
        for (const field of provider.secretFields) {
            secrets.push(await checkSecret(provider, field, secretOptions));
        }

        providers.push({
            providerId: provider.id,
            displayName: provider.displayName,
            retired: false,
            secrets,
            // Whether the pre-migration deploy binding is present on *this*
            // runtime. It is the reason Groq keeps working when a managed read
            // fails, and it is per-function — a binding is declared per
            // function — so it belongs in a per-runtime report.
            legacyBinding: provider.id === 'groq' && Boolean(process.env.GROQ_API_KEY),
        });
    }

    const unreadable = providers.flatMap((entry) => entry.secrets.filter((secret) => !secret.readable));
    const permissionDenied = unreadable.filter((secret) => secret.reason === 'permission_denied');

    return {
        generation,
        runtime,
        providers,
        unreadableCount: unreadable.length,
        permissionDeniedCount: permissionDenied.length,
        // The single sentence an operator needs, assembled server-side so both
        // entry points say the same thing.
        summary: buildSummary({ runtime, unreadable, permissionDenied }),
        checkedAt: new Date().toISOString(),
    };
}

function buildSummary({ runtime, unreadable, permissionDenied }) {
    if (unreadable.length === 0) {
        return 'Every configured AI credential is readable by this runtime.';
    }
    const identity = runtime.serviceAccount || 'the Functions runtime service account';
    if (permissionDenied.length > 0) {
        return `${permissionDenied.length} credential(s) refused for ${identity}.`
            + ' Grant roles/secretmanager.secretAccessor on the named secrets to that account.'
            + ' Note that 1st and 2nd generation functions default to different service accounts,'
            + ' so check this from both entry points.';
    }
    return `${unreadable.length} credential(s) could not be read by ${identity}.`
        + ' The reason codes name what Secret Manager returned.';
}

module.exports = {
    diagnoseCredentialAccess,
    METADATA_URL,
    METADATA_TIMEOUT_MS,
    __test: { readRuntimeServiceAccount, readFailureReason, checkSecret, buildSummary, requireProvider },
};
