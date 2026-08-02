import React, { useId, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Modal } from '@shared/components/modals/Modal';
import { Button, ChoiceGroup, IconButton, Radio } from '@/design-system/components';
import { Stack } from '@/design-system/layouts';
import { parsePageRange } from '@features/signing/utils/pageRange';

/**
 * AI Field Assistant — scan setup.
 *
 * The scan is never implicit: this dialog exists so the operator chooses the
 * pages, reads what leaves the browser, and starts the scan deliberately. It
 * performs no I/O; `onStart` is the only way anything happens.
 */

export function AiScanOptionsDialog({ activePage, numPages, onClose, onStart }) {
    const rawId = useId().replace(/:/g, '');
    const titleId = `ai-scan-title-${rawId}`;
    const descriptionId = `ai-scan-description-${rawId}`;
    const rangeId = `ai-scan-range-${rawId}`;
    const rangeHelpId = `ai-scan-range-help-${rawId}`;
    const startRef = useRef(null);

    const [scope, setScope] = useState('current');
    const [rangeText, setRangeText] = useState('');

    const selectedPages = parsePageRange(rangeText, numPages);
    const rangeInvalid = scope === 'selected' && selectedPages.length === 0;

    return (
        <Modal
            onClose={onClose}
            labelledBy={titleId}
            describedBy={descriptionId}
            initialFocusRef={startRef}
            className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-ds-xl border border-ds-border bg-ds-surface shadow-ds-lg"
        >
            <div className="flex items-start justify-between gap-ds-4 border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-5">
                <div className="min-w-0">
                    <h2 id={titleId} className="flex items-center gap-ds-2 text-ds-heading-sm font-bold text-ds-content">
                        <Sparkles size={18} className="text-ds-status-accent-fg" aria-hidden="true" />
                        AI Field Assistant
                    </h2>
                    <p id={descriptionId} className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                        AI will scan your PDF and suggest signature, initials, dates, checkboxes and text
                        fields. Review all suggestions before applying them.
                    </p>
                </div>
                <IconButton label="Close" variant="ghost" onClick={onClose}>
                    <X size={20} aria-hidden="true" />
                </IconButton>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-ds-5">
                <Stack gap="md">
                    <ChoiceGroup legend="Pages to scan">
                        <Radio
                            name={`ai-scan-scope-${rawId}`}
                            label={`Current page (page ${activePage})`}
                            value="current"
                            checked={scope === 'current'}
                            onChange={() => setScope('current')}
                        />
                        <Radio
                            name={`ai-scan-scope-${rawId}`}
                            label="Selected pages"
                            value="selected"
                            checked={scope === 'selected'}
                            onChange={() => setScope('selected')}
                        />
                        <Radio
                            name={`ai-scan-scope-${rawId}`}
                            label={`All pages (${numPages || 1})`}
                            value="all"
                            checked={scope === 'all'}
                            onChange={() => setScope('all')}
                        />
                    </ChoiceGroup>

                    {scope === 'selected' && (
                        <div>
                            <label
                                htmlFor={rangeId}
                                className="mb-ds-1 block text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary"
                            >
                                Page numbers
                            </label>
                            <input
                                id={rangeId}
                                type="text"
                                inputMode="numeric"
                                value={rangeText}
                                onChange={(event) => setRangeText(event.target.value)}
                                aria-describedby={rangeHelpId}
                                aria-invalid={rangeInvalid || undefined}
                                placeholder="1, 3, 5-8"
                                className="min-h-11 w-full rounded-ds-md border border-ds-border bg-ds-surface px-ds-3 text-ds-sm text-ds-content focus-visible:outline-none focus-visible:shadow-ds-focus"
                            />
                            <p id={rangeHelpId} className="mt-ds-1 text-ds-xs text-ds-content-secondary">
                                {selectedPages.length > 0
                                    ? `${selectedPages.length} page${selectedPages.length === 1 ? '' : 's'} selected.`
                                    : 'Enter page numbers or ranges, for example 1, 3, 5-8.'}
                            </p>
                        </div>
                    )}

                    {/* Explicit, plain-language disclosure. This is the only place the
                        operator is told what leaves the browser, so it is never hidden
                        behind a tooltip or a details toggle. */}
                    <div className="rounded-ds-lg border border-ds-status-info-border bg-ds-status-info-bg p-ds-3">
                        <h3 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content">
                            What gets sent
                        </h3>
                        <p className="mt-ds-1 text-ds-xs leading-snug text-ds-content-secondary">
                            Images of the pages you choose are rendered in your browser and sent to the
                            configured AI provider for analysis. Nothing is saved or sent to the recipient,
                            no template is changed, and the rendered images are not stored after the scan.
                            Suggestions are placed for your review only — you decide what gets applied.
                        </p>
                    </div>
                </Stack>
            </div>

            <div className="flex flex-wrap justify-end gap-ds-2 border-t border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button
                    ref={startRef}
                    variant="primary"
                    disabled={rangeInvalid}
                    onClick={() => onStart({ scope, selectedPages })}
                >
                    <Sparkles size={16} aria-hidden="true" />
                    Scan pages
                </Button>
            </div>
        </Modal>
    );
}

export default AiScanOptionsDialog;
