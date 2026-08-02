import React from 'react';
import {
    FileSignature, ArrowRight, CheckCircle2, Circle, AlertTriangle, RotateCcw,
} from 'lucide-react';
import { Badge, Button, Card } from '@/design-system/components';
import { DOC_STATUS } from './postApplyDocsStorage';

/**
 * Post-submission document checklist. Required templates are presented as a
 * blocking "Required Documents" list with a visible per-document status;
 * optional templates render in a separate low-emphasis section.
 *
 * Presentation is migrated to the approved `Card` / `Button` / `Badge`
 * primitives and `--ds-*` tokens. The feature keeps the domain decisions: which
 * `DOC_STATUS` maps to which tone/icon/label, the `required !== false` rule, the
 * `data-testid` contract (`required-documents-section`,
 * `required-documents-progress`, `post-apply-doc-<templateId>`), the exact
 * "<n> of <m> completed" text, the disabled-when-completed rule that prevents
 * duplicate signing requests, and every frozen string asserted by
 * `e2e/guest-post-application-edoc.spec.cjs`.
 *
 * DEFECTS FIXED (2026-07-27):
 * - Status pills used `text-[10px]` and the progress line `text-[11px]`, both
 *   below the 12 px interface-text floor the design standard sets.
 * - Progress changes were silent; `role="status"` now announces "1 of 2
 *   completed" as documents are signed.
 * - The row action was a full-width `<button>` wrapping the status pill, so its
 *   accessible name was "<title> Not started" and the retry control sat *inside*
 *   another control's hit area. The action is now a named `Button` beside the
 *   status, never nested.
 */

const STATUS_META = {
    [DOC_STATUS.NOT_STARTED]: { label: 'Not started', tone: 'neutral' },
    [DOC_STATUS.OPENING]: { label: 'Opening…', tone: 'info' },
    [DOC_STATUS.IN_PROGRESS]: { label: 'In progress', tone: 'warning' },
    [DOC_STATUS.COMPLETED]: { label: 'Completed', tone: 'success' },
    [DOC_STATUS.ERROR]: { label: 'Error', tone: 'danger' },
};

