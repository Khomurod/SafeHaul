/**
 * Provider connection test.
 *
 * Runs a synthetic probe per capability the provider declares — text,
 * structured JSON, single-image vision, multi-image vision, and the
 * article-generation and verification shapes — so a pass means "this provider
 * can do the things SafeHaul will actually ask of it", not "this provider
 * returned some text".
 *
 * That distinction is the whole reason this file changed. The old test sent one
 * constant prompt with no schema and no image, and reported healthy on any
 * reply. `../registry/providers.js` records what that cost: Groq's check passed
 * on plain text while every schema-using task in production failed, because the
 * pinned models rejected `json_schema`. A vision model can likewise be retired
 * by its vendor and go unnoticed for months.
 *
 * No probe carries company, driver or applicant data — every prompt is a
 * constant and every image is generated from flat colour. See ./healthProbes.js
 * for what the probes do and do not prove.
 *
 * The router is bypassed on purpose. The router's job is to find a provider
 * that works; a connection test must interrogate exactly the provider the
 * operator clicked, including one that is disabled or in cooldown, because "why
 * is this one failing" is the question being asked.
 */

const { requireProvider, resolveModel, isRetired } = require('../registry/providers');
const { CAPABILITIES } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError } = require('../router/errors');
const { extractJsonObject, validateAgainstSchema } = require('../validation/schema');
const { probesFor, PROBE_TIMEOUT_MS } = require('./healthProbes');
const store = require('../credentials/store');

/** Kept exported: the text probe's prompt, unchanged from the original test. */
const HEALTH_PROMPT = 'Reply with the single word: ready';
const HEALTH_TIMEOUT_MS = PROBE_TIMEOUT_MS;

/**
 * Ceiling on the whole test, across every probe.
 *
 * Probes run serially, and a stalled provider can spend the full
 * `PROBE_TIMEOUT_MS` on each. Six probes at 20s is 120s, which does not fit a
 * callable's default 60s — the same shape of bug as the CDL task inheriting a
 * 120s router deadline inside a 60s function, and it bites hardest exactly when
 * an operator is diagnosing a provider that has gone quiet.
 *
 * `testAiProvider` is deployed with `timeoutSeconds: 180`; this keeps the work
 * comfortably inside it so the result is recorded and returned rather than the
 * function being killed mid-test. Probes not reached are reported as such —
 * saying "not run" is honest, and calling them passed or failed would not be.
 */
const HEALTH_TOTAL_BUDGET_MS = 150000;

const PROBE_STATUS = Object.freeze({
    PASSED: 'passed',
    FAILED: 'failed',
    /** The provider does not offer this capability. Not a failure. */
    SKIPPED: 'skipped',
    /** The overall budget ran out before this probe started. */
    NOT_RUN: 'not_run',
});

/** A failure shape shared by every early return, so callers see one contract. */
function unavailable(category, message) {
    return { success: false, category, message, latencyMs: 0, capabilities: [] };
}

/**
 * Runs one probe against one provider.
 *
 * Structured probes are validated with SafeHaul's own validator rather than
 * trusting the vendor's JSON mode — the same rule the router applies, and for
 * the same reason: a vendor promising JSON is not evidence that it sent JSON,
 * still less that it matched the schema.
 */
async function runProbe(probe, { provider, config, credentials, deps }) {
    const capability = probe.capabilities[0];
    // Resolve against the capability that decides the model, so a vision probe
    // tests the vision model rather than the text one.
    const modelCapability = probe.images ? CAPABILITIES.VISION : capability;
    const model = resolveModel(provider, modelCapability, config);
    if (!model) {
        return {
            id: probe.id,
            label: probe.label,
            status: PROBE_STATUS.FAILED,
            category: 'model_unavailable',
            message: 'No model is configured for this capability.',
            latencyMs: 0,
        };
    }

    const startedAt = Date.now();
    try {
        const raw = await getAdapter(provider).execute({
            provider,
            capability: modelCapability,
            model,
            systemInstructions: probe.systemInstructions || '',
            inputText: probe.inputText,
            images: probe.images || null,
            schema: probe.schema,
            schemaName: `safehaul_health_${probe.id}`,
            temperature: 0,
            maxOutputTokens: probe.maxOutputTokens,
            timeoutMs: PROBE_TIMEOUT_MS,
            parentSignal: undefined,
            credentials: credentials.values,
            config,
            fetchImpl: deps.fetchImpl,
        });
        const latencyMs = Date.now() - startedAt;

        if (!probe.schema) {
            const ok = probe.validate(raw?.text);
            return {
                id: probe.id,
                label: probe.label,
                model,
                latencyMs,
                status: ok ? PROBE_STATUS.PASSED : PROBE_STATUS.FAILED,
                category: ok ? null : 'malformed_response',
                message: ok ? 'Passed.' : 'The provider connected but returned nothing usable.',
            };
        }

        const parsed = extractJsonObject(raw?.text);
        if (!parsed) {
            return {
                id: probe.id,
                label: probe.label,
                model,
                latencyMs,
                status: PROBE_STATUS.FAILED,
                category: 'malformed_response',
                message: 'The provider did not return parseable JSON.',
            };
        }

        const { valid, errors } = validateAgainstSchema(parsed, probe.schema);
        if (!valid) {
            return {
                id: probe.id,
                label: probe.label,
                model,
                latencyMs,
                status: PROBE_STATUS.FAILED,
                category: 'schema_validation_failed',
                // Names a path, never a value — same rule as the router.
                message: errors[0] || 'Schema validation failed.',
            };
        }

        // The answer parsed and matched the schema; did it show the provider
        // actually did the work? A vision model that ignores the image can
        // still return a schema-valid object.
        const ok = probe.validate(parsed);
        return {
            id: probe.id,
            label: probe.label,
            model,
            latencyMs,
            status: ok ? PROBE_STATUS.PASSED : PROBE_STATUS.FAILED,
            category: ok ? null : 'malformed_response',
            message: ok
                ? 'Passed.'
                : 'The provider answered in the right shape but did not read the request correctly.',
        };
    } catch (error) {
        const aiError = error instanceof AiError
            ? error
            : new AiError('internal', error?.message || 'Probe failed.', { providerId: provider.id });
        return {
            id: probe.id,
            label: probe.label,
            model,
            latencyMs: Date.now() - startedAt,
            status: PROBE_STATUS.FAILED,
            category: aiError.category,
            // Safe category text only, never the vendor's own error body.
            message: aiError.safeMessage,
        };
    }
}

