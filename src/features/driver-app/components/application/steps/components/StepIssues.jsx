import React, { forwardRef } from 'react';
import { Link, Notice } from '@/design-system/components';

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
 *
 * Both blocks are `Notice`s as of the 6c migration. Neither passes an `icon`:
 * `AlertCircle` for danger and `AlertTriangle` for warning are already the
 * tones' own glyphs, so this is one of the sites where the default was read off
 * what the application was doing rather than imposed on it.
 *
 * Both take the default `md` rather than `sm`. `sm` is for a notice inside a
 * panel that is already tight; this is a step's own summary at full width. The
 * text goes 13px to 14px as a result — the size the design system says a notice
 * reads at, and the reason `md` is the default at all.
 *
 * An issue that carries `focusId` names a field on the step, so its line is a
 * link to that field, as in an error summary: `onFocusField` moves focus there
 * rather than leaving the browser to scroll to it unfocused. The Employment page
 * lists its empty fields this way. Lines are keyed by `key` when an issue has
 * one, and by position otherwise, because one rule can raise the same `code`
 * for two rows.
 */
const lineKey = (issue, index) => issue.key || `${issue.code}-${index}`;

export const StepIssues = forwardRef(function StepIssues({
    blocking = [], warnings = [], showBlocking = true, title, onFocusField,
}, ref) {
    const hasBlocking = showBlocking && blocking.length > 0;
    if (!hasBlocking && warnings.length === 0) return null;

    return (
        <div className="space-y-ds-3">
            {hasBlocking && (
                <Notice
                    ref={ref}
                    tabIndex={-1}
                    announce="assertive"
                    tone="danger"
                    title={title}
                    data-testid="step-blocking-issues"
                >
                    <ul className="space-y-ds-1">
                        {blocking.map((issue, index) => (
                            <li key={lineKey(issue, index)}>
                                {issue.focusId && onFocusField ? (
                                    <Link
                                        href={`#${issue.focusId}`}
                                        onClick={(event) => {
                                            event.preventDefault();
                                            onFocusField(issue.focusId);
                                        }}
                                    >
                                        {issue.message}
                                    </Link>
                                ) : issue.message}
                            </li>
                        ))}
                    </ul>
                </Notice>
            )}
            {warnings.length > 0 && (
                <Notice
                    announce="polite"
                    tone="warning"
                    data-testid="step-warning-issues"
                >
                    <ul className="space-y-ds-1">
                        {warnings.map((issue, index) => <li key={lineKey(issue, index)}>{issue.message}</li>)}
                    </ul>
                </Notice>
            )}
        </div>
    );
});

export default StepIssues;
