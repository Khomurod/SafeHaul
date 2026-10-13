// src/features/companies/hooks/dashboardQueries.js
//
// The dashboard's Firestore side, split out of `useCompanyDashboard.js` on
// 2026-09-01 for the source-size standard. Everything here is React-free:
// constraint planning for the list queries, the parallel search execution,
// and the stats counts (rollup-first, with the count-query fallback). The
// hook keeps the state, the effects, the pagination bookkeeping and the E2E
// fixture branches, and passes its current state in as plain arguments.

import {
    collection,
    query,
    orderBy,
    limit,
    getDocs,
    getDoc,
    doc,
    where,
    getCountFromServer,
    documentId,
    startAt,
    startAfter,
    endAt,
    endBefore,
} from 'firebase/firestore';
import { db, auth } from '@lib/firebase';
import { shouldPreferDashboardRollup } from '@lib/runtime/dashboardRollup';
import { getStatusesForSegment } from '@shared/utils/applicationStatus';
import {
    classifySearchTerm,
    buildSearchPlans,
    recordMatchesSearch,
    applyClientSideFilters,
    mergeSearchResults,
    stateFilterValues,
    dateFilterRange,
    SEARCH_PLAN_LIMIT,
    PREFIX_END,
} from './dashboardSearch';

function pipelineConstraints({ activeTab, pipelineSegment }) {
    if (activeTab === 'applications') {
        // Centralized status vocabulary: 'new' covers 'New' + 'New Application',
        // 'hired' covers 'Hired' + 'Approved', 'declined' covers 'Declined' + 'Rejected'.
        const statuses = getStatusesForSegment(pipelineSegment);
        if (statuses) return [where('status', 'in', statuses)];
        return [];
    }
    if (activeTab === 'company_leads' || activeTab === 'my_leads') {
        if (pipelineSegment === 'attempting') {
            return [where('status', 'in', ['Contact Attempt 1', 'Contact Attempt 2', 'Contact Attempt 3'])];
        }
        if (pipelineSegment === 'in_process') return [where('status', '==', 'In Process')];
        if (pipelineSegment === 'interested') return [where('status', '==', 'Interested')];
    }
    return [];
}

/**
 * The list query for a tab, a pipeline segment and the toolbar's filters: the
 * equality filters, then the createdAt order (`dateOrder`, newest first unless
 * the Added Date arrows turn it), then the picked day as cursors on that order.
 * A sort leaves out records without createdAt, which no date order can list;
 * `ordered: false` returns the filters alone, so the hook can count those
 * records and the page can say how to find them.
 */
export function buildDashboardConstraints({ activeTab, pipelineSegment, filters, dateOrder = 'desc', ordered = true }) {
    const constraints = [];

    if (activeTab === 'my_leads' && auth.currentUser) {
        constraints.push(where("assignedTo", "==", auth.currentUser.uid));
    }

    constraints.push(...pipelineConstraints({ activeTab, pipelineSegment }));

    if (filters.myAssignmentsOnly && auth.currentUser &&
        (activeTab === 'applications' || activeTab === 'company_leads')) {
        constraints.push(where('assignedTo', '==', auth.currentUser.uid));
    }

    const states = stateFilterValues(filters.state);
    if (states.length > 0) {
        constraints.push(where("state", "in", states));
    }
    if (filters.driverType) {
        constraints.push(where("driverType", "array-contains", filters.driverType));
    }
    if (filters.assignee) {
        if (filters.assignee === '__unassigned__') {
            constraints.push(where("assignedTo", "==", ""));
        } else {
            constraints.push(where("assignedTo", "==", filters.assignee));
        }
    }

    if (!ordered) return constraints;

    const direction = dateOrder === 'asc' ? 'asc' : 'desc';
    constraints.push(orderBy('createdAt', direction));

    const day = dateFilterRange(filters.dateFilter);
    if (day) {
        // The recruiter's own day, from local midnight to the next, as cursors
        // on the createdAt order rather than range filters: equality filters
        // with a sort are what Firestore serves by merging the declared
        // indexes. A later page's startAfter(lastDoc) replaces the first cursor
        // and keeps the second.
        constraints.push(...(direction === 'asc'
            ? [startAt(day.start), endBefore(day.end)]
            : [startAfter(day.end), endAt(day.start)]));
    }

    return constraints;
}

