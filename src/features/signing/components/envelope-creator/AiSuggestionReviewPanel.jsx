import React, { useId } from 'react';
import { AlertTriangle, Check, RotateCcw, Sparkles, Undo2, X } from 'lucide-react';
import { Badge, Button, Checkbox, FormField, Input, ProgressBar, Select } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import {
    HIGH_CONFIDENCE_THRESHOLD,
    SEMANTIC_CATEGORIES,
    SEMANTIC_FIELD_MAP,
    SUPPORTED_BINDING_KEYS,
    selectHighConfidence,
} from '@features/signing/utils/aiFieldSuggestions';
import { BINDING_LABELS } from '@features/signing/utils/prefillEngine';
import { groupFieldsByPage } from '@features/signing/utils/fieldGeometry';
import { MAX_SCAN_PAGES } from '@features/signing/hooks/useAiFieldAssistant';

/**
 * AI Field Assistant — review rail.
 *
 * Presentation + local review interaction only. It never saves a template,
 * never sends a document, and never writes to Firestore: the only way a
 * suggestion becomes a real field is the caller's `onApply`, driven by an
 * explicit button here.
 *
 * Actions are visible buttons rather than a menu, matching the rest of the
 * E-Docs surfaces (no approved menu primitive exists yet).
 */

const PHASE_LABEL = {
    inspecting: 'Reading the PDF structure…',
    rendering: 'Rendering pages…',
    analyzing: 'Analysing pages…',
    done: 'Scan complete',
};

const confidenceTone = (confidence) => {
    if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return 'success';
    if (confidence >= 0.5) return 'warning';
    return 'danger';
};

