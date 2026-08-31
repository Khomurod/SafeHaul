/**
 * Reading the provider order and the stored configs, and what to do when that
 * read fails.
 *
 * The last known configs are cached deliberately: a cold instance that cannot
 * read them refuses to route rather than treating an empty map as "everything
 * enabled", which would silently re-enable a provider an operator disabled.
 *
 * Part of the shared AI router. `router.js` keeps the task loop and the
 * public surface; these modules are the pieces it decides with.
 */

const { PROVIDERS } = require('../registry/providers');
const { orderProviders, readProviderOrder } = require('./order');
const store = require('../credentials/store');
/**
 * The order the router will actually walk: the operator's stored order applied
 * to the registry rows, or the registry order when there is no usable override.
 *
 * `deps.providerOrder` is the injection seam that lets ordering be asserted
 * without a Firestore double, the same way `deps.providers` does for the
 * registry itself.
 */
async function resolveProviderOrder(deps) {
    const registryProviders = deps.providers || PROVIDERS;
    try {
        const stored = deps.providerOrder !== undefined
            ? deps.providerOrder
            : await readProviderOrder();
        return orderProviders(registryProviders, stored);
    } catch (error) {
        // `readProviderOrder` already promises never to throw; this is the
        // belt to its braces. An unreadable *preference* must never be able to
        // stop AI working — the registry order is always a valid answer.
        console.warn(`[ai/router] Could not resolve provider order; using the registry default. ${error?.message || ''}`);
        return orderProviders(registryProviders, []);
    }
}

/**
 * The last config map this instance read successfully.
 *
 * Cloud Functions instances are ephemeral but not short-lived, so a warm
 * instance has almost always read config at least once before Firestore has a
 * bad minute. Keeping the last good copy is what lets a read failure degrade
 * without discarding what the operator actually decided.
 */
let lastKnownConfigs = null;


/**
 * Stored non-secret config, degrading without ever *re-enabling* a provider.
 *
 * The first version of this returned an empty map on failure, reasoning that
 * enabled/disabled is a preference not worth an outage. That was wrong in one
 * specific and important way: absent config reads as `{ enabled: true }`, so an
 * empty map silently **re-enables every provider an operator had disabled**.
 * `setAiProviderEnabled` promises the opposite — "the router skips it
 * immediately" — and a provider is sometimes disabled precisely because it is
 * mishandling data, on paths that carry `restricted` CDL and document images.
 * A transient Firestore error must not undo a deliberate safety decision.
 *
 * So: fall back to the last configuration this instance actually read, and if
 * it has never read one, fail closed. Failing closed is not a regression — the
 * previous behaviour was to throw, which took the request down anyway; the
 * difference is that the caller now gets a categorised error and a telemetry
 * row instead of an uncaught exception.
 */
async function resolveConfigs() {
    try {
        const configs = await store.readAllConfigs();
        lastKnownConfigs = configs;
        return configs;
    } catch (error) {
        if (lastKnownConfigs) {
            console.warn(`[ai/router] Provider config unreadable; using the last known configuration. ${error?.message || ''}`);
            return lastKnownConfigs;
        }
        // Nothing to fall back to. Refusing is the safe direction: it cannot
        // route a restricted document to a vendor an operator switched off.
        console.error(`[ai/router] Provider config unreadable and no cached copy; refusing to route. ${error?.message || ''}`);
        return null;
    }
}

module.exports = { resolveProviderOrder, resolveConfigs };
