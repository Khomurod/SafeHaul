import React from 'react';
import { Check, Icon } from '@design-system/icons';

/** The three steps of a bulk upload, by the step id the parent tracks. Frozen. */
const STEPS = [
    { id: 'upload', label: 'Upload' },
    { id: 'preview', label: 'Preview' },
    { id: 'success', label: 'Finish' },
];

/**
 * Where a bulk upload is: Upload, Preview, Finish. Read, not operated — a
 * list, not tabs or buttons.
 *
 * `BulkUploadLayout` draws it at the top of its dialog; a page that holds the
 * upload in place (`ImportLeadsPage`) draws it in its header instead, beside
 * the title, with the step the upload reports (`CompanyBulkUpload`'s
 * `onStepChange`).
 *
 * The current step is filled in the brand colour with its label in semibold,
 * a step already done is filled with a check, a step still to come is an
 * outline, and every step says which of the three it is to a screen reader
 * ("current step", "completed", "not started") — colour is never the only
 * signal. The connectors are 32px where the list is as wide as its content;
 * where it is stretched (a phone's full-width row) they share the extra width,
 * so the last step ends at the row's edge.
 */
export function BulkUploadSteps({ step, className = '' }) {
    const currentIndex = STEPS.findIndex((s) => s.id === step);

    return (
        <ol aria-label="Import steps" className={`m-0 flex min-w-0 items-center gap-ds-2 p-0 ${className}`.trim()}>
            {STEPS.map((s, index) => {
                const isComplete = index < currentIndex;
                const isCurrent = index === currentIndex;
                return (
                    <li
                        key={s.id}
                        className={`flex items-center gap-ds-2 whitespace-nowrap ${index > 0 ? 'min-w-0 flex-auto' : ''}`.trim()}
                        aria-current={isCurrent ? 'step' : undefined}
                    >
                        {index > 0 && (
                            <span
                                aria-hidden="true"
                                className={`h-px w-ds-8 min-w-ds-3 flex-auto ${index <= currentIndex
                                    ? 'bg-ds-brand-primary'
                                    : 'bg-ds-border'}`}
                            />
                        )}
                        <span
                            aria-hidden="true"
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-ds-full border text-ds-xs font-semibold ${isComplete || isCurrent
                                ? 'border-ds-brand-primary bg-ds-brand-primary text-ds-content-inverse'
                                : 'border-ds-border bg-ds-surface text-ds-content-secondary'}`}
                        >
                            {isComplete ? <Icon icon={Check} size="sm" /> : index + 1}
                        </span>
                        <span
                            className={`text-ds-body ${isCurrent
                                ? 'font-semibold text-ds-brand-primary'
                                : 'text-ds-content-secondary'}`}
                        >
                            {s.label}
                        </span>
                        <span className="sr-only">
                            {isComplete ? ' completed' : isCurrent ? ' current step' : ' not started'}
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}

export default BulkUploadSteps;
