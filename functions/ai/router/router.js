/**
 * The capability-aware AI router.
 *
 * Every AI request in SafeHaul goes through `runAiTask`. It walks the provider
 * order, skipping providers that cannot or should not serve this request, and
 * returns the first response that survives validation.
 *
 * The order is the registry's `priority` unless a Super Admin has stored an
 * override in `ai_routing_config/order`; see ./order.js, which degrades to the
 * registry order rather than disabling AI if that document is absent or
 * corrupt. Ordering is applied *before* eligibility, so nothing below changes:
 * promoting a provider cannot make it serve a task it is not capable of.
 *
 * The rules it enforces, in the order it enforces them:
 *
 *  1. **Capability is a gate, not a preference.** A provider that has not
 *     declared `vision` never receives an image, so a CDL photograph cannot
 *     reach a text-only vendor by accident or by misconfiguration.
 *  2. **Try each compatible provider once**, in the effective order, until
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
const { orderProviders, readProviderOrder } = require('./order');
const { validateAgainstSchema, extractJsonObject } = require('../validation/schema');
const store = require('../credentials/store');
const {
    recordAiTelemetry, describeTaskInput, MAX_ATTEMPTS: MAX_RECORDED_ATTEMPTS,
} = require('../telemetry/record');
const { randomUUID } = require('crypto');

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

/**
 * Rejects images SafeHaul itself built wrongly, once, before any provider is
 * tried.
 *
 * A non-data-URL image is a bug on our side, not a vendor's, so it is fatal —
 * but it must be fatal *here*, where it costs nothing. It used to surface from
 * inside the Gemini adapter as `invalid_request`, which `isTaskFatal` treats as
 * terminal, so a malformed image aborted the whole walk from within whichever
 * provider happened to be first. Same verdict, reached before spending a
 * request, and identical no matter who leads the order.
 */
const IMAGE_DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,/i;

function assertImagesAreWellFormed(images) {
    for (const [index, image] of images.entries()) {
        if (typeof image?.dataUrl !== 'string' || !IMAGE_DATA_URL.test(image.dataUrl)) {
            throw new AiError('invalid_request', `Image ${index + 1} is not a base64 data URL.`);
        }
    }
}

