/**
 * Presentation helpers for the AI Logs tab.
 *
 * Outside the component files for the same reason as
 * `aiProviderPresentation.js`: those files export components only, which is what
 * React Fast Refresh needs to swap a component without remounting the page.
 *
 * Every mapping here pairs a tone with a **text label**. Status is never colour
 * alone — the design-system rule, and the right one for a screen whose whole
 * purpose is telling an operator what went wrong.
 */

/** The SafeHaul feature behind each task type, in the operator's language. */
const TASK_LABELS = Object.freeze({
    cdl_extraction: 'CDL extraction',
    edoc_field_placement: 'E-Doc analysis',
    article_generation: 'Article generation',
    article_fact_check: 'Article verification',
    capability_claim_check: 'Claim check',
    topic_selection: 'Topic selection',
    health_check: 'Connection test',
});

export function describeTaskType(taskType) {
    return TASK_LABELS[taskType] || taskType || 'Unknown task';
}

/**
 * The quick filters across the top of the Logs tab.
 *
 * `taskType` maps straight onto the server-side filter; `outcome` onto the
 * other. Deliberately the shortcuts an operator actually reaches for — "is
 * anything broken", and then the three features that use AI.
 */
export const LOG_QUICK_FILTERS = Object.freeze([
    { id: 'all', label: 'All', filters: {} },
    { id: 'errors', label: 'Errors', filters: { outcome: 'failure' } },
    { id: 'cdl', label: 'CDL', filters: { taskType: 'cdl_extraction' } },
    { id: 'edocs', label: 'E-Docs', filters: { taskType: 'edoc_field_placement' } },
    // Deliberately no `taskType`: an article run makes TWO transactions —
    // generation and the fact-check — and this filter used to name only the first.
    // So a run refused by the fact-check was invisible under the one filter an
    // operator would think to use, which is most of why "generation succeeded" was
    // being read as "an article published". Article transactions are selected
    // client-side from the pair below.
    { id: 'articles', label: 'Articles', filters: { articleTasks: true } },
]);

/** The task types that make up one article run, in the order they happen. */
export const ARTICLE_TASK_TYPES = Object.freeze(['article_generation', 'article_fact_check']);

/** The overall result of one transaction. */
export function describeOutcome(entry) {
    if (entry?.outcome === 'success') {
        // A verdict outranks the fallback count in the detail line, because it is
        // the fact most likely to be misread. A fact-check that answered
        // `supported: false` IS a successful transaction — the provider replied in
        // a valid shape — and it is also the reason no article was published. Left
        // to "Success · first provider" it read as an unqualified pass.
        const verdict = describeVerdictWord(entry.verdict);
        return {
            tone: entry.verdict === 'unsupported' ? 'warning' : 'success',
            label: 'Success',
            // A success that needed three providers is not the same event as one
            // that needed none, and an operator watching for trouble wants the
            // difference visible without opening the row.
            detail: verdict || (entry.fallbackCount > 0
                ? `after ${entry.fallbackCount} fallback${entry.fallbackCount === 1 ? '' : 's'}`
                : 'first provider'),
        };
    }
    return {
        tone: 'danger',
        label: 'Failed',
        detail: describeCategory(entry?.category),
    };
}

/**
 * A failure category in plain words.
 *
 * These are the router's own taxonomy, and the wording matters: the categories
 * exist precisely so an operator is pointed at the right thing. "Temporarily
 * unavailable" for a permanent request-shape bug sends someone to a vendor
 * status page instead of to us.
 */
const CATEGORY_LABELS = Object.freeze({
    timeout: 'Timed out',
    network: 'Network failure',
    provider_unavailable: 'Provider unavailable',
    quota_exceeded: 'Quota exhausted',
    rate_limited: 'Rate limited',
    model_unavailable: 'Model not found',
    malformed_response: 'Unreadable response',
    output_truncated: 'Output truncated',
    provider_request_rejected: 'Request rejected by vendor',
    schema_validation_failed: 'Failed SafeHaul validation',
    unauthorized: 'Credential rejected',
    not_configured: 'Not configured',
    // Deliberately not "Not configured". The credential is present and this
    // runtime cannot read it, which is an IAM fault rather than a missing key.
    credential_error: 'Credential unreadable',
    invalid_request: 'Invalid SafeHaul request',
    capability_unavailable: 'No capable provider',
    deadline_exceeded: 'Deadline reached',
    all_providers_failed: 'Every provider failed',
    internal: 'Internal error',
});

/**
 * The task's own word for what its answer said, in plain English.
 *
 * Only words SafeHaul's own tasks produce are translated; anything else is shown
 * verbatim, because it has already been pattern-checked to be a single short
 * token and inventing a label for an unknown one would be a guess.
 */
const VERDICT_LABELS = Object.freeze({
    supported: 'claims supported',
    unsupported: 'claims NOT supported — article refused',
});

export function describeVerdictWord(verdict) {
    if (!verdict) return null;
    return VERDICT_LABELS[verdict] || verdict;
}

export function describeCategory(category) {
    if (!category) return '';
    return CATEGORY_LABELS[category] || category;
}

