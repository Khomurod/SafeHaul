// src/features/companies/hooks/useDashboardCounts.js

import { useCallback, useEffect, useRef, useState } from 'react';
import { auth } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import { applyClientSideFilters } from './dashboardSearch';
import { loadDashboardStats } from './dashboardQueries';
import { E2E_DASHBOARD_APPLICATIONS, E2E_DASHBOARD_LEADS } from './e2eDashboardFixtures';

const NO_COUNTS = Object.freeze({ applications: 0, companyLeads: 0, myLeads: 0, hired: 0 });

/**
 * The company dashboard's four counts — applications, company leads, the
 * signed-in recruiter's leads and hired — from the rollup document when it is
 * complete, else from count queries (`loadDashboardStats`). The dashboard shows
 * no list, so this reads no records; the candidate lists, which show no counts
 * of these, do not read them.
 */
export function useDashboardCounts(companyId) {
    const [counts, setCounts] = useState(NO_COUNTS);
    const [statsFetchError, setStatsFetchError] = useState('');
    // A late answer belongs to an earlier company, or to an earlier Retry.
    const versionRef = useRef(0);

    const refresh = useCallback(async () => {
        if (!companyId) return;
        const version = ++versionRef.current;
        setStatsFetchError('');

        if (isE2ETestMode) {
            // The browser tests' records, through the same filter the lists use.
            const apps = E2E_DASHBOARD_APPLICATIONS.map((record) => ({ ...record, companyId }));
            const leads = E2E_DASHBOARD_LEADS.map((record) => ({ ...record, companyId }));
            const uid = auth.currentUser?.uid || 'e2e-company_admin';
            setCounts({
                applications: apps.length,
                companyLeads: leads.length,
                myLeads: leads.filter((lead) => lead.assignedTo === uid).length,
                hired: applyClientSideFilters(apps, { activeTab: 'applications', pipelineSegment: 'hired' }).length,
            });
            return;
        }

        try {
            const next = await loadDashboardStats({ companyId });
            if (version === versionRef.current) setCounts(next);
        } catch (e) {
            if (version !== versionRef.current) return;
            console.error('Error fetching stats:', e);
            setStatsFetchError(e?.message || 'Could not load dashboard counts.');
        }
    }, [companyId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    return { counts, statsFetchError, refresh };
}