/**
 * Runs one AI task through the router.
 *
 * @param {object} task normalized task contract (see ../tasks/contract.js)
 * @param {object} [deps] injection seam:
 *   `{ client, fetchImpl, now, providers, providerOrder }`
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
    if (hasImages) assertImagesAreWellFormed(task.images);

    const imageCount = hasImages ? task.images.length : 0;
    const totalDeadlineMs = Number.isInteger(task.totalDeadlineMs)
        ? task.totalDeadlineMs
        : DEFAULT_TOTAL_DEADLINE_MS;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(), totalDeadlineMs);

    const providers = await resolveProviderOrder(deps);
    const configs = await resolveConfigs();
    const now = typeof deps.now === 'number' ? deps.now : Date.now();
    // `null` means config could not be read and this instance has no cached
    // copy, so it cannot tell which providers an operator disabled. See
    // `resolveConfigs`: refusing is the safe direction, and it is reported as a
    // categorised failure with telemetry rather than as an uncaught throw.
    const configUnavailable = configs === null;

    const attempted = [];
    const skipped = [];
    // Per-provider outcome, so a total failure can name each cause rather than
    // only the last one. Categories only — never bodies, prompts or credentials.
    const failures = [];
    let lastError = null;

    /**
     * The transaction record being assembled as the walk proceeds.
     *
     * One id per request, so the several provider attempts below can be read
     * back as one timeline. Returned to the caller as well, so a callable's own
     * log line can name the transaction an operator is looking at.
     */
    const transactionId = randomUUID();
    const attemptRecords = [];

    /** Appends one provider's turn. Metadata only — see ../telemetry/record.js. */
    function noteAttempt(record) {
        if (attemptRecords.length >= MAX_RECORDED_ATTEMPTS) return;
        attemptRecords.push(record);
    }

    /**
     * Names, on each entry, the provider the router moved on to.
     *
     * Redundant with the array order, and worth the duplication: it makes a
     * single attempt legible on its own, so a log line or a filtered view
     * showing one row still answers "and then what?".
     */
    function linkedAttempts() {
        return attemptRecords.map((entry, index) => ({
            ...entry,
            // The next provider actually *asked*, not merely the next row.
            // Naming a skipped provider here would read as "fell back to
            // Mistral" when Mistral was never contacted.
            nextProviderId: attemptRecords
                .slice(index + 1)
                .find((candidate) => candidate.status === 'attempted')?.providerId || null,
        }));
    }

    function noteSkip(provider, reason) {
        skipped.push({ providerId: provider.id, reason });
        noteAttempt({
            providerId: provider.id,
            attemptNumber: attemptRecords.length + 1,
            status: 'skipped',
            skipReason: reason,
            success: false,
        });
    }

    const transactionBase = {
        transactionId,
        taskType: task.taskType,
        capability: primaryCapability,
        requiredCapabilities: capabilities,
        inputSummary: describeTaskInput(task),
    };

    try {
        for (const provider of providers) {
            if (deadlineController.signal.aborted) {
                lastError = new AiError('deadline_exceeded', 'Total AI deadline reached.');
                break;
            }

            const evaluation = configUnavailable
                ? { eligible: false, reason: SKIP_REASONS.CONFIG_UNAVAILABLE }
                : await safeEvaluateProvider(provider, {
                    capabilities, primaryCapability, configs, now, deps, imageCount,
                });

            if (!evaluation.eligible) {
                noteSkip(provider, evaluation.reason);
                continue;
            }

            attempted.push(provider.id);
            const adapter = getAdapter(provider);
            const providerAttemptBudget = Math.max(1, provider.retryPolicy?.attempts || 1);

            let providerError = null;
            // A vendor that tells us when to come back earns one attempt beyond
            // the registry's policy, once. Groq refuses a request exceeding its
            // per-minute token budget and states the reset in about seven seconds;
            // against a two-minute task deadline, abandoning a working provider
            // over that is a waste. Bounded three ways: `MAX_RETRY_AFTER_MS` in
            // http.js caps the wait, `usedStatedWait` caps it to one occurrence,
            // and the deadline signal ends it regardless.
            let usedStatedWait = false;
            let maxAttempts = providerAttemptBudget;

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const attemptStartedAt = Date.now();
                if (attempt > 0) {
                    const stated = providerError?.retryAfterMs && !usedStatedWait
                        ? providerError.retryAfterMs
                        : 0;
                    if (stated) usedStatedWait = true;
                    const backoff = stated || provider.retryPolicy?.backoffMs || 0;
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
                    noteAttempt({
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        attemptNumber: attemptRecords.length + 1,
                        status: 'attempted',
                        success: true,
                        latencyMs: Date.now() - attemptStartedAt,
                        // The output reached here, so it parsed *and* validated.
                        schemaValid: Boolean(task.outputSchema),
                        inputTokens: raw.usage?.inputTokens ?? null,
                        outputTokens: raw.usage?.outputTokens ?? null,
                    });
                    await recordAiTelemetry({
                        ...transactionBase,
                        providerId: provider.id,
                        model: raw.model || evaluation.model,
                        outcome: 'success',
                        latencyMs,
                        fallbackCount: attempted.length - 1,
                        attemptedProviders: attempted,
                        providersInvolved: attemptRecords.map((entry) => entry.providerId),
                        cooldownSkipped: skipped.filter((s) => s.reason === SKIP_REASONS.COOLDOWN).length,
                        credentialSource: evaluation.credentials.source,
                        attempts: linkedAttempts(),
                    });

                    return {
                        output,
                        transactionId,
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

                    noteAttempt({
                        providerId: provider.id,
                        model: evaluation.model,
                        attemptNumber: attemptRecords.length + 1,
                        status: 'attempted',
                        success: false,
                        category: providerError.category,
                        // Both are already safe by construction: a status is a
                        // number, and the code was pattern-checked in http.js.
                        httpStatus: providerError.status,
                        vendorCode: providerError.vendorCode,
                        retryAfterMs: providerError.retryAfterMs,
                        latencyMs: Date.now() - attemptStartedAt,
                        // Records *why* fallback happened for a structured task:
                        // the vendor answered, but not in a shape SafeHaul could
                        // use. That reads very differently from an outage.
                        schemaValid: providerError.category === 'schema_validation_failed'
                            ? false
                            : undefined,
                    });

                    // Only a *task-fatal* category abandons the whole chain: a
                    // malformed SafeHaul request, no capable provider, or the
                    // deadline. Every vendor would answer those the same way.
                    if (isTaskFatal(providerError.category)) {
                        await finishFailure(task, providerError, {
                            attempted, skipped, startedAt, primaryCapability,
                            transactionBase, attempts: linkedAttempts(),
                        });
                        throw providerError;
                    }

                    // Grant one extra attempt when the vendor stated a short
                    // wait. The loop above performs the wait and re-executes, so
                    // there is exactly one code path that calls the adapter.
                    if (providerError.retryAfterMs && !usedStatedWait
                        && attempt === maxAttempts - 1
                        && !deadlineController.signal.aborted) {
                        maxAttempts += 1;
                        continue;
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
    } catch (error) {
        // A task-fatal category has already recorded its telemetry and is on
        // its way out; pass it through untouched.
        if (error instanceof AiError) throw error;

        // Anything else escaping the walk — an unknown adapter, a Firestore
        // write that threw where it promised not to — must still leave the
        // platform's contract intact: a categorised `AiError` and exactly one
        // telemetry row. An uncategorised exception reaching a callable is how
        // "AI is broken" becomes unanswerable.
        const wrapped = new AiError('internal', error?.message || 'AI routing failed unexpectedly.');
        await finishFailure(task, wrapped, {
            attempted, skipped, startedAt, primaryCapability,
            transactionBase, attempts: linkedAttempts(),
        });
        throw wrapped;
    } finally {
        clearTimeout(deadlineTimer);
    }

    // Nothing succeeded. Say so plainly rather than inventing an answer.
    const failure = buildTerminalFailure({ attempted, skipped, lastError, failures });
    await finishFailure(task, failure, {
        attempted, skipped, startedAt, primaryCapability,
        transactionBase, attempts: linkedAttempts(),
    });
    failure.transactionId = transactionId;
    throw failure;
}

/**
 * Distinguishes "every provider tried and failed" from "nothing was even
 * eligible", because those need different operator action: the first is an
 * outage, the second is a configuration gap.
 */
function buildTerminalFailure({ attempted, skipped, lastError, failures = [] }) {
    // The deadline outranks everything below it. It used to be overwritten with
    // `all_providers_failed`, or — when it fired before anything was tried —
    // with `not_configured`, which tells an operator to go and check
    // credentials that were never the problem. "We ran out of time" is a
    // different fault from "nothing is configured" and needs a different fix.
    if (lastError?.category === 'deadline_exceeded') return lastError;

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
    // Distinct from "nothing is configured": the configuration exists and could
    // not be read, so pointing an operator at credentials would waste their time.
    if (skipped.length > 0 && skipped.every((entry) => entry.reason === SKIP_REASONS.CONFIG_UNAVAILABLE)) {
        return new AiError('not_configured', 'Provider configuration could not be read.');
    }

    const onlyIncapable = skipped.length > 0
        && skipped.every((entry) => entry.reason === SKIP_REASONS.INCAPABLE || entry.reason === SKIP_REASONS.RETIRED);
    if (onlyIncapable) {
        return new AiError('capability_unavailable', 'No provider supports the required capabilities.');
    }
    return new AiError('not_configured', 'No configured, enabled provider can serve this task.');
}

async function finishFailure(task, error, {
    attempted, skipped, startedAt, primaryCapability, transactionBase = {}, attempts = [],
}) {
    await recordAiTelemetry({
        taskType: task.taskType,
        capability: primaryCapability,
        ...transactionBase,
        providerId: error.providerId || null,
        outcome: 'failure',
        category: error.category,
        latencyMs: Date.now() - startedAt,
        fallbackCount: Math.max(0, attempted.length - 1),
        attemptedProviders: attempted,
        providersInvolved: attempts.map((entry) => entry.providerId),
        cooldownSkipped: skipped.filter((entry) => entry.reason === SKIP_REASONS.COOLDOWN).length,
        attempts,
    });
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
}

/**
 * Which providers could serve a capability set right now, in the order they
 * would actually be tried, and why the others could not.
 *
 * This is what lets the Super Admin console answer the question a bare ranking
 * cannot: *"Cerebras is enabled and configured — why is it never used for CDL
 * photographs?"* The answer is `incapable`, and it comes from the same
 * `evaluateProvider` the router itself uses rather than a second copy of the
 * rules that could drift from it.
 *
 * @param {string[]} capabilities the task's capability set
 * @param {object} [deps] injection seam. `configs` lets a caller that has
 *   already read `ai_provider_config` pass the map in rather than re-reading
 *   the collection once per capability set; `providerOrder` mirrors
 *   `runAiTask`'s seam.
 */
async function describeRouting(capabilities, deps = {}) {
    const normalized = normalizeCapabilities(capabilities);
    const primaryCapability = pickPrimaryCapability(normalized);
    // `null` when config is unreadable with no cached copy; the console then
    // shows every provider as `config_unavailable` rather than failing to load.
    const configs = deps.configs || await resolveConfigs();
    const configUnavailable = configs === null;
    const now = typeof deps.now === 'number' ? deps.now : Date.now();
    const providers = await resolveProviderOrder(deps);
    const rows = [];

    for (const provider of providers) {
        // Same non-throwing evaluation the router uses. A provider whose secret
        // cannot be read shows as `credential_error` on the console instead of
        // failing the whole AI Integrations page load.
        const evaluation = configUnavailable
            ? { eligible: false, reason: SKIP_REASONS.CONFIG_UNAVAILABLE }
            : await safeEvaluateProvider(provider, {
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
    resolveProviderOrder,
    __test: {
        evaluateProvider,
        safeEvaluateProvider,
        pickPrimaryCapability,
        normalizeOutput,
        buildTerminalFailure,
        assertImagesAreWellFormed,
    },
};