function DocumentRow({ template, docState, openingTemplateId, onOpen }) {
    const status = docState?.status || DOC_STATUS.NOT_STARTED;
    const meta = STATUS_META[status] || STATUS_META[DOC_STATUS.NOT_STARTED];
    const isCompleted = status === DOC_STATUS.COMPLETED;
    const isOpening = openingTemplateId === template.templateId || status === DOC_STATUS.OPENING;
    const isError = status === DOC_STATUS.ERROR;
    const title = template.title || 'Complete Form';

    return (
        <div
            className={`w-full rounded-ds-md border px-ds-3 py-ds-2 ${
                isCompleted
                    ? 'border-ds-status-success-border bg-ds-status-success-bg'
                    : 'border-ds-status-info-border bg-ds-surface'
            }`}
            data-testid={`post-apply-doc-${template.templateId}`}
        >
            <div className="flex items-center justify-between gap-ds-2">
                <span className="flex min-w-0 items-center gap-ds-2">
                    {/* Icon + text + badge: status is never carried by colour alone. */}
                    {isCompleted ? (
                        <CheckCircle2 size={16} className="shrink-0 text-ds-status-success-fg" aria-hidden="true" />
                    ) : isError ? (
                        <AlertTriangle size={16} className="shrink-0 text-ds-status-danger-fg" aria-hidden="true" />
                    ) : (
                        <Circle size={16} className="shrink-0 text-ds-content-muted" aria-hidden="true" />
                    )}
                    <span className="truncate text-ds-sm font-medium text-ds-content">{title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-ds-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    <Button
                        variant="ghost"
                        size="md"
                        onClick={() => onOpen(template)}
                        disabled={isOpening || isCompleted}
                        loading={isOpening}
                        aria-label={`Open ${title}`}
                    >
                        {isOpening ? null : isCompleted ? (
                            <CheckCircle2 size={16} aria-hidden="true" />
                        ) : (
                            <ArrowRight size={16} aria-hidden="true" />
                        )}
                    </Button>
                </span>
            </div>
            {isError && (
                <div className="mt-ds-2 flex items-start justify-between gap-ds-2 text-ds-xs text-ds-status-danger-fg">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                        {docState?.error || 'Could not open this document.'}
                    </span>
                    <Button variant="ghost" size="md" onClick={() => onOpen(template)}>
                        <RotateCcw size={12} aria-hidden="true" /> Retry
                    </Button>
                </div>
            )}
        </div>
    );
}

export function RequiredDocumentsChecklist({
    templates,
    docStates,
    openingTemplateId,
    onOpenTemplate,
}) {
    const requiredTemplates = templates.filter((t) => t.required !== false);
    const optionalTemplates = templates.filter((t) => t.required === false);

    const completedRequired = requiredTemplates.filter(
        (t) => docStates?.[t.templateId]?.status === DOC_STATUS.COMPLETED
    ).length;
    const allRequiredComplete =
        requiredTemplates.length > 0 && completedRequired === requiredTemplates.length;

    return (
        <div className="space-y-ds-4 text-left">
            {requiredTemplates.length > 0 && (
                <Card
                    padding="md"
                    className={
                        allRequiredComplete
                            ? 'border-ds-status-success-border bg-ds-status-success-bg'
                            : 'border-ds-status-info-border bg-ds-status-info-bg'
                    }
                    data-testid="required-documents-section"
                >
                    <div className="mb-ds-1 flex items-start gap-ds-2">
                        <FileSignature
                            size={18}
                            aria-hidden="true"
                            className={`mt-ds-1 shrink-0 ${allRequiredComplete ? 'text-ds-status-success-fg' : 'text-ds-status-info-fg'}`}
                        />
                        <div className="min-w-0">
                            <h2 className={`text-ds-sm font-bold ${allRequiredComplete ? 'text-ds-status-success-fg' : 'text-ds-status-info-fg'}`}>
                                Required Documents
                            </h2>
                            <p className={`text-ds-xs ${allRequiredComplete ? 'text-ds-status-success-fg' : 'text-ds-status-info-fg'}`}>
                                {allRequiredComplete
                                    ? 'All required documents are completed. You are all set!'
                                    : 'Your application was submitted successfully, but these documents still need to be completed before your file is finished.'}
                            </p>
                        </div>
                    </div>
                    <p
                        role="status"
                        className="mb-ds-2 mt-ds-2 text-ds-xs font-semibold text-ds-status-info-fg"
                        data-testid="required-documents-progress"
                    >
                        {completedRequired} of {requiredTemplates.length} completed
                    </p>
                    <div className="space-y-ds-2">
                        {requiredTemplates.map((template) => (
                            <DocumentRow
                                key={template.templateId}
                                template={template}
                                docState={docStates?.[template.templateId]}
                                openingTemplateId={openingTemplateId}
                                onOpen={onOpenTemplate}
                            />
                        ))}
                    </div>
                </Card>
            )}

            {optionalTemplates.length > 0 && (
                <Card padding="md" className="border-ds-border-subtle bg-ds-surface-subtle">
                    <h2 className="mb-ds-1 text-ds-sm font-bold text-ds-content-secondary">Optional forms</h2>
                    <p className="mb-ds-2 text-ds-xs text-ds-content-secondary">
                        You can complete these now, or skip and do them later.
                    </p>
                    <div className="space-y-ds-2">
                        {optionalTemplates.map((template) => (
                            <DocumentRow
                                key={template.templateId}
                                template={template}
                                docState={docStates?.[template.templateId]}
                                openingTemplateId={openingTemplateId}
                                onOpen={onOpenTemplate}
                            />
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
}
