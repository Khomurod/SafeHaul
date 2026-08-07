import React, { useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button, Card } from '@/design-system/components';

/**
 * Tells a driver how much of the required three years their history accounts
 * for, and — when it does not add up — which months are still unexplained.
 *
 * WHY IT IS A PANEL AND NOT A BLOCK
 * ---------------------------------
 * 49 CFR 391.21(b)(10) requires the application to cover the previous three
 * years, and employment, explained unemployment, driving school and military
 * service all count. Nothing in the wizard said so, so a driver could reach the
 * signature page having accounted for four of thirty-six months without ever
 * being told.
 *
 * The fix is encouragement, not enforcement. A driver may have a genuinely
 * unusual history, may not remember exact dates, or may be finishing the
 * application on a phone at a truck stop. Blocking them loses the application
 * entirely, which serves nobody. So "Continue anyway" is always present and
 * always works — it is simply the quieter of the two actions (`ghost` against a
 * `primary`), which is the standard way to express a recommendation without
 * removing the choice.
 *
 * Presentation only: the coverage arithmetic lives in
 * `@shared/utils/employmentCoverage`, and the caller owns what the two actions
 * do.
 */

/** `2024-07` -> `July 2024`. Falls back to the raw value rather than inventing one. */
export function formatCoverageMonth(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return String(value || '');
    const monthIndex = Number(match[2]) - 1;
    const names = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ];
    return names[monthIndex] ? `${names[monthIndex]} ${match[1]}` : String(value);
}

/** "6 months" / "1 month" — no bare numbers in a sentence a driver reads. */
function describeMonths(count) {
    return count === 1 ? '1 month' : `${count} months`;
}

/** "July 2024" for a single month, "July 2024 – December 2024" for a range. */
export function describeGap(gap) {
    const from = formatCoverageMonth(gap.fromMonth);
    const to = formatCoverageMonth(gap.toMonth);
    return from === to ? from : `${from} – ${to}`;
}

export function EmploymentCoverageSummary({ coverage }) {
    if (!coverage) return null;

    if (coverage.isComplete) {
        return (
            <Card padding="sm" className="border-l-4 border-l-ds-status-success-border">
                <p className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                    <CheckCircle2
                        size={18}
                        className="mt-0.5 shrink-0 text-ds-status-success-fg"
                        aria-hidden="true"
                    />
                    <span>
                        Your history accounts for all {coverage.requiredMonths} months of the last
                        three years.
                    </span>
                </p>
            </Card>
        );
    }

    return (
        <Card padding="sm" className="border-l-4 border-l-ds-status-warning-border">
            <p className="flex items-start gap-ds-2 text-ds-sm text-ds-content-secondary">
                <AlertTriangle
                    size={18}
                    className="mt-0.5 shrink-0 text-ds-status-warning-fg"
                    aria-hidden="true"
                />
                <span>
                    Your history accounts for{' '}
                    <strong className="text-ds-content">
                        {coverage.coveredMonths} of {coverage.requiredMonths} months
                    </strong>{' '}
                    of the last three years. {describeMonths(coverage.missingMonths)} are still
                    unexplained.
                </span>
            </p>
        </Card>
    );
}

/**
 * @param {object}   props
 * @param {object}   props.coverage    Output of `computeEmploymentCoverage`.
 * @param {Function} props.onAddHistory Driver chose to fill the gaps in.
 * @param {Function} props.onContinueAnyway Driver chose to proceed regardless.
 */
export function EmploymentCoveragePrompt({ coverage, onAddHistory, onContinueAnyway }) {
    const headingRef = useRef(null);

    // Move focus to the panel when it appears: it replaces the outcome of a
    // button press, so a keyboard or screen-reader user must land on the reason
    // their Continue did not navigate rather than hunting for it.
    useEffect(() => {
        headingRef.current?.focus();
    }, []);

    if (!coverage) return null;

    const gaps = Array.isArray(coverage.gaps) ? coverage.gaps : [];

    return (
        <Card
            padding="md"
            role="alert"
            aria-labelledby="employment-coverage-heading"
            className="border-l-4 border-l-ds-status-warning-border"
        >
            <div className="space-y-ds-4">
                <div className="flex items-start gap-ds-3">
                    <AlertTriangle
                        size={22}
                        className="mt-0.5 shrink-0 text-ds-status-warning-fg"
                        aria-hidden="true"
                    />
                    <div className="space-y-ds-2">
                        <h3
                            id="employment-coverage-heading"
                            ref={headingRef}
                            tabIndex={-1}
                            className="text-ds-body font-bold text-ds-content"
                        >
                            {describeMonths(coverage.missingMonths)} of the last three years are
                            not accounted for
                        </h3>
                        <p className="text-ds-sm text-ds-content-secondary">
                            Carriers are required to account for the previous three years
                            (49 CFR 391.21). Adding the missing periods now usually means a
                            faster decision, and fewer questions later.
                        </p>
                    </div>
                </div>

                {gaps.length > 0 && (
                    <div className="space-y-ds-2">
                        <p className="text-ds-sm font-medium text-ds-content">
                            Still unexplained:
                        </p>
                        <ul className="space-y-ds-1 text-ds-sm text-ds-content-secondary">
                            {gaps.map((gap) => (
                                <li key={`${gap.fromMonth}-${gap.toMonth}`} className="flex gap-ds-2">
                                    <span aria-hidden="true">•</span>
                                    <span>
                                        {describeGap(gap)}{' '}
                                        <span className="text-ds-content-muted">
                                            ({describeMonths(gap.months)})
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="space-y-ds-2">
                    <p className="text-ds-sm font-medium text-ds-content">
                        Any of these count toward the three years:
                    </p>
                    <ul className="space-y-ds-1 text-ds-sm text-ds-content-secondary">
                        <li>A job you held — driving or not.</li>
                        <li>Time you were unemployed or between jobs.</li>
                        <li>Driving school or other schooling.</li>
                        <li>Military service.</li>
                    </ul>
                </div>

                {coverage.unparseableRecords > 0 && (
                    <p className="text-ds-sm text-ds-content-secondary">
                        {coverage.unparseableRecords === 1
                            ? 'One entry is missing usable start or end dates, so it could not be counted.'
                            : `${coverage.unparseableRecords} entries are missing usable start or end dates, so they could not be counted.`}
                    </p>
                )}

                {/*
                  Deliberate visual weight: adding the history is the primary
                  action, continuing anyway is the quiet one. Both are real,
                  reachable, keyboard-operable buttons — the driver is never
                  trapped on this step.
                */}
                <div className="flex flex-col gap-ds-2 sm:flex-row sm:items-center">
                    <Button variant="primary" size="lg" onClick={onAddHistory}>
                        Add missing history
                    </Button>
                    <Button variant="ghost" size="lg" onClick={onContinueAnyway}>
                        Continue anyway
                    </Button>
                </div>
            </div>
        </Card>
    );
}

export default EmploymentCoveragePrompt;
