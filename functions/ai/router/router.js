/**
 * The capability-aware AI router.
 *
 * Every AI request in SafeHaul goes through `runAiTask`. It walks the frozen
 * provider order, skipping providers that cannot or should not serve this
 * request, and returns the first response that survives validation.
 *
 * The rules it enforces, in the order it enforces them:
 *
 *  1. **Capability is a gate, not a preference.** A provider that has not
 *     declared `vision` never receives an image, so a CDL photograph cannot
 *     reach a text-only vendor by accident or by misconfiguration.
 *  2. **Try each compatible provider once**, in registry priority order, until
 *     one produces a response that passes schema validation.
 *  3. **One provider's failure is not the task's failure.** A timeout, an
 *     outage, an exhausted quota, malformed JSON, a rejected credential or an
 *     unexpected adapter exception all move to the next provider. Only a
 *     genuinely task-fatal category stops the walk — a malformed SafeHaul
 *     request, no capable provider, or the deadline — because those would get
 *     the same answer from all nine. See `isTaskFatal` in ./errors.js.
 *  4. **Bounded everywhere.** Per-provider timeout, a total request deadline,
 *     one attempt per provider unless the registry marks a retry safe, and a
 *     persisted cooldown so an exhausted provider is skipped rather than
 *     rediscovered by every cold instance.
 *  5. **Never fabricate.** If every compatible provider fails, the caller gets
 *     a safe error. There is no synthesized answer.
 */

const { PROVIDERS, supportsAllCapabilities, resolveModel, isRetired } = require('../registry/providers');
const { CAPABILITIES, normalizeCapabilities } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError, isTaskFatal } = require('./errors');
const { validateAgainstSchema, extractJsonObject } = require('../validation/schema');
const store = require('../credentials/store');
const { recordAiTelemetry } = require('../telemetry/record');

/** Ceiling on how long a whole task may take, across every fallback. */
const DEFAULT_TOTAL_DEADLINE_MS = 120000;

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
});

/**
 * Decides whether a provider may serve this request.
 *
 * @returns {Promise<{ eligible: boolean, reason?: string, config?: object, credentials?: object, model?: string }>}
 */
