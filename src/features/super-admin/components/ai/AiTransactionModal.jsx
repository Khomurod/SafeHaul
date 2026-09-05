import React, { useId } from 'react';
import { ArrowRight } from 'lucide-react';

import { Badge, Button, FieldDisplay } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { Modal } from '@design-system/patterns';

import {
    describeAttempt,
    describeCategory,
    describeOutcome,
    describeTaskType,
    formatDuration,
} from './aiTelemetryPresentation';

/**
 * One AI transaction, expanded into the provider-by-provider timeline.
 *
 * This is the view the platform could not previously produce at all. Telemetry
 * recorded a single row per request, so "CDL extraction failed" was the whole
 * story — which provider was tried, in what order, and why each declined
 * existed only inside an error string an operator never saw.
 *
 * Built on the approved `Modal` rather than an inline expander: the design system
 * has no disclosure primitive, and `Modal` already owns focus trapping, focus
 * restoration and Escape handling. A log detail view is exactly the kind of
 * thing that is easy to get wrong for keyboard users, and this borrows a
 * solution that is already proven here.
 *
 * Everything rendered is metadata. There is no prompt, no response, no image and
 * no extracted field in a transaction record to render — by construction, in
 * `functions/ai/telemetry/record.js`, not by omission here.
 */
export function AiTransactionModal({ entry, onClose }) {
    const headingId = useId();
    const outcome = describeOutcome(entry);
    const attempts = entry.attempts || [];

    return (
        <Modal
            labelledBy={headingId}
            onClose={onClose}
            size="2xl"
        >
            <div className="flex max-h-[85vh] flex-col">
                <header className="border-b border-ds-border-subtle p-ds-5">
                    <h2 id={headingId} className="text-ds-heading-sm font-bold text-ds-content">
                        {describeTaskType(entry.taskType)}
                    </h2>
                    <p className="mt-ds-1 text-ds-sm text-ds-content-secondary">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Time unknown'}
                        {' · '}
                        {formatDuration(entry.latencyMs)}
                    </p>
                </header>

                <div className="flex-1 overflow-y-auto p-ds-5">
                    <Stack gap="md">
                        <div className="grid grid-cols-1 gap-ds-3 sm:grid-cols-2">
                            <FieldDisplay label="Outcome">
                                <span className="flex flex-wrap items-center gap-ds-2">
                                    <Badge tone={outcome.tone}>{outcome.label}</Badge>
                                    {outcome.detail && (
                                        <span className="text-ds-sm text-ds-content-secondary">{outcome.detail}</span>
                                    )}
                                </span>
                            </FieldDisplay>
                            <FieldDisplay label="Served by">
                                {entry.providerId || '—'}
                                {entry.model ? ` · ${entry.model}` : ''}
                            </FieldDisplay>
                            <FieldDisplay label="Capabilities required">
                                {(entry.requiredCapabilities || []).join(', ') || '—'}
                            </FieldDisplay>
                            <FieldDisplay label="Request">
                                {/* Shape, never content — see describeTaskInput. */}
                                {entry.inputSummary || '—'}
                            </FieldDisplay>
                        </div>

                        <section aria-labelledby={`${headingId}-timeline`}>
                            <h3
                                id={`${headingId}-timeline`}
                                className="mb-ds-2 text-ds-sm font-bold text-ds-content"
                            >
                                Provider timeline
                            </h3>

                            {attempts.length === 0 ? (
                                <p className="text-ds-sm text-ds-content-secondary">
                                    No provider was reached for this request.
                                </p>
                            ) : (
                                <ol className="space-y-ds-2">
                                    {attempts.map((attempt, index) => {
                                        const state = describeAttempt(attempt);
                                        return (
                                            <li
                                                key={`${attempt.providerId}-${index}`}
                                                className="rounded-ds-md border border-ds-border-subtle bg-ds-surface-subtle p-ds-3"
                                            >
                                                <div className="flex flex-wrap items-center gap-ds-2">
                                                    <span className="text-ds-sm font-bold text-ds-content">
                                                        {index + 1}. {attempt.providerId}
                                                    </span>
                                                    <Badge tone={state.tone}>{state.label}</Badge>
                                                    {state.detail && (
                                                        <span className="text-ds-sm text-ds-content-secondary">
                                                            {state.detail}
                                                        </span>
                                                    )}
                                                </div>

                                                <dl className="mt-ds-2 flex flex-wrap gap-x-ds-4 gap-y-ds-1 text-ds-xs text-ds-content-secondary">
                                                    {attempt.model && <MetaItem term="Model" value={attempt.model} />}
                                                    {Number.isFinite(attempt.latencyMs) && (
                                                        <MetaItem term="Took" value={formatDuration(attempt.latencyMs)} />
                                                    )}
                                                    {Number.isFinite(attempt.httpStatus) && (
                                                        <MetaItem term="HTTP" value={String(attempt.httpStatus)} />
                                                    )}
                                                    {attempt.vendorCode && (
                                                        <MetaItem term="Vendor code" value={attempt.vendorCode} />
                                                    )}
                                                    {Number.isFinite(attempt.retryAfterMs) && (
                                                        <MetaItem
                                                            term="Vendor asked to wait"
                                                            value={formatDuration(attempt.retryAfterMs)}
                                                        />
                                                    )}
                                                    {attempt.schemaValid === false && (
                                                        <MetaItem term="SafeHaul validation" value="failed" />
                                                    )}
                                                    {attempt.schemaValid === true && (
                                                        <MetaItem term="SafeHaul validation" value="passed" />
                                                    )}
                                                    {Number.isFinite(attempt.inputTokens) && (
                                                        <MetaItem
                                                            term="Tokens"
                                                            value={`${attempt.inputTokens} in / ${attempt.outputTokens ?? '—'} out`}
                                                        />
                                                    )}
                                                </dl>

                                                {attempt.nextProviderId && (
                                                    <p className="mt-ds-2 flex items-center gap-ds-1 text-ds-xs text-ds-content-secondary">
                                                        <ArrowRight size={12} aria-hidden="true" />
                                                        Fell back to {attempt.nextProviderId}
                                                    </p>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ol>
                            )}
                        </section>

                        <FieldDisplay label="Final result" emphasis="strong">
                            {entry.outcome === 'success'
                                ? `Success via ${entry.providerId}`
                                : `Failed — ${describeCategory(entry.category)}`}
                        </FieldDisplay>

                        {/* The correlation id, so a Cloud Logging line and this
                            row can be matched up by an engineer. */}
                        {entry.transactionId && (
                            <FieldDisplay label="Transaction ID">
                                <code className="text-ds-xs">{entry.transactionId}</code>
                            </FieldDisplay>
                        )}
                    </Stack>
                </div>

                <footer className="flex justify-end border-t border-ds-border-subtle p-ds-4">
                    <Button variant="secondary" onClick={onClose}>Close</Button>
                </footer>
            </div>
        </Modal>
    );
}

function MetaItem({ term, value }) {
    return (
        <span className="flex gap-ds-1">
            <dt className="font-bold">{term}:</dt>
            <dd>{value}</dd>
        </span>
    );
}
