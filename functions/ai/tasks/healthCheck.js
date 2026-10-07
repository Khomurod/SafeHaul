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
 * is this one failing" is the question being asked. Only a full pass touches the
 * provider's state: it clears the cooldowns, the recovery step the runbook gives.
 */

const { requireProvider, resolveModels, isRetired } = require('../registry/providers');
const { CAPABILITIES } = require('../registry/capabilities');
const { getAdapter } = require('../providers');
const { AiError } = require('../router/errors');
const { extractJsonObject, validateAgainstSchema } = require('../validation/schema');
const { probesFor, PROBE_TIMEOUT_MS } = require('./healthProbes');
const store = require('../credentials/store');
const { versionVerdict } = require('../router/versionPolicy');

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
    /**
     * The vendor throttled the diagnostic itself.
     *
     * Measured on 2026-08-18: a two-image probe against Groq's free tier
     * returned `429 … tokens per minute (TPM): Limit 8000, Used 3051, Requested
     * 5023`. A vision probe costs roughly 2.5k of that budget and the
     * multi-image one roughly 5k, so six serial probes cannot all fit inside one
     * minute — and the connection test was spending the allowance and then
     * reporting the resulting 429 as "this provider cannot read images".
     *
     * The capability was never tested. Saying so is the only honest answer, and
     * it must not read as either a pass or a failure.
     */
    RATE_LIMITED: 'rate_limited',
    /**
     * The vendor could not answer for a reason unrelated to the capability —
     * an outage, a timeout, a model briefly over capacity. Groq's preview vision
     * model returned `503 … currently over capacity` during the same session.
     */
    INCONCLUSIVE: 'inconclusive',
});

/**
 * Which probe status a failure category earns.
 *
 * The distinction that matters: did we learn something about this *capability*,
 * or did we learn something about the vendor's current mood? Reporting the second
 * as the first is how two working vision providers ended up on the console as
 * broken, with CDL auto-fill left nothing to fall back to.
 */
function probeStatusFor(category) {
    switch (category) {
        case 'rate_limited':
        case 'quota_exceeded':
            return PROBE_STATUS.RATE_LIMITED;
        case 'provider_unavailable':
        case 'timeout':
        case 'network':
        case 'deadline_exceeded':
            return PROBE_STATUS.INCONCLUSIVE;
        default:
            // Everything else — a rejected request, a retired model, a refused
            // schema, an image read wrongly — is a real finding about the
            // capability.
            return PROBE_STATUS.FAILED;
    }
}

/** Longest a probe may wait on a vendor-stated retry before giving up on it. */
const PROBE_RETRY_CEILING_MS = 30000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A failure shape shared by every early return, so callers see one contract. */
function unavailable(category, message) {
    return { success: false, category, message, latencyMs: 0, capabilities: [] };
}

/**
 * The one sentence that points an operator at the actual fault.
 *
 * Worth stating identically wherever it is reached, because the failure it
 * describes is invisible from the outside: the credential is present and
 * correct, and the Cloud Functions runtime service account cannot read it.
 * Note that 1st and 2nd generation functions default to *different* service
 * accounts, so this can be true of one AI entry point and false of another.
 */
const CREDENTIAL_ERROR_CATEGORY = 'credential_error';
const CREDENTIAL_ERROR_MESSAGE = 'The credential could not be read. Check Secret Manager access for the Functions runtime service account.';

/**
 * Runs one probe against one provider, version by version.
 *
 * The probe walks the lane's versions the way the router does: a failure about
 * one version (gone, not on the plan, rate-limited, refused, overloaded) moves
 * to the next, so "this provider can read a licence" is answered for the
 * provider and not only for its first version. Version rests are neither
 * consulted nor written: the test interrogates exactly what the operator asked
 * about. A switch is made only while the whole test's budget still holds a full
 * probe, so the result is recorded before the function's timeout.
 */