async function evaluateProvider(provider, { capabilities, primaryCapability, configs, now, deps }) {
    if (isRetired(provider)) return { eligible: false, reason: SKIP_REASONS.RETIRED };

    if (!supportsAllCapabilities(provider, capabilities)) {
        return { eligible: false, reason: SKIP_REASONS.INCAPABLE };
    }

    const config = configs.get(provider.id) || { enabled: true };
    if (config.enabled === false) return { eligible: false, reason: SKIP_REASONS.DISABLED };

    const cooldown = store.cooldownState(config, now);
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
    if (!credentials.complete) return { eligible: false, reason: SKIP_REASONS.UNCONFIGURED };

    const model = resolveModel(provider, primaryCapability, config);
    if (!model) return { eligible: false, reason: SKIP_REASONS.NO_MODEL };

    return { eligible: true, config, credentials, model };
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

/**
 * Validates a provider's raw text against the task's expected output.
 *
 * A structured task that yields unparseable or schema-violating JSON is a
 * *provider* failure, so it fails over — which is what makes structured output
 * reliable across nine vendors of differing JSON discipline.
 */
function normalizeOutput({ text, schema, providerId }) {
    if (!schema) return { output: text };

    const parsed = extractJsonObject(text);
    if (!parsed) {
        throw new AiError('malformed_response', 'Output was not parseable JSON.', { providerId });
    }

    const { valid, errors } = validateAgainstSchema(parsed, schema);
    if (!valid) {
        // Only the first violation, and it names a path, not a value.
        throw new AiError('schema_validation_failed', errors[0] || 'Schema validation failed.', { providerId });
    }
    return { output: parsed };
}

/**
 * Runs one AI task through the router.
 *
 * @param {object} task normalized task contract (see ../tasks/contract.js)
 * @param {object} [deps] injection seam: `{ client, fetchImpl, now, providers }`
 * @returns {Promise<{ output: *, providerId: string, model: string, latencyMs: number,
 *   fallbackCount: number, credentialSource: string }>}
 */
async function runAiTask(task, deps = {}) {
    const startedAt = Date.now();
    const capabilities = normalizeCapabilities(task.capabilities);
    const primaryCapability = pickPrimaryCapability(capabilities);
    const hasImages = Array.isArray(task.images) && task.images.length > 0;

    // Defence in depth: the task contract should already have declared vision
    // when it carries images. If it did not, refuse rather than route an image
    // to whichever provider happens to be first.
    if (hasImages && !capabilities.includes(CAPABILITIES.VISION)) {
        throw new AiError('invalid_request', 'Task supplied images without declaring the vision capability.');
    }
    if (hasImages && task.images.length > 1 && !capabilities.includes(CAPABILITIES.MULTI_IMAGE)) {
        throw new AiError('invalid_request', 'Task supplied multiple images without declaring multi-image.');
    }

    const totalDeadlineMs = Number.isInteger(task.totalDeadlineMs)
        ? task.totalDeadlineMs
        : DEFAULT_TOTAL_DEADLINE_MS;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), totalDeadlineMs);

    const providers = deps.providers || PROVIDERS;
    const configs = await store.readAllConfigs();
    const now = typeof deps.now === 'number' ? deps.now : Date.now();

    const attempted = [];
    const skipped = [];
    // Per-provider outcome, so a total failure can name each cause rather than
    // only the last one. Categories only — never bodies, prompts or credentials.
    const failures = [];
    let lastError = null;

    try {
        for (const provider of providers) {
            if (deadlineController.signal.aborted) {
                lastError = new AiError('deadline_exceeded', 'Total AI deadline reached.');
                break;
            }

            const evaluation = await evaluateProvider(provider, {
                capabilities, primaryCapability, configs, now, deps,
            });

            if (!evaluation.eligible) {
                skipped.push({ providerId: provider.id, reason: evaluation.reason });
                continue;
            }

            attempted.push(provider.id);
            const adapter = getAdapter(provider);
            const attempts = Math.max(1, provider.retryPolicy?.attempts || 1);

            let providerError = null;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                if (attempt > 0) {
                    const backoff = provider.retryPolicy?.backoffMs || 0;
                    if (backoff > 0) await sleep(backoff, deadlineController.signal);
                    if (deadlineController.signal.aborted) break;
                }
                try {
                    const raw = await adapter.execute({
                        provider,
                        capability: primaryCapability,
                        model: evaluation.model,
                        systemInstructions: task.systemInstructions,
                        inputText: task.inputText,
                        images: task.images,
                        schema: task.outputSchema,
                        schemaName: task.schemaName || 'safehaul_task_output',
                        temperature: typeof task.temperature === 'number' ? task.temperature : 0,
                        maxOutputTokens: task.maxOutputTokens || 2048,
                        timeoutMs: Math.min(provider.timeoutMs, totalDeadlineMs),
                        parentSignal: deadlineController.signal,
                        credentials: evaluation.credentials.values,
                        config: evaluation.config,
                        fetchImpl: deps.fetchImpl,
                    });

                    const { output } = normalizeOutput({
                        text: raw.text,
                        schema: task.outputSchema,
                        providerId: provider.id,
                    });

                    await store.recordProviderOutcome(provider.id, { success: true });
                    const latencyMs = Date.now() - startedAt;
                    await recordAiTelemetry({
                        taskType: task.taskType,
                        capability: primaryCapability,
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        outcome: 'success',
                        latencyMs,
                        fallbackCount: attempted.length - 1,
                        attemptedProviders: attempted,
                        cooldownSkipped: skipped.filter((s) => s.reason === SKIP_REASONS.COOLDOWN).length,
                        credentialSource: evaluation.credentials.source,
                    });

                    return {
                        output,
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        latencyMs,
                        fallbackCount: attempted.length - 1,
                        credentialSource: evaluation.credentials.source,
                    };
                } catch (error) {
                    providerError = error instanceof AiError
                        ? error
                        : new AiError('internal', error?.message || 'Adapter failed.', { providerId: provider.id });

                    // Only a *task-fatal* category abandons the whole chain: a
                    // malformed SafeHaul request, no capable provider, or the
                    // deadline. Every vendor would answer those the same way.
                    if (isTaskFatal(providerError.category)) {
                        await finishFailure(task, providerError, {
                            attempted, skipped, startedAt, primaryCapability,
                        });
                        throw providerError;
                    }

                    // Anything else ends this provider's turn, not the task.
                    // `unauthorized` is one vendor's key; `internal` is one
                    // adapter misbehaving. Throwing here let a single bad key or
                    // a single adapter bug disable all nine providers, which is
                    // exactly what the fallback order exists to prevent.
                    if (!providerError.retryable) break;
                }
            }

            if (providerError) {
                lastError = providerError;
                failures.push({ providerId: provider.id, category: providerError.category });
                await store.recordProviderOutcome(provider.id, {
                    success: false,
                    category: providerError.category,
                });
            }
        }
    } finally {
        clearTimeout(deadlineTimer);
    }

    // Nothing succeeded. Say so plainly rather than inventing an answer.
    const failure = buildTerminalFailure({ attempted, skipped, lastError, failures });
    await finishFailure(task, failure, { attempted, skipped, startedAt, primaryCapability });
    throw failure;
}

