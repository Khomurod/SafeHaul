/**
 * Normalized token usage, where a vendor reports it.
 *
 * Every provider in the registry that reports usage at all does so under a
 * `usage` object, but they disagree on the field names: the OpenAI-compatible
 * vendors use `prompt_tokens` / `completion_tokens`, Groq's Responses API uses
 * `input_tokens` / `output_tokens`, and Gemini uses `usageMetadata` with
 * `promptTokenCount` / `candidatesTokenCount`.
 *
 * Reconciling them here keeps the vendor-specific spelling inside the provider
 * layer, which is the only place permitted to know it, and lets telemetry
 * record one shape for all nine.
 *
 * Counts only. Token *numbers* say how much was spent; they carry nothing about
 * what was sent, which is what makes them safe to keep against a `restricted`
 * task alongside CDL and document work.
 */

/** A non-negative integer, or `null` for anything else. */
function count(value) {
    return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * @param {object} payload the vendor's parsed response body
 * @returns {{ inputTokens: number|null, outputTokens: number|null }|null}
 *   `null` when the vendor reported nothing usable, so telemetry can omit the
 *   field rather than record a misleading zero.
 */
function normalizeUsage(payload) {
    const usage = payload?.usage || payload?.usageMetadata;
    if (!usage || typeof usage !== 'object') return null;

    const inputTokens = count(
        usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount,
    );
    const outputTokens = count(
        usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount,
    );

    if (inputTokens === null && outputTokens === null) return null;
    return { inputTokens, outputTokens };
}

module.exports = { normalizeUsage };
