// src/features/companies/hooks/useDashboardCounts.js

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { applyClientSideFilters } from './dashboardSearch';
import { loadDashboardStats } from './dashboardQueries';
import { E2E_DASHBOARD_APPLICATIONS, E2E_DASHBOARD_LEADS } from './e2eDashboardFixtures';

/**
 * The company dashboard's four counts — applications, company leads, the
 * signed-in recruiter's leads and hired — from the rollup document when it is
 * complete, else from count queries (`loadDashboardStats`). The dashboard shows
 * no list, so this reads no records; the candidate lists, which show no counts
 * of these, do not read them.
 *
 * `counts` is `null` until they are read for the current company, and stays
 * `null` after a failed first read (no 0 that was not read); `loading` is true
 * until the first answer or failure. Answer and failure are kept with the
 * company they belong to, so another company's numbers are never returned. A
 * failed Retry keeps the numbers already read, beside the error.
 */
export function useDashboardCounts(companyId) {
    const [answer, setAnswer] = useState(null);
    const [failure, setFailure] = useState(null);
    // A late answer belongs to an earlier company, or to an earlier Retry.
    const versionRef = useRef(0);

    const refresh = useCallback(async () => {
        if (!companyId) return;
        const version = ++versionRef.current;
        setFailure(null);

        if (isE2ETestMode) {
            // The browser tests' records, through the same filter the lists use.
            const apps = E2E_DASHBOARD_APPLICATIONS.map((record) => ({ ...record, companyId }));
            const leads = E2E_DASHBOARD_LEADS.map((record) => ({ ...record, companyId }));
            const uid = auth.currentUser?.uid || 'e2e-company_admin';
            setAnswer({
                companyId,
                counts: {
                    applications: apps.length,
                    companyLeads: leads.length,
                    myLeads: leads.filter((lead) => lead.assignedTo === uid).length,
                    hired: applyClientSideFilters(apps, { activeTab: 'applications', pipelineSegment: 'hired' }).length,
                },
            });
            return;
        }

        try {
            const next = await loadDashboardStats({ companyId });
            if (version === versionRef.current) setAnswer({ companyId, counts: next });
        } catch (e) {
            if (version !== versionRef.current) return;
            console.error('Error fetching stats:', e);
            setFailure({ companyId, message: e?.message || 'Could not load dashboard counts.' });
        }
    }, [companyId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const counts = answer && answer.companyId === companyId ? answer.counts : null;
    const statsFetchError = failure && failure.companyId === companyId ? failure.message : '';
    const loading = Boolean(companyId) && counts === null && !statsFetchError;

    return { counts, loading, statsFetchError, refresh };
}