/**
 * The stats counts against live Firestore: rollup document first when the
 * runtime prefers it, count queries otherwise. Returns the stats object; the
 * hook owns setState and the error handling around this call.
 */
export async function loadDashboardStats({ companyId }) {
    const appsRef = collection(db, "companies", companyId, "applications");
    const leadsRef = collection(db, "companies", companyId, "leads");

    const myLeadsSnapPromise = auth.currentUser
        ? getCountFromServer(query(leadsRef, where('assignedTo', '==', auth.currentUser.uid)))
        : Promise.resolve({ data: () => ({ count: 0 }) });

    if (shouldPreferDashboardRollup()) {
        const rollSnap = await getDoc(doc(db, 'companies', companyId, 'internal_stats', 'dashboard'));
        const roll = rollSnap.exists() ? rollSnap.data() : null;
        const rollupOk = roll && roll.schemaVersion === 1
            && typeof roll.applicationsTotal === 'number'
            && typeof roll.leadsTotal === 'number'
            && typeof roll.hiredTotal === 'number';

        if (rollupOk) {
            const myLeadsSnap = await myLeadsSnapPromise;
            return {
                applications: roll.applicationsTotal,
                companyLeads: roll.leadsTotal,
                myLeads: myLeadsSnap.data().count,
                hired: roll.hiredTotal,
            };
        }
    }

    const hiredQuery = query(appsRef, where('status', 'in', getStatusesForSegment('hired')));
    const [appsSnap, companyLeadsSnap, myLeadsSnap, hiredSnap] = await Promise.all([
        getCountFromServer(appsRef),
        getCountFromServer(leadsRef),
        myLeadsSnapPromise,
        getCountFromServer(hiredQuery),
    ]);

    return {
        applications: appsSnap.data().count,
        companyLeads: companyLeadsSnap.data().count,
        myLeads: myLeadsSnap.data().count,
        hired: hiredSnap.data().count,
    };
}

/**
 * Search mode: run the classified term's single-field query plans in
 * parallel, merge + verify client-side, then apply the active tab scope,
 * pipeline segment, and toolbar filters. Single-field queries only —
 * combining search with tabs/filters can never hit a missing composite
 * index, and nothing downloads the whole collection.
 */
export async function runDashboardSearch({ companyId, activeTab, term, filterContext }) {
    const classified = classifySearchTerm(term);
    if (!classified) return [];

    const collectionName = activeTab === 'applications' ? 'applications' : 'leads';
    const baseRef = collection(db, "companies", companyId, collectionName);

    const plans = buildSearchPlans(classified);
    const seenPlanKeys = new Set();
    const queries = [];
    for (const plan of plans) {
        const planKey = `${plan.kind}:${plan.field || ''}:${plan.value}`;
        if (!plan.value || seenPlanKeys.has(planKey)) continue;
        seenPlanKeys.add(planKey);

        if (plan.kind === 'docId') {
            queries.push(
                getDocs(query(baseRef, where(documentId(), '==', plan.value), limit(1)))
            );
        } else if (plan.kind === 'eq') {
            queries.push(
                getDocs(query(baseRef, where(plan.field, '==', plan.value), limit(SEARCH_PLAN_LIMIT)))
            );
        } else if (plan.kind === 'prefix') {
            queries.push(
                getDocs(query(
                    baseRef,
                    where(plan.field, '>=', plan.value),
                    where(plan.field, '<=', plan.value + PREFIX_END),
                    limit(SEARCH_PLAN_LIMIT),
                ))
            );
        }
    }

    const snapshots = await Promise.all(queries);
    const lists = snapshots.map((snapshot) =>
        snapshot.docs.map((docSnap) => ({ id: docSnap.id, companyId, ...docSnap.data() }))
    );

    const merged = mergeSearchResults(lists);
    const verified = merged.filter((record) => recordMatchesSearch(record, classified));
    return applyClientSideFilters(verified, filterContext);
}