/**
 * @param {string} providerId
 * @param {object} [deps]
 * @returns {Promise<{
 *   success: boolean, category?: string, message: string, model?: string,
 *   latencyMs: number, capabilities: Array<object>
 * }>}
 *   The first five fields are unchanged from the original contract, so the
 *   existing console keeps working; `capabilities` is additive.
 */
async function testProviderConnection(providerId, deps = {}) {
    const provider = requireProvider(providerId);
    const startedAt = Date.now();

    if (isRetired(provider)) {
        return unavailable('provider_unavailable', provider.retired.reason);
    }

    const config = await store.readConfig(provider.id);
    const missingConfig = provider.configFields
        .filter((field) => field.required)
        .filter((field) => !(typeof config[field.name] === 'string' && config[field.name].trim()));
    if (missingConfig.length > 0) {
        return unavailable(
            'not_configured',
            `${missingConfig.map((field) => field.label).join(', ')} is required before testing.`,
        );
    }

    const credentials = await store.resolveCredentials(provider.id, deps);
    if (!credentials.complete) {
        return unavailable('not_configured', 'Add credentials before testing this provider.');
    }

    const capabilities = [];
    for (const { probe, applicable } of probesFor(provider)) {
        if (Date.now() - startedAt > HEALTH_TOTAL_BUDGET_MS) {
            // Out of budget. Reported as its own state rather than folded into
            // pass or fail, because "we ran out of time" is a different fact.
            capabilities.push({
                id: probe.id,
                label: probe.label,
                status: PROBE_STATUS.NOT_RUN,
                message: 'Not run — the test ran out of time.',
            });
            continue;
        }
        if (!applicable) {
            // Not a failure. A text-only provider does not offer vision; saying
            // "failed" would make the console read as though something broke.
            capabilities.push({
                id: probe.id,
                label: probe.label,
                status: PROBE_STATUS.SKIPPED,
                message: 'Not offered by this provider.',
            });
            continue;
        }
        capabilities.push(await runProbe(probe, { provider, config, credentials, deps }));
    }

    const run = capabilities.filter((entry) => (
        entry.status === PROBE_STATUS.PASSED || entry.status === PROBE_STATUS.FAILED
    ));
    const notRun = capabilities.filter((entry) => entry.status === PROBE_STATUS.NOT_RUN);
    const failed = run.filter((entry) => entry.status === PROBE_STATUS.FAILED);
    const latencyMs = Date.now() - startedAt;
    const model = run.find((entry) => entry.model)?.model;

    // A provider is healthy only if every capability it *claims* works. Passing
    // the text probe while failing structured JSON is precisely the state that
    // used to be reported as healthy, and precisely the state that broke CDL
    // extraction, E-Doc analysis and article publishing simultaneously.
    // A test that did not finish is not a pass. Claiming one would recreate the
    // problem this whole file exists to fix.
    const success = run.length > 0 && failed.length === 0 && notRun.length === 0;
    const result = {
        success,
        category: failed[0]?.category || (run.length === 0 ? 'capability_unavailable' : null),
        message: success
            ? `Connected. ${run.length} capabilit${run.length === 1 ? 'y' : 'ies'} verified in ${latencyMs}ms.`
            : run.length === 0 && notRun.length === 0
                ? 'This provider declares no testable capability.'
                : failed.length > 0
                    ? `${failed.length} of ${run.length} capabilities failed: ${failed.map((entry) => entry.label).join(', ')}.`
                    : `The test ran out of time before checking ${notRun.map((entry) => entry.label).join(', ')}.`,
        model,
        latencyMs,
        capabilities,
    };

    await store.recordTestResult(provider.id, result);
    return result;
}

module.exports = {
    testProviderConnection,
    PROBE_STATUS,
    HEALTH_PROMPT,
    HEALTH_TIMEOUT_MS,
    HEALTH_TOTAL_BUDGET_MS,
    __test: { runProbe },
};
