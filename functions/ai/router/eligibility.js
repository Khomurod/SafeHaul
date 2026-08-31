/**
 * Whether a provider may be tried at all, and why not when it may not.
 *
 * The reasons are a closed vocabulary because they reach an operator's screen:
 * "skipped" with no reason is what made a silently empty vision lane look
 * healthy.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const { supportsAllCapabilities, resolveModel, isRetired } = require('../registry/providers');
const { CAPABILITIES, laneForCapability } = require('../registry/capabilities');
const store = require('../credentials/store');
/**
 * Why a provider was passed over. Surfaced in telemetry and in the console so
 * "nothing happened" is never the explanation an operator gets.
 */
const SKIP_REASONS = Object.freeze({
    RETIRED: 'retired',
    INCAPABLE: 'incapable',
    DISABLED: 'disabled',
    UNCONFIGURED: 'unconfigured',
    COOLDOWN: 'cooldown',
    NO_MODEL: 'no_model',
    /**
     * This provider's eligibility could not be determined at all — most often
     * Secret Manager answering something other than NOT_FOUND (PERMISSION_DENIED
     * when the runtime service account has lost `secretAccessor`, UNAVAILABLE,
     * or a project quota error), which `../credentials/secretManager.js`
     * deliberately re-throws rather than treating as "no credential".
     *
     * It is a *skip*, not a failure of the task. One vendor's IAM problem is
     * one vendor's problem; the other eight keys are unaffected. Before this
     * existed the exception escaped `runAiTask` uncaught, no telemetry was
     * written, and no further provider was tried — so a single missing IAM
     * binding read as a total, silent AI outage.
     */
    CREDENTIAL_ERROR: 'credential_error',
    /**
     * The request carries more images than this vendor accepts. Skipping is
     * strictly better than spending a request to be told so: Groq caps at five
     * images per request and answers a sixth with a 400.
     */
    TOO_MANY_IMAGES: 'too_many_images',
    /**
     * Provider configuration could not be read and this instance holds no
     * cached copy, so the router cannot tell which providers an operator
     * disabled. Every provider is skipped rather than risk routing a restricted
     * document to a vendor that was deliberately switched off.
     */
    CONFIG_UNAVAILABLE: 'config_unavailable',
});

/**
 * Decides whether a provider may serve this request.
 *
 * @returns {Promise<{ eligible: boolean, reason?: string, config?: object, credentials?: object, model?: string }>}
 */
async function evaluateProvider(provider, { capabilities, primaryCapability, configs, now, deps, imageCount = 0 }) {
    if (isRetired(provider)) return { eligible: false, reason: SKIP_REASONS.RETIRED };

    if (!supportsAllCapabilities(provider, capabilities)) {
        return { eligible: false, reason: SKIP_REASONS.INCAPABLE };
    }

    // A vendor image cap is a hard gate for the same reason `capabilities` is:
    // exceeding it is a guaranteed 400, so spending the request learns nothing.
    if (Number.isInteger(provider.maxImages) && imageCount > provider.maxImages) {
        return { eligible: false, reason: SKIP_REASONS.TOO_MANY_IMAGES };
    }

    const config = configs.get(provider.id) || { enabled: true };
    if (config.enabled === false) return { eligible: false, reason: SKIP_REASONS.DISABLED };

    // Lane-scoped, so a cooldown earned by rejected document images cannot
    // remove this provider from the text lane. A quota cooldown is still
    // provider-wide, because a spent vendor allowance is an account fact.
    const cooldown = store.cooldownState(config, now, laneForCapability(primaryCapability));
    if (cooldown.active) {
        return { eligible: false, reason: SKIP_REASONS.COOLDOWN, cooldown };
    }

    // Required non-secret settings (Cloudflare's account id, for instance) are
    // part of being configured, not an optional extra.
    const missingConfig = provider.configFields
        .filter((field) => field.required)
        .some((field) => !(typeof config[field.name] === 'string' && config[field.name].trim()));
    if (missingConfig) return { eligible: false, reason: SKIP_REASONS.UNCONFIGURED };

    const credentials = await store.resolveCredentials(provider.id, deps);
    // A credential that could not be *read* is an infrastructure fault, not an
    // absent credential, and the two need opposite operator actions. The store
    // now reports which it was, so this no longer depends on an exception
    // reaching `safeEvaluateProvider` to tell the difference — though that catch
    // remains, because a store implementation is still allowed to throw.
    if (Array.isArray(credentials.unreadable) && credentials.unreadable.length > 0) {
        return { eligible: false, reason: SKIP_REASONS.CREDENTIAL_ERROR };
    }
    if (!credentials.complete) return { eligible: false, reason: SKIP_REASONS.UNCONFIGURED };

    const model = resolveModel(provider, primaryCapability, config);
    if (!model) return { eligible: false, reason: SKIP_REASONS.NO_MODEL };

    return { eligible: true, config, credentials, model };
}

/**
 * `evaluateProvider` that cannot throw.
 *
 * Deciding whether a provider is eligible touches Secret Manager and Firestore,
 * and both can fail in ways that are emphatically *not* "this credential is
 * absent": `PERMISSION_DENIED` when the runtime service account is missing
 * `roles/secretmanager.secretAccessor`, `UNAVAILABLE`, a project quota error.
 * `../credentials/secretManager.js` re-throws those deliberately, so that a
 * real infrastructure fault is never silently misread as an unconfigured
 * provider.
 *
 * That is the right call there and the wrong outcome here. The exception used
 * to escape `runAiTask` entirely: no telemetry row, no categorised error, and —
 * worst — no attempt at any of the remaining providers. One provider's IAM
 * binding could switch off all nine, which is precisely what the fallback order
 * exists to prevent, and it is the same defect already fixed once for
 * `unauthorized` and `internal` in ./errors.js.
 *
 * So the fault is recorded against *this* provider as a skip and the walk goes
 * on. The reason is carried in telemetry so an operator sees "credential_error"
 * against the affected vendor rather than an unexplained outage.
 */
async function safeEvaluateProvider(provider, context) {
    try {
        return await evaluateProvider(provider, context);
    } catch (error) {
        // Category only. Secret Manager errors can name resources, and several
        // vendors echo the request back inside an error string.
        console.error(`[ai/router] Eligibility check failed for ${provider.id}: ${error?.message || 'unknown'}`);
        return { eligible: false, reason: SKIP_REASONS.CREDENTIAL_ERROR };
    }
}

/**
 * The capability that decides which model to use. Vision dominates because a
 * task needing an image must run on the vision model even though it also needs
 * structured JSON.
 */
function pickPrimaryCapability(capabilities) {
    const order = [
        CAPABILITIES.MULTI_IMAGE,
        CAPABILITIES.VISION,
        CAPABILITIES.ARTICLE_WRITING,
        CAPABILITIES.STRUCTURED_JSON,
        CAPABILITIES.SUMMARIZATION,
        CAPABILITIES.CLASSIFICATION,
        CAPABILITIES.TEXT,
    ];
    return order.find((candidate) => capabilities.includes(candidate)) || CAPABILITIES.TEXT;
}

module.exports = { SKIP_REASONS, evaluateProvider, safeEvaluateProvider, pickPrimaryCapability };
