import React from 'react';
import { Button, Notice } from '@/design-system/components';
import { HIRED_PERIOD_LIMIT, periodDescription } from '@features/companies/hooks/dashboardPeriods';

/**
 * The month the applications list was opened on from the dashboard's brief:
 * the applications added in it, or those hired in it whatever their status now.
 * The list keeps its segments and filters inside that month; Show all
 * applications leaves it. A period of hires lists at most the newest
 * `HIRED_PERIOD_LIMIT` hires and says so when there are more. Nothing renders
 * without a period.
 */
export function PeriodNotice({ period, truncated = false, onShowAll }) {
    const description = periodDescription(period);
    if (!description) return null;
    const hires = period.field === 'hiredAt';
    return (
        <Notice
            tone="info"
            size="sm"
            actions={<Button variant="secondary" size="sm" onClick={onShowAll}>Show all applications</Button>}
        >
            {`Showing ${description.charAt(0).toLowerCase()}${description.slice(1)}${hires ? ', whatever their status now' : ''}.`}
            {hires && truncated && ` Only the ${HIRED_PERIOD_LIMIT} most recent hires are listed; the filters narrow them.`}
        </Notice>
    );
}