/** One provider's turn inside a transaction. */
export function describeAttempt(attempt) {
    if (attempt?.status === 'skipped') {
        return { tone: 'neutral', label: 'Skipped', detail: describeSkip(attempt.skipReason) };
    }
    if (attempt?.success) {
        return { tone: 'success', label: 'Success', detail: '' };
    }
    return { tone: 'danger', label: 'Failed', detail: describeCategory(attempt?.category) };
}

/**
 * Why the router passed a provider over.
 *
 * Kept separate from `describeSkipReason` in `aiProviderPresentation.js`: that
 * one answers "why is this provider ineligible right now" in the routing panel,
 * this one answers "why was it passed over during that request" in a timeline.
 * Same vocabulary, different tense, and collapsing them would make one of the
 * two read oddly.
 */
function describeSkip(reason) {
    switch (reason) {
        case 'retired': return 'retired by the vendor';
        case 'incapable': return 'cannot serve this capability';
        case 'disabled': return 'disabled by an operator';
        case 'unconfigured': return 'no credential configured';
        case 'cooldown': return 'in cooldown';
        case 'no_model': return 'no model for this capability';
        case 'credential_error': return 'credential could not be read';
        case 'too_many_images': return 'too many images for this vendor';
        default: return 'passed over';
    }
}

/** `2992` → `3.0s`. Milliseconds below a second stay milliseconds. */
export function formatDuration(ms) {
    if (!Number.isFinite(ms)) return '—';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
}

/** A capability probe result from `testAiProvider`. */
export function describeProbe(probe) {
    switch (probe?.status) {
        case 'passed':
            return { tone: 'success', label: 'Passed' };
        case 'failed':
            return { tone: 'danger', label: 'Failed' };
        case 'rate_limited':
            // The vendor throttled the check, so the capability was never
            // tested. Reporting that as a failure is how two working vision
            // providers came to be shown as broken: a free tier's per-minute
            // budget is small enough that the connection test can spend it on
            // itself.
            return { tone: 'warning', label: 'Throttled' };
        case 'inconclusive':
            return { tone: 'warning', label: 'Not verified' };
        case 'not_run':
            // Distinct from `skipped`. "We ran out of time" and "this provider
            // does not offer it" are different facts, and folding the first into
            // the second reads as an all-clear for something nobody checked.
            return { tone: 'warning', label: 'Not run' };
        default:
            // Not offered is not a failure, and must not read as one.
            return { tone: 'neutral', label: 'Not offered' };
    }
}

/**
 * The vendor's own account of a probe failure, in one short line.
 *
 * `httpStatus` and `vendorCode` were captured server-side and then dropped
 * before they reached this screen, which is why every unsuccessful capability
 * read simply "Failed". The difference between `404 model_not_found` and `429`
 * is the difference between repinning a model and waiting a minute, and an
 * operator could not see it.
 *
 * Both are safe by construction: a status is a number, and the code was
 * positively validated against a short single-token pattern before it was ever
 * allowed to leave the server — a vendor's error *message* never is.
 */
export function describeProbeDetail(probe) {
    const parts = [];
    if (Number.isInteger(probe?.httpStatus)) parts.push(`HTTP ${probe.httpStatus}`);
    if (probe?.vendorCode) parts.push(probe.vendorCode);
    if (parts.length === 0 && probe?.category) parts.push(describeCategory(probe.category));
    return parts.join(' · ');
}

/**
 * A provider's health in one lane.
 *
 * Two lanes rather than one badge, because a provider's text and image lanes
 * reach different models on different entitlements and fail independently. A
 * single scalar let a successful article quietly turn the badge green again while
 * every CDL photograph the same provider was handed was being rejected.
 */
export function describeLaneHealth(state) {
    switch (state) {
        case 'healthy':
            return { tone: 'success', label: 'Working' };
        case 'degraded':
            return { tone: 'danger', label: 'Failing' };
        case 'quota':
            return { tone: 'warning', label: 'Quota' };
        default:
            // Never exercised is not the same as working.
            return { tone: 'neutral', label: 'Not seen yet' };
    }
}

/**
 * The pin-reconciliation result for one provider.
 *
 * `unsupported` and `unreachable` are deliberately distinct from both `ok` and
 * `stale`: "we could not check" is an honest answer, and reporting it as either
 * a pass or a failure would be a lie in one direction or the other.
 */
export function describePinStatus(entry) {
    switch (entry?.status) {
        case 'ok':
            return { tone: 'success', label: 'All models present' };
        case 'stale': {
            const stale = (entry.pins || []).filter((pin) => !pin.present).length;
            return { tone: 'danger', label: `${stale} model${stale === 1 ? '' : 's'} missing` };
        }
        case 'unreachable':
            return { tone: 'warning', label: 'Could not reach vendor' };
        case 'unsupported':
            return { tone: 'neutral', label: 'No catalogue to check' };
        case 'unconfigured':
            return { tone: 'neutral', label: 'Not configured' };
        case 'credential_error':
            return { tone: 'danger', label: 'Credential unreadable' };
        case 'retired':
            return { tone: 'neutral', label: 'Retired' };
        default:
            return { tone: 'neutral', label: 'Unknown' };
    }
}