async function runProbe(probe, { provider, config, credentials, deps, deadlineAt = Infinity }) {
    // Resolve against the capability that decides the model, so a vision probe
    // tests the vision model rather than the text one.
    const modelCapability = probe.images ? CAPABILITIES.VISION : probe.capabilities[0];
    const models = resolveModels(provider, modelCapability, config);
    if (models.length === 0) {
        return {
            id: probe.id,
            label: probe.label,
            status: PROBE_STATUS.FAILED,
            category: 'model_unavailable',
            message: 'No model is configured for this capability.',
            latencyMs: 0,
        };
    }

    const failed = [];
    let outcome = null;
    for (const [index, model] of models.entries()) {
        outcome = await runProbeOn(probe, model, { provider, config, credentials, deps, modelCapability });
        if (outcome.status === PROBE_STATUS.PASSED) break;
        const switches = versionVerdict({ category: outcome.category }, { hasCeiling: false }).switchVersion;
        if (!switches || index === models.length - 1 || Date.now() + PROBE_TIMEOUT_MS > deadlineAt) break;
        failed.push(model);
    }
    if (outcome.status === PROBE_STATUS.PASSED && failed.length > 0) {
        outcome.message = `Passed using ${outcome.model} after ${failed.join(', ')} failed.`;
    }
    return outcome;
}

/**
 * Runs one probe against one model version.
 *
 * Structured probes are validated with SafeHaul's own validator rather than
 * trusting the vendor's JSON mode — the same rule the router applies, and for
 * the same reason: a vendor promising JSON is not evidence that it sent JSON,
 * still less that it matched the schema.
 */
