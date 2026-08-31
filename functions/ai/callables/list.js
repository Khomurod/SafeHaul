/**
 * Listing the providers: the row an operator sees, and the routing summary
 * beside it.
 *
 * Part of the AI Integrations callable surface. `onCall`, `HttpsError` and the
 * shared options and guards come from `./options` — see the note there about
 * why the `firebase-functions/v2` import lives beside the `secrets:` literal.
 */

const { MASK, callableOptions, onCall, safeFailure } = require('./options');

const { assertSuperAdmin, assertWithinRateLimit } = require('../../environmentVault/guards');
const { ACTIONS, RESULTS, recordAuditEvent } = require('../../environmentVault/audit');
const { PROVIDERS, resolveModel } = require('../registry/providers');
const { CAPABILITIES, CAPABILITY_LABELS } = require('../registry/capabilities');
const { describeRouting } = require('../router/router');
const routingOrder = require('../router/order');
const store = require('../credentials/store');
const { readRecentTelemetry } = require('../telemetry/record');
// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/**
 * Builds one console row per provider.
 *
 * No secret value appears anywhere in this response — not masked-with-real-
 * length, not a prefix, not a hash. `configured` is a boolean derived
 * server-side.
 */
async function buildProviderRow(provider, configs, rank) {
    const config = configs.get(provider.id) || { enabled: true };
    // `readCredentials` no longer throws: it reports absent and unreadable
    // fields separately. That distinction is the whole point of this block.
    //
    // This used to be `.catch(() => ({ complete: false, missing: everything }))`,
    // which turned a `PERMISSION_DENIED` from Secret Manager into the row
    // reading **"Not configured — Needs API key."** The credential existed; the
    // runtime service account simply could not read it. So the console sent
    // operators to re-enter keys that were already there, while the routing
    // panel *on the same page* correctly reported `credential_error` — the page
    // contradicted itself, and the wrong half was the headline.
    //
    // The outer catch stays as a backstop for an unexpected throw, but it now
    // records the honest reason rather than inventing an absence.
    const credentials = await store.readCredentials(provider.id).catch(() => ({
        complete: false,
        values: {},
        missing: [],
        unreadable: provider.secretFields.map((f) => f.name),
    }));
    const unreadable = Array.isArray(credentials.unreadable) ? credentials.unreadable : [];

    // Groq may still be served by the pre-migration deploy binding — including
    // when the managed read *failed*, which is exactly when the rollback path
    // earns its keep. `resolveCredentials` makes the same allowance.
    let credentialSource = credentials.complete ? 'secret-manager' : null;
    let configured = credentials.complete;
    if (!configured && provider.id === 'groq' && process.env.GROQ_API_KEY) {
        configured = true;
        credentialSource = unreadable.includes('apiKey')
            ? 'legacy-env-after-read-failure'
            : 'legacy-env';
    }

    const cooldown = store.cooldownState(config);
    const missingConfig = provider.configFields
        .filter((field) => field.required)
        .filter((field) => !(typeof config[field.name] === 'string' && config[field.name].trim()))
        .map((field) => field.name);

    return {
        id: provider.id,
        displayName: provider.displayName,
        // `priority` is the registry default; `rank` is where this deployment
        // actually tries the provider. They differ as soon as an operator
        // reorders, and the screen shows `rank` because that is the one that
        // describes what will happen to the next request.
        priority: provider.priority,
        rank: typeof rank === 'number' ? rank : provider.priority,
        docsUrl: provider.docsUrl,
        retired: provider.retired || null,
        capabilities: provider.capabilities.map((capability) => ({
            id: capability,
            label: CAPABILITY_LABELS[capability],
        })),
        credentialFields: provider.secretFields.map((field) => ({
            name: field.name,
            label: field.label,
            description: field.description,
            required: field.required,
            configured: Boolean(credentials.values[field.name])
                || (provider.id === 'groq' && field.name === 'apiKey' && credentialSource === 'legacy-env'),
            // Always the same fixed mask. Never a real value or its length.
            maskedValue: MASK,
        })),
        configFields: provider.configFields.map((field) => ({
            name: field.name,
            label: field.label,
            description: field.description,
            required: Boolean(field.required),
            placeholder: field.placeholder || '',
            // Non-secret settings are safe to show in full: an account id or a
            // model slug is configuration, not a credential.
            value: typeof config[field.name] === 'string' ? config[field.name] : '',
        })),
        defaultModels: provider.defaultModels,
        resolvedModels: Object.fromEntries(
            provider.capabilities.map((capability) => [capability, resolveModel(provider, capability, config)]),
        ),
        configured: configured && missingConfig.length === 0,
        missingCredentials: credentials.missing,
        // Named separately from `missingCredentials` so the console can say
        // "the credential is there and this runtime cannot read it" — the one
        // sentence that points an operator at IAM instead of at a key field.
        unreadableCredentials: unreadable,
        credentialAccess: unreadable.length > 0 ? 'unreadable' : 'ok',
        missingConfig,
        credentialSource,
        enabled: config.enabled !== false && !provider.retired,
        health: provider.retired
            ? 'retired'
            : (unreadable.length > 0 && !configured
                ? 'credential_error'
                : (config.health || (configured ? 'unknown' : 'unconfigured'))),
        // Per lane, because a provider's text and image lanes fail independently
        // and one scalar could describe neither. This is what lets the row say
        // "articles fine, document images broken" instead of a single badge that
        // the next successful article would quietly turn green again.
        laneHealth: {
            text: config.laneHealth?.text || 'unknown',
            vision: config.laneHealth?.vision || 'unknown',
        },
        laneFailures: {
            text: Number(config.laneFailures?.text || 0),
            vision: Number(config.laneFailures?.vision || 0),
        },
        consecutiveFailures: Number(config.consecutiveFailures || 0),
        cooldown: cooldown.active
            ? { active: true, until: cooldown.until, reason: cooldown.reason }
            : { active: false, until: null, reason: null },
        lastTest: config.lastTestAt
            ? {
                at: config.lastTestAt?.toDate?.()?.toISOString?.() || null,
                success: Boolean(config.lastTestSuccess),
                category: config.lastTestCategory || null,
                // The stored per-capability breakdown, so the row still says
                // *which* capability failed after a reload. Without it the
                // console could only show one verdict, which is the state that
                // let "text works, every image request is rejected" read as a
                // single anonymous failure.
                capabilities: Array.isArray(config.lastTestCapabilities)
                    ? config.lastTestCapabilities
                    : [],
            }
            : null,
        lastSuccessAt: config.lastSuccessAt?.toDate?.()?.toISOString?.() || null,
    };
}

