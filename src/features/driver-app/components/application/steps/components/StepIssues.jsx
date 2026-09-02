import React, { forwardRef } from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';

/**
 * The company's Application Rules, told to the applicant on the step itself.
 *
 * Blocking issues render as one focusable `role="alert"` region — the step
 * focuses it when Continue is refused, so the reason is always announced and
 * always on screen, the same treatment `Step3_License` gives a missing upload.
 * Warnings render as `role="status"`: they inform, and Continue still continues.
 *
 * The wording is the rule engine's own, which is also what the server says when
 * it refuses the same submission — so the applicant never reads one explanation
 * on the page and a different one at the end.
 */
export const StepIssues = forwardRef(function StepIssues({ blocking = [], warnings = [], showBlocking = true }, ref) {
    const hasBlocking = showBlocking && blocking.length > 0;
    if (!hasBlocking && warnings.length === 0) return null;

    return (
        <div className="space-y-ds-3">
            {hasBlocking && (
                <div
                    ref={ref}
                    tabIndex={-1}
                    role="alert"
                    data-testid="step-blocking-issues"
                    className="flex items-start gap-ds-3 rounded-ds-md border border-ds-status-danger-border bg-ds-status-danger-bg px-ds-4 py-ds-3 text-ds-sm text-ds-status-danger-fg focus-visible:shadow-ds-focus"
                >
                    <AlertCircle size={18} className="mt-px shrink-0" aria-hidden="true" />
                    <ul className="space-y-ds-1">
                        {blocking.map((issue) => <li key={issue.code}>{issue.message}</li>)}
                    </ul>
                </div>
            )}
            {warnings.length > 0 && (
                <div
                    role="status"
                    data-testid="step-warning-issues"
                    className="flex items-start gap-ds-3 rounded-ds-md border border-ds-status-warning-border bg-ds-status-warning-bg px-ds-4 py-ds-3 text-ds-sm text-ds-status-warning-fg"
                >
                    <AlertTriangle size={18} className="mt-px shrink-0" aria-hidden="true" />
                    <ul className="space-y-ds-1">
                        {warnings.map((issue) => <li key={issue.code}>{issue.message}</li>)}
                    </ul>
                </div>
            )}
        </div>
    );
});

export default StepIssues;