async function runProbeOn(probe, model, { provider, config, credentials, deps, modelCapability }) {
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
        const status = probeStatusFor(aiError.category);
        return {
            id: probe.id,
            label: probe.label,
            model,
            latencyMs: Date.now() - startedAt,
            status,
            category: aiError.category,
            // The two most diagnostic facts a vendor failure carries, and both
            // safe by construction: a status is a number, and the code was
            // pattern-validated in ../providers/http.js before it became a field.
            // They were computed and then dropped here, which is why the console
            // could only ever say "Failed" — the difference between "HTTP 404
            // model_not_found" and "HTTP 429" is the difference between repinning
            // a model and waiting a minute.
            httpStatus: aiError.status,
            vendorCode: aiError.vendorCode,
            // How long the vendor said to wait, so the caller can decide whether
            // pausing and asking again is worth it.
            retryAfterMs: aiError.retryAfterHintMs || aiError.retryAfterMs || null,
            // Safe category text only, never the vendor's own error body.
            message: status === PROBE_STATUS.RATE_LIMITED
                ? 'The vendor throttled this check, so the capability was not tested.'
                : aiError.safeMessage,
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

    // Reading the config and the credential both touch infrastructure that can
    // fail for reasons that are nothing to do with this provider. Neither read
    // was guarded, so a `PERMISSION_DENIED` from Secret Manager escaped this
    // function, reached `safeFailure` in ../callables.js, and became
    // `internal: "The request could not be completed."` — the generic *Failed*
    // with nothing underneath it, on the one screen whose entire job is to
    // explain why a provider is not working.
    let config;
    try {
        config = await store.readConfig(provider.id);
    } catch (error) {
        console.error(`[ai/healthCheck] Could not read config for ${provider.id}: ${error?.message || 'unknown'}`);
        return unavailable('internal', 'Provider settings could not be read, so the test did not run.');
    }

    const missingConfig = provider.configFields
        .filter((field) => field.required)
        .filter((field) => !(typeof config[field.name] === 'string' && config[field.name].trim()));
    if (missingConfig.length > 0) {
        return unavailable(
            'not_configured',
            `${missingConfig.map((field) => field.label).join(', ')} is required before testing.`,
        );
    }

    let credentials;
    try {
        credentials = await store.resolveCredentials(provider.id, deps);
    } catch (error) {
        console.error(`[ai/healthCheck] Credential read threw for ${provider.id}: ${error?.message || 'unknown'}`);
        return unavailable(CREDENTIAL_ERROR_CATEGORY, CREDENTIAL_ERROR_MESSAGE);
    }
    // Unreadable is not absent. "Add credentials before testing" is actively
    // misleading when the credential is present and the runtime cannot read it.
    if (Array.isArray(credentials.unreadable) && credentials.unreadable.length > 0) {
        return unavailable(CREDENTIAL_ERROR_CATEGORY, CREDENTIAL_ERROR_MESSAGE);
    }
    if (!credentials.complete) {
        return unavailable('not_configured', 'Add credentials before testing this provider.');
    }

    const capabilities = [];
    const deadlineAt = startedAt + HEALTH_TOTAL_BUDGET_MS;
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
        let outcome = await runProbe(probe, { provider, config, credentials, deps, deadlineAt });

        // One paced retry when the vendor throttled us and said how long to wait.
        //
        // This is not persistence for its own sake. A free tier's per-minute
        // budget is small enough that the connection test can spend it on itself:
        // Groq answered a two-image probe with `Limit 8000, Used 3051, Requested
        // 5023`, so the probes after it were guaranteed to be refused. Waiting
        // the stated few seconds turns "we could not test this" into a real
        // result, and it is the vendor's own number rather than a guess.
        const wait = outcome.status === PROBE_STATUS.RATE_LIMITED ? outcome.retryAfterMs : null;
        const remaining = HEALTH_TOTAL_BUDGET_MS - (Date.now() - startedAt);
        if (wait && wait <= PROBE_RETRY_CEILING_MS && wait + PROBE_TIMEOUT_MS < remaining) {
            await sleep(wait);
            const retried = await runProbe(probe, { provider, config, credentials, deps, deadlineAt });
            // Keep the retry only if it actually learned something; a second
            // throttle should not overwrite the first with a fresher excuse.
            if (retried.status !== PROBE_STATUS.RATE_LIMITED) outcome = retried;
        }
        capabilities.push(outcome);
    }

    // Four buckets, because collapsing them is how a working provider came to be
    // reported as broken. `run` is what we actually learned about a capability;
    // `throttled` and `inconclusive` are things we learned about the vendor.
    const run = capabilities.filter((entry) => (
        entry.status === PROBE_STATUS.PASSED || entry.status === PROBE_STATUS.FAILED
    ));
    const notRun = capabilities.filter((entry) => entry.status === PROBE_STATUS.NOT_RUN);
    const throttled = capabilities.filter((entry) => entry.status === PROBE_STATUS.RATE_LIMITED);
    const inconclusive = capabilities.filter((entry) => entry.status === PROBE_STATUS.INCONCLUSIVE);
    const failed = run.filter((entry) => entry.status === PROBE_STATUS.FAILED);
    const untested = [...notRun, ...throttled, ...inconclusive];
    const latencyMs = Date.now() - startedAt;
    const model = run.find((entry) => entry.model)?.model;

    // A provider is healthy only if every capability it *claims* works. Passing
    // the text probe while failing structured JSON is precisely the state that
    // used to be reported as healthy, and precisely the state that broke CDL
    // extraction, E-Doc analysis and article publishing simultaneously.
    //
    // A test that did not finish is not a pass, and neither is one the vendor
    // throttled or that hit a transient outage — but those are not failures
    // either. Reporting a capability nobody tested is what a claim of health
    // must never do, in either direction.
    const success = run.length > 0 && failed.length === 0 && untested.length === 0;
    const result = {
        success,
        // Only a real finding sets the headline category. A throttled diagnostic
        // is reported through `capabilities`, not as the provider's verdict.
        category: failed[0]?.category || (run.length === 0 && untested.length === 0
            ? 'capability_unavailable'
            : null),
        message: success
            ? `Connected. ${run.length} capabilit${run.length === 1 ? 'y' : 'ies'} verified in ${latencyMs}ms.`
            : run.length === 0 && untested.length === 0
                ? 'This provider declares no testable capability.'
                : failed.length > 0
                    ? `${failed.length} of ${run.length} capabilities failed: ${failed.map((entry) => entry.label).join(', ')}.`
                    // "We ran out of time" and "the vendor throttled us" are
                    // different facts and lead an operator somewhere different,
                    // so neither is folded into a generic "not verified".
                    : notRun.length === untested.length
                        ? `The test ran out of time before checking ${notRun.map((entry) => entry.label).join(', ')}.`
                        : `Not verified: ${untested.map((entry) => entry.label).join(', ')}.`
                            + (throttled.length > 0
                                ? ' The vendor throttled the check rather than refusing the capability.'
                                : ''),
        model,
        latencyMs,
        capabilities,
    };

    await store.recordTestResult(provider.id, result);
    // An operator testing after an outage means "use it again": a full pass ends
    // its cooldowns and version rests, as enabling it does. Anything less leaves them.
    if (success) await store.clearCooldown(provider.id).catch(() => {});
    return result;
}

module.exports = {
    testProviderConnection,
    PROBE_STATUS,
    HEALTH_PROMPT,
    HEALTH_TIMEOUT_MS,
    HEALTH_TOTAL_BUDGET_MS,
    PROBE_RETRY_CEILING_MS,
    __test: { runProbe, probeStatusFor },
};