export function AiSuggestionReviewPanel({
    status,
    progress,
    suggestions,
    manualReview,
    stats,
    error,
    partial = false,
    truncatedPages = 0,
    selectedSuggestionId,
    onSelectSuggestion,
    onUpdateSuggestion,
    onToggleAccepted,
    onApplySelected,
    onApplyHighConfidence,
    onDiscardAll,
    onRescan,
    onUndo,
    canUndo,
    onCancel,
    onClose,
}) {
    const rawId = useId().replace(/:/g, '');
    const headingId = `ai-review-heading-${rawId}`;

    const acceptedCount = suggestions.filter((item) => item.status === 'accepted').length;
    const highConfidenceCount = selectHighConfidence(suggestions).length;
    const isScanning = status === 'scanning';
    const total = progress?.total || 0;
    const completed = progress?.completed || 0;

    return (
        <section
            aria-labelledby={headingId}
            className="flex h-full flex-col overflow-hidden bg-ds-surface"
        >
            <header className="flex items-start justify-between gap-ds-2 border-b border-ds-border-subtle p-ds-4">
                <div className="min-w-0">
                    <h3 id={headingId} className="flex items-center gap-ds-2 text-ds-body font-bold text-ds-content">
                        <Sparkles size={16} className="text-ds-status-accent-fg" aria-hidden="true" />
                        AI Field Assistant
                    </h3>
                    <p className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                        Suggestions are not part of your document until you apply them.
                    </p>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-4">
                <Stack gap="md">
                    {isScanning && (
                        <div>
                            <ProgressBar
                                label="AI field scan progress"
                                value={total > 0 ? completed : 0}
                                max={total > 0 ? total : 1}
                                valueText={
                                    total > 0
                                        ? `${completed} of ${total} pages`
                                        : 'Preparing scan'
                                }
                            />
                            <p role="status" className="mt-ds-2 text-ds-xs text-ds-content-secondary">
                                {PHASE_LABEL[progress?.phase] || 'Scanning…'}
                                {total > 0 ? ` ${completed} of ${total} pages.` : ''}
                            </p>
                            <Button variant="secondary" size="sm" className="mt-ds-2" onClick={onCancel}>
                                Cancel scan
                            </Button>
                        </div>
                    )}

                    {status === 'cancelled' && (
                        <p role="status" className="text-ds-sm text-ds-content-secondary">
                            Scan cancelled. Nothing was changed.
                        </p>
                    )}

                    {truncatedPages > 0 && (
                        <p className="rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-3 text-ds-xs text-ds-content-secondary">
                            One scan covers at most {MAX_SCAN_PAGES} pages, so {truncatedPages} page
                            {truncatedPages === 1 ? '' : 's'} you selected {truncatedPages === 1 ? 'was' : 'were'}{' '}
                            left out. Scan the rest in a second pass.
                        </p>
                    )}

                    {error && (
                        <div
                            role="alert"
                            className="rounded-ds-lg border border-ds-status-danger-border bg-ds-status-danger-bg p-ds-3"
                        >
                            <p className="text-ds-sm text-ds-status-danger-fg">{error}</p>
                            {partial && (
                                <p className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                                    The pages that were analysed before this happened are still listed below —
                                    you can review and apply them, then rescan the rest.
                                </p>
                            )}
                            <Button variant="secondary" size="sm" className="mt-ds-2" onClick={onRescan}>
                                <RotateCcw size={14} aria-hidden="true" /> Try again
                            </Button>
                        </div>
                    )}

                    {manualReview.length > 0 && (
                        <div className="rounded-ds-lg border border-ds-status-warning-border bg-ds-status-warning-bg p-ds-3">
                            <h4 className="flex items-center gap-ds-2 text-ds-xs font-bold uppercase tracking-wide text-ds-content">
                                <AlertTriangle size={14} aria-hidden="true" />
                                Needs manual placement
                            </h4>
                            <ul className="mt-ds-2 flex flex-col gap-ds-2">
                                {manualReview.map((entry) => (
                                    <li key={`${entry.page}-${entry.kind}`} className="text-ds-xs text-ds-content-secondary">
                                        <span className="font-bold text-ds-content">
                                            {entry.page ? `Page ${entry.page}: ` : ''}
                                            {entry.detail || entry.kind}
                                        </span>
                                        <span className="block">{entry.message}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {status === 'ready' && suggestions.length === 0 && (
                        <p className="rounded-ds-lg border-2 border-dashed border-ds-border p-ds-4 text-center text-ds-sm text-ds-content-secondary">
                            No fields were suggested for the pages you scanned. Place fields from the palette,
                            or rescan a different page range.
                        </p>
                    )}

                    {suggestions.length > 0 && (
                        <>
                            <p className="text-ds-xs text-ds-content-secondary">
                                {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'}
                                {stats?.rejected ? `, ${stats.rejected} discarded as unusable` : ''}
                                {stats?.duplicates ? `, ${stats.duplicates} duplicate removed` : ''}.
                            </p>

                            {/* Grouped by page and compact by default: a long scan is a
                                list you can skim, not a wall of forms. The editing
                                controls belong to the one suggestion you are looking
                                at, which is also the one highlighted on the PDF. */}
                            {groupFieldsByPage(suggestions).map(({ page, fields: pageSuggestions }) => {
                                const groupId = `ai-page-group-${rawId}-${page}`;
                                return (
                                    <div key={page}>
                                        <h4
                                            id={groupId}
                                            className="mb-ds-1 text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary"
                                        >
                                            Page {page} · {pageSuggestions.length} suggestion
                                            {pageSuggestions.length === 1 ? '' : 's'}
                                        </h4>
                                        <ul aria-labelledby={groupId} className="flex flex-col gap-ds-1">
                                            {pageSuggestions.map((item) => {
                                                const controlId = `ai-suggestion-${item.suggestionId}`;
                                                const detailId = `${controlId}-detail`;
                                                const isSelected = selectedSuggestionId === item.suggestionId;
                                                const isAccepted = item.status === 'accepted';
                                                return (
                                                    <li
                                                        key={item.suggestionId}
                                                        className={`rounded-ds-lg border p-ds-2 ${
                                                            isSelected
                                                                ? 'border-ds-action-primary bg-ds-status-info-bg'
                                                                : 'border-ds-border bg-ds-surface-subtle'
                                                        }`}
                                                    >
                                                        <div className="flex items-center gap-ds-2">
                                                            <Checkbox
                                                                id={`${controlId}-accept`}
                                                                label={`Apply ${item.label}`}
                                                                labelHidden
                                                                checked={isAccepted}
                                                                onChange={() => onToggleAccepted(item.suggestionId)}
                                                            />
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                fullWidth
                                                                justify="start"
                                                                aria-expanded={isSelected}
                                                                aria-controls={detailId}
                                                                className="min-w-0 flex-1"
                                                                onClick={() =>
                                                                    onSelectSuggestion(isSelected ? null : item.suggestionId)
                                                                }
                                                            >
                                                                <span className="truncate font-bold text-ds-content">
                                                                    {item.label}
                                                                </span>
                                                                <Badge tone="neutral">{item.type}</Badge>
                                                                <Badge tone={confidenceTone(item.confidence)}>
                                                                    {Math.round(item.confidence * 100)}%
                                                                </Badge>
                                                                <Badge tone={isAccepted ? 'success' : 'neutral'}>
                                                                    {isAccepted ? 'Accepted' : 'Pending'}
                                                                </Badge>
                                                                {item.overlapsFieldId && (
                                                                    <>
                                                                        <AlertTriangle
                                                                            size={12}
                                                                            aria-hidden="true"
                                                                            className="shrink-0 text-ds-status-warning-fg"
                                                                        />
                                                                        <span className="ds-visually-hidden">
                                                                            overlaps an existing field
                                                                        </span>
                                                                    </>
                                                                )}
                                                            </Button>
                                                        </div>

                                                        {isSelected && (
                                                            <div id={detailId} className="mt-ds-2">
                                                                <p className="flex flex-wrap items-center gap-ds-1 text-ds-xs text-ds-content-secondary">
                                                                    <span>
                                                                        {Math.round(item.x)}%, {Math.round(item.y)}% ·{' '}
                                                                        {Math.round(item.width)}×{Math.round(item.height)}%
                                                                    </span>
                                                                </p>

                                                                {item.overlapsFieldId && (
                                                                    <p className="mt-ds-2 flex items-start gap-ds-1 text-ds-xs text-ds-status-warning-fg">
                                                                        <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                                                                        Overlaps your existing field “{item.overlapsFieldLabel}”. Applying it
                                                                        adds a second field on top; your field is never replaced.
                                                                    </p>
                                                                )}

                                                                <div className="mt-ds-2 grid grid-cols-1 gap-ds-2">
                                                                    <FormField id={`${controlId}-label`} label="Label">
                                                                        <Input
                                                                            type="text"
                                                                            value={item.label}
                                                                            onChange={(event) =>
                                                                                onUpdateSuggestion(item.suggestionId, { label: event.target.value })
                                                                            }
                                                                            onFocus={() => onSelectSuggestion(item.suggestionId)}
                                                                        />
                                                                    </FormField>

                                                                    <FormField id={`${controlId}-type`} label="Field type">
                                                                        <Select
                                                                            value={item.category}
                                                                            onChange={(event) =>
                                                                                onUpdateSuggestion(item.suggestionId, {
                                                                                    category: event.target.value,
                                                                                    // Re-derive the binding from the new category
                                                                                    // unless the reviewer overrides it below.
                                                                                    bindingKey: SEMANTIC_FIELD_MAP[event.target.value]?.bindingKey ?? '',
                                                                                })
                                                                            }
                                                                        >
                                                                            {SEMANTIC_CATEGORIES.map((category) => (
                                                                                <option key={category} value={category}>
                                                                                    {SEMANTIC_FIELD_MAP[category].label} ({SEMANTIC_FIELD_MAP[category].type})
                                                                                </option>
                                                                            ))}
                                                                        </Select>
                                                                    </FormField>

                                                                    <FormField id={`${controlId}-binding`} label="Prefill binding">
                                                                        <Select
                                                                            value={item.bindingKey}
                                                                            onChange={(event) =>
                                                                                onUpdateSuggestion(item.suggestionId, { bindingKey: event.target.value })
                                                                            }
                                                                        >
                                                                            {SUPPORTED_BINDING_KEYS.map((key) => (
                                                                                <option key={key || 'none'} value={key}>
                                                                                    {key ? BINDING_LABELS[key] || key : 'No prefill'}
                                                                                </option>
                                                                            ))}
                                                                        </Select>
                                                                    </FormField>

                                                                    <Checkbox
                                                                        id={`${controlId}-required`}
                                                                        label="Required"
                                                                        checked={item.required}
                                                                        onChange={() =>
                                                                            onUpdateSuggestion(item.suggestionId, { required: !item.required })
                                                                        }
                                                                    />
                                                                </div>
                                                            </div>
                                                        )}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </Stack>
            </div>

            {(suggestions.length > 0 || canUndo) && (
                <footer className="flex flex-col gap-ds-2 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                    <Button
                        variant="primary"
                        fullWidth
                        disabled={acceptedCount === 0}
                        onClick={onApplySelected}
                    >
                        <Check size={16} aria-hidden="true" />
                        Apply selected ({acceptedCount})
                    </Button>
                    <Button
                        fullWidth
                        disabled={highConfidenceCount === 0}
                        onClick={onApplyHighConfidence}
                    >
                        Apply high-confidence ({highConfidenceCount})
                    </Button>
                    <div className="grid grid-cols-2 gap-ds-2">
                        <Button variant="secondary" onClick={onRescan}>
                            <RotateCcw size={14} aria-hidden="true" /> Rescan
                        </Button>
                        <Button
                            variant="secondary"
                            disabled={!canUndo}
                            onClick={onUndo}
                        >
                            <Undo2 size={14} aria-hidden="true" /> Undo apply
                        </Button>
                    </div>
                    <Button variant="ghost" fullWidth disabled={suggestions.length === 0} onClick={onDiscardAll}>
                        <X size={14} aria-hidden="true" /> Discard all suggestions
                    </Button>
                </footer>
            )}
        </section>
    );
}

export default AiSuggestionReviewPanel;
