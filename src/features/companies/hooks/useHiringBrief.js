// src/features/companies/hooks/useHiringBrief.js

import { useState } from 'react';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { useServerAggregate } from '@shared/hooks/useServerAggregate';
import { applyClientSideFilters, createdAtMillis } from './dashboardSearch';
import { loadHiringBrief } from './dashboardQueries';
import { monthKey } from './dashboardPeriods';
import { E2E_DASHBOARD_APPLICATIONS } from './e2eDashboardFixtures';
import { keptAnswer } from '@shared/utils/keptAnswer';

const kept = keptAnswer();

/** Forgets the kept brief, so the next dashboard counts it again. */
export function forgetHiringBrief() {
    kept.forget();
}

/**
 * The browser tests' brief: the fixture applications through the filters their
 * lists use, dated as those lists are (a period of hires lists undated ones too).
 */
function e2eHiringBrief(month) {
    const listed = (pipelineSegment, filters = {}, { dated = true } = {}) => applyClientSideFilters(
        E2E_DASHBOARD_APPLICATIONS, { activeTab: 'applications', pipelineSegment, filters },
    ).filter((record) => !dated || createdAtMillis(record) !== null).length;
    return {
        applications: listed('all', { period: { field: 'createdAt', month } }),
        inProcess: listed('in_process'),
        hired: listed('all', { period: { field: 'hiredAt', month } }, { dated: false }),
    };
}

/**
 * The dashboard's hiring brief for the viewer's current month: applications
 * added, applications in process and applications hired, each a server count
 * of the list it opens (`loadHiringBrief`), read once when the dashboard opens
 * and kept two minutes for this sign-in, company and month (`keptAnswer`); a
 * failed read is not kept, so Try again reads anew.
 *
 * `brief` is null while it loads and after a failure (`error`), never a 0 that
 * was not counted; `refresh` reads it again. `month` (`YYYY-MM`) is the month
 * it counts, fixed when the dashboard opened, so its links open that month.
 */
export function useHiringBrief(companyId) {
    const [month] = useState(() => monthKey(new Date()));
    const { value, isLoading, error, refresh } = useServerAggregate({
        enabled: Boolean(companyId),
        run: async () => (isE2ETestMode
            ? e2eHiringBrief(month)
            : kept.read(`${companyId}#${month}`, () => loadHiringBrief({ companyId, month }))),
    });
    return { brief: value, month, isLoading, error, refresh };
}

export default useHiringBrief;
