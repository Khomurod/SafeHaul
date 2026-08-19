import React, { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { Badge, Button, Card, FieldMessage } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';

import {
    RUN_STAGES,
    describeRunOutcome,
    describeStage,
    describeVerdict,
    runPublished,
} from './blogRunPresentation';

/**
 * Publication runs: what happened to every due slot, stage by stage.
 *
 * ## The question this answers
 *
 * The article list above can only ever show runs that *succeeded* — it reads
 * `blog_posts`. So publication failure was rendered as absence: a slot refused
 * for thin sourcing, a slot that lost a create race, and a slot nobody attempted
 * all looked identical, which is to say they looked like nothing at all.
 *
 * The AI transactions those runs made *were* recorded, as successes, because a
 * telemetry success means "a provider answered in a valid shape" and is written
 * before the caller sees the answer. A fact-check verdict of `supported: false`
 * is itself a valid answer. So an operator could see `article_generation:
 * Success` and `article_fact_check: Success` for a run that published nothing —
 * which is exactly the impression this panel exists to remove.
 *
 * Every row therefore names the stage that decided the outcome, and the
 * transaction ids so a run can be matched to its provider timeline in the AI
 * Integrations Logs tab.
 */
export function BlogRunLedger({ runs, loading, error, truncated, unavailable, retentionDays, onRefresh }) {
    const [stageFilter, setStageFilter] = useState('all');
    const [showPublished, setShowPublished] = useState(true);

    const visible = useMemo(() => (runs || []).filter((run) => {
        if (stageFilter !== 'all' && run.stage !== stageFilter) return false;
        if (!showPublished && runPublished(run)) return false;
        return true;
    }), [runs, stageFilter, showPublished]);

    // Only the stages actually present, so the filter never offers a choice that
    // yields an empty list.
    const availableStages = useMemo(() => {
        const present = new Set((runs || []).map((run) => run.stage));
        return RUN_STAGES.filter((stage) => present.has(stage.id));
    }, [runs]);

    return (
        <Card padding="md">
            <div className="flex flex-wrap items-center justify-between gap-ds-2">
                <div>
                    <h3 className="text-ds-sm font-semibold text-ds-content">Publication runs</h3>
                    <p className="mt-1 text-ds-sm text-ds-content-secondary">
                        Every due slot from every recent run, and the stage that decided it.
                        Generation succeeding is not the same as an article publishing, so both are
                        shown. Kept for {retentionDays || 30} days.
                    </p>
                </div>
                <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
                    <RefreshCw size={14} aria-hidden="true" /> Refresh runs
                </Button>
            </div>

            {error && (
                <div className="mt-ds-2">
                    <FieldMessage tone="error">{error}</FieldMessage>
                </div>
            )}

            {unavailable && !error && (
                <div className="mt-ds-2">
                    {/* Distinguished from "no runs yet", which an empty list would
                        otherwise be read as — and which is a very different fact.
                        `error` rather than a softer tone because it *is* a failed
                        read; `FieldMessage` supports help, error and success, and
                        inventing a fourth tone is not this change's business. */}
                    <FieldMessage tone="error">
                        The run ledger could not be read, so this list is not evidence that no runs
                        happened.
                    </FieldMessage>
                </div>
            )}

            <div className="mt-ds-3 flex flex-wrap items-end gap-ds-2">
                <label className="flex flex-col gap-ds-1 text-ds-xs text-ds-content-secondary">
                    Pipeline stage
                    <select
                        className="rounded border border-ds-border bg-ds-surface px-ds-2 py-ds-1 text-ds-sm text-ds-content"
                        value={stageFilter}
                        onChange={(event) => setStageFilter(event.target.value)}
                    >
                        <option value="all">Every stage</option>
                        {availableStages.map((stage) => (
                            <option key={stage.id} value={stage.id}>{stage.label}</option>
                        ))}
                    </select>
                </label>

                <label className="flex items-center gap-ds-1 text-ds-sm text-ds-content-secondary">
                    <input
                        type="checkbox"
                        checked={showPublished}
                        onChange={(event) => setShowPublished(event.target.checked)}
                    />
                    Include published runs
                </label>
            </div>

            {truncated && (
                <p className="mt-ds-2 text-ds-xs text-ds-content-secondary">
                    Showing the most recent page of runs, not everything retained.
                </p>
            )}

            {visible.length === 0 ? (
                <p className="mt-ds-3 text-ds-sm text-ds-content-secondary">
                    {(runs || []).length === 0
                        ? 'No publication runs have been recorded yet.'
                        : 'No runs match this filter.'}
                </p>
            ) : (
                <Stack gap="sm" className="mt-ds-3">
                    <ul className="space-y-ds-2" aria-label="Publication runs">
                        {visible.map((run) => {
                            const outcome = describeRunOutcome(run.outcome);
                            const verdict = describeVerdict(run);
                            return (
                                <li key={run.id} className="border-t border-ds-border pt-ds-2 first:border-0 first:pt-0">
                                    <div className="flex flex-wrap items-center gap-ds-2 text-ds-sm">
                                        <Badge tone={outcome.tone}>{outcome.label}</Badge>
                                        <span className="font-medium text-ds-content">
                                            {run.publicationDate} · {run.themeId}
                                        </span>
                                        <span className="text-ds-xs text-ds-content-secondary">
                                            {describeStage(run.stage)}
                                        </span>
                                        {run.trigger === 'manual' && (
                                            <Badge tone="neutral">Manual check</Badge>
                                        )}
                                    </div>
                                    {run.detail && (
                                        <p className="mt-1 text-ds-xs text-ds-content-secondary">{run.detail}</p>
                                    )}
                                    {verdict && (
                                        <p className="mt-1 text-ds-xs text-ds-content-secondary">{verdict}</p>
                                    )}
                                    {(run.generationTransactionId || run.verificationTransactionId) && (
                                        // The join key. Without it a refused slot and the provider
                                        // timeline that produced it could not be connected at all.
                                        <p className="mt-1 text-ds-xs text-ds-content-secondary">
                                            {run.generationTransactionId && `generation ${run.generationTransactionId}`}
                                            {run.generationTransactionId && run.verificationTransactionId && ' · '}
                                            {run.verificationTransactionId && `fact-check ${run.verificationTransactionId}`}
                                        </p>
                                    )}
                                    {run.at && (
                                        <p className="mt-1 text-ds-xs text-ds-content-secondary">
                                            {new Date(run.at).toLocaleString()}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </Stack>
            )}
        </Card>
    );
}

export default BlogRunLedger;
