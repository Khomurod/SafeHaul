/**
 * Presentation for the publication run ledger.
 *
 * Kept out of the component file so that file exports components only, which is
 * what React Fast Refresh needs to swap one without remounting the page.
 *
 * The vocabulary here is the point of the screen. Before the ledger existed, the
 * only surface an operator could look at was the published-articles list — which
 * by definition holds the runs that succeeded — so a refused slot and a slot
 * nobody attempted were indistinguishable, and "why is yesterday's 07:00 article
 * missing" had no answer in the product.
 */

/**
 * The pipeline stages, in the order a run passes through them.
 *
 * `claim_check` and `verification` are separate on purpose: the first is the
 * deterministic check that the draft did not over-claim about SafeHaul, the
 * second the source-backed fact-check. They refuse for different reasons and the
 * operator's next step differs.
 */
export const RUN_STAGES = Object.freeze([
    { id: 'scheduling', label: 'Scheduling' },
    { id: 'sourcing', label: 'Sourcing' },
    { id: 'generation', label: 'Generation' },
    { id: 'validation', label: 'Validation' },
    { id: 'claim_check', label: 'SafeHaul claim check' },
    { id: 'verification', label: 'Fact-check' },
    { id: 'originality', label: 'Originality' },
    { id: 'image', label: 'Image licence' },
    { id: 'publication', label: 'Publication' },
]);

const STAGE_LABELS = Object.freeze(
    Object.fromEntries(RUN_STAGES.map((stage) => [stage.id, stage.label])),
);

export function describeStage(stage) {
    return STAGE_LABELS[stage] || 'Unknown stage';
}

/**
 * What each outcome means, in an operator's terms.
 *
 * `deferred_to_next_run` is the one most worth spelling out: it looks like a
 * failure in a list of outcomes and is the pipeline working exactly as intended —
 * at most one article publishes per run, so a backlog fills over successive
 * hourly runs rather than appearing three articles at a time.
 */
const OUTCOME_COPY = Object.freeze({
    published: { tone: 'success', label: 'Published' },
    deferred_to_next_run: { tone: 'info', label: 'Held for the next run' },
    skipped_slot_taken: { tone: 'neutral', label: 'Slot already filled' },
    skipped_no_sources: { tone: 'warning', label: 'Not enough sourcing' },
    skipped_all_duplicates: { tone: 'warning', label: 'Already covered' },
    skipped_not_original: { tone: 'warning', label: 'Too close to a recent article' },
    skipped_validation: { tone: 'warning', label: 'Draft failed validation' },
    skipped_prohibited_claim: { tone: 'danger', label: 'Prohibited SafeHaul claim' },
    skipped_unsupported_claims: { tone: 'danger', label: 'Unsupported factual claim' },
    failed_generation: { tone: 'danger', label: 'Generation failed' },
});

export function describeRunOutcome(outcome) {
    return OUTCOME_COPY[outcome] || { tone: 'neutral', label: outcome || 'Unknown' };
}

/**
 * Whether a run actually put an article on the site.
 *
 * Named rather than inferred from the outcome string at each call site, because
 * the whole reported defect is that "the AI succeeded" and "an article was
 * published" were being treated as the same fact.
 */
export function runPublished(run) {
    return run?.outcome === 'published';
}

/**
 * The fact-check verdict, which is NOT the same fact as the fact-check
 * transaction succeeding.
 *
 * A verdict of `supported: false` is a perfectly valid response, so the AI
 * transaction is recorded as a success and the article is correctly refused. In
 * the Logs tab that read as two green rows and no article; this is the line that
 * says which happened.
 */
export function describeVerdict(run) {
    if (run?.verificationSupported === null || run?.verificationSupported === undefined) {
        return null;
    }
    if (run.verificationSupported) return 'Fact-check passed';
    const count = run.unsupportedClaimCount;
    return count ? `Fact-check found ${count} unsupported claim(s)` : 'Fact-check did not pass';
}