/**
 * Distinguishes "every provider tried and failed" from "nothing was even
 * eligible", because those need different operator action: the first is an
 * outage, the second is a configuration gap.
 */
function buildTerminalFailure({ attempted, skipped, lastError, failures = [] }) {
    if (attempted.length > 0) {
        // Name every provider and the category it failed with, in order.
        //
        // `all_providers_failed` on its own is unactionable: a production run
        // reported it for four hours and the only way to learn *why* each
        // provider failed was to reconstruct the pipeline locally. Categories are
        // safe to log — they carry no credential, no provider response body and
        // no prompt, which is the whole reason the taxonomy exists.
        const trail = failures.length
            ? failures.map((entry) => `${entry.providerId}=${entry.category}`).join(', ')
            : attempted.join(', ');
        return new AiError('all_providers_failed',
            `${attempted.length} provider(s) attempted [${trail}];`
            + ` last failure ${lastError?.category || 'unknown'}.`);
    }
    const onlyIncapable = skipped.length > 0
        && skipped.every((entry) => entry.reason === SKIP_REASONS.INCAPABLE || entry.reason === SKIP_REASONS.RETIRED);
    if (onlyIncapable) {
        return new AiError('capability_unavailable', 'No provider supports the required capabilities.');
    }
    return new AiError('not_configured', 'No configured, enabled provider can serve this task.');
}

async function finishFailure(task, error, { attempted, skipped, startedAt, primaryCapability }) {
    await recordAiTelemetry({
        taskType: task.taskType,
        capability: primaryCapability,
        providerId: error.providerId || null,
        outcome: 'failure',
        category: error.category,
        latencyMs: Date.now() - startedAt,
        fallbackCount: Math.max(0, attempted.length - 1),
        attemptedProviders: attempted,
        cooldownSkipped: skipped.filter((entry) => entry.reason === SKIP_REASONS.COOLDOWN).length,
    });
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

/**
 * Which providers could serve a capability set right now, and why the others
 * could not. Powers the Super Admin console's readiness summary.
 */
async function describeRouting(capabilities, deps = {}) {
    const normalized = normalizeCapabilities(capabilities);
    const primaryCapability = pickPrimaryCapability(normalized);
    const configs = await store.readAllConfigs();
    const now = typeof deps.now === 'number' ? deps.now : Date.now();
    const rows = [];

    for (const provider of PROVIDERS) {
        const evaluation = await evaluateProvider(provider, {
            capabilities: normalized, primaryCapability, configs, now, deps,
        });
        rows.push({
            providerId: provider.id,
            eligible: evaluation.eligible,
            reason: evaluation.reason || null,
            model: evaluation.model || null,
        });
    }
    return rows;
}

module.exports = {
    runAiTask,
    describeRouting,
    SKIP_REASONS,
    DEFAULT_TOTAL_DEADLINE_MS,
    __test: { evaluateProvider, pickPrimaryCapability, normalizeOutput, buildTerminalFailure },
};