/**
 * The two capability sets worth showing an operator, because they route
 * differently and the difference is the thing people get wrong.
 *
 * Every SafeHaul AI task is one of these two shapes. Text tasks can reach all
 * nine providers; document-image tasks can only reach the four that declare
 * vision, whatever order they are put in. Showing both lanes is what makes
 * "I promoted Cerebras to first and CDL parsing did not change" explainable on
 * the screen instead of in a support conversation.
 */
const ROUTING_LANES = Object.freeze([
    Object.freeze({
        id: 'text',
        label: 'Text and structured output',
        description: 'Article generation, topic selection, summarisation and classification.',
        capabilities: Object.freeze([CAPABILITIES.TEXT, CAPABILITIES.STRUCTURED_JSON]),
    }),
    Object.freeze({
        id: 'vision',
        label: 'Document images',
        description: 'CDL auto-fill and e-document field placement.',
        capabilities: Object.freeze([CAPABILITIES.VISION, CAPABILITIES.STRUCTURED_JSON]),
    }),
]);

/**
 * The effective routing order plus, per lane, which providers are eligible and
 * why the rest are not.
 *
 * `describeRouting` is the router's own function, given the configs already
 * read here so the collection is not re-read once per lane. Nothing in this
 * file re-implements an eligibility rule.
 */
async function buildRoutingSummary(configs, storedOrder) {
    const order = routingOrder.orderProviders(PROVIDERS, storedOrder).map((provider) => provider.id);
    const lanes = [];

    for (const lane of ROUTING_LANES) {
        lanes.push({
            id: lane.id,
            label: lane.label,
            description: lane.description,
            providers: await describeRouting(lane.capabilities, { configs, providerOrder: storedOrder }),
        });
    }

    return {
        order,
        // True when the deployment is running exactly what it ships with, which
        // is worth stating plainly rather than leaving an operator to compare
        // two lists by eye.
        usingDefaultOrder: storedOrder.length === 0,
        lanes,
    };
}

exports.listAiProviders = onCall(callableOptions, async (request) => {
    await assertSuperAdmin(request, ACTIONS.LIST);
    await assertWithinRateLimit(request, 'list', ACTIONS.LIST);

    try {
        const configs = await store.readAllConfigs();
        // Reads as `[]` when the document is absent or unreadable, which is
        // what makes the console show the registry order rather than an error.
        const storedOrder = await routingOrder.readProviderOrder();
        const ordered = routingOrder.orderProviders(PROVIDERS, storedOrder);

        const providers = [];
        for (let index = 0; index < ordered.length; index += 1) {
            providers.push(await buildProviderRow(ordered[index], configs, index + 1));
        }

        await recordAuditEvent({
            auth: request.auth,
            action: ACTIONS.LIST,
            result: RESULTS.SUCCESS,
            metadata: { integration: 'AI providers', entryCount: providers.length },
        });

        return {
            providers,
            routing: await buildRoutingSummary(configs, storedOrder),
            telemetry: await readRecentTelemetry(25),
            generatedAt: new Date().toISOString(),
        };
    } catch (error) {
        return safeFailure(error, 'listAiProviders');
    }
});

// Exported for `callables.js`'s `__test` surface, which is what the row-shape
// assertions in the credential suites reach for.
exports.buildProviderRow = buildProviderRow;
