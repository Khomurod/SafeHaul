// src/features/companies/hooks/dashboardQueries.js
//
// The dashboard's Firestore side, kept apart from `useCompanyDashboard.js` for
// the source-size standard. Everything here is React-free:
// constraint planning for the list queries, the parallel search execution,
// a period of hires as one list, the stats counts (rollup-first, with the
// count-query fallback) and the hiring brief's counts, from the lists' own
// queries. The hooks keep the state, the effects, the pagination bookkeeping
// and the E2E fixture branches, and pass their current state in as plain arguments.

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
    stateValuesForSegment,
    addedWindow,
    hiredWindow,
    SEARCH_PLAN_LIMIT,
    PREFIX_END,
} from './dashboardSearch';
import { HIRED_PERIOD_LIMIT, periodRange } from './dashboardPeriods';

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
 * The assignees a list asks for, once each: the signed-in recruiter on My Leads
 * and with My assignments, and the Assigned to pick ('' for Unassigned).
 */
function wantedAssignees({ activeTab, filters }) {
    const uid = auth.currentUser?.uid;
    const wanted = [];
    if (activeTab === 'my_leads' && uid) wanted.push(uid);
    if (filters.myAssignmentsOnly && uid && (activeTab === 'applications' || activeTab === 'company_leads')) {
        wanted.push(uid);
    }
    if (filters.assignee) wanted.push(filters.assignee === '__unassigned__' ? '' : filters.assignee);
    return [...new Set(wanted)];
}

/**
 * The list query for a tab, a pipeline segment and the toolbar's filters: the
 * equality filters, then the createdAt order (`dateOrder`, newest first unless
 * the Added Date arrows turn it), then the Added dates asked for — the picked
 * day, a period's month, or the days both share (`addedWindow`) — as cursors on
 * that order. A sort leaves out records without createdAt, which no date order
 * can list; `ordered: false` returns the filters alone, so the hook can count
 * those records and the page can say how to find them. A period of hires is
 * not this query's: `runHiredPeriodList` lists it.
 *
 * `null` when no record can match, so the list is empty without asking
 * Firestore: the filters ask for two different assignees (Firestore would also
 * refuse the widest such query, two assignee filters in every alternative it
 * expands), or a picked day outside a period's month.
 */
export function buildDashboardConstraints({ activeTab, pipelineSegment, filters, dateOrder = 'desc', ordered = true }) {
    const assignees = wantedAssignees({ activeTab, filters });
    if (assignees.length > 1) return null;
    const added = addedWindow(filters);
    if (added && added.start >= added.end) return null;

    const constraints = [];

    if (assignees.length === 1) {
        constraints.push(where('assignedTo', '==', assignees[0]));
    }

    constraints.push(...pipelineConstraints({ activeTab, pipelineSegment }));

    const states = stateValuesForSegment(filters.state, { activeTab, pipelineSegment });
    if (states.length > 0) {
        constraints.push(where("state", "in", states));
    }
    // Every writer stores a freight type as one value: the import's Job Type
    // column and the Call Outcome's Freight Type both write text. Also asking
    // for a list holding it (an `or` with array-contains) would double the
    // alternatives Firestore expands this query into, past its limits.
    if (filters.driverType) {
        constraints.push(where('driverType', '==', filters.driverType));
    }

    if (!ordered) return constraints;

    const direction = dateOrder === 'asc' ? 'asc' : 'desc';
    constraints.push(orderBy('createdAt', direction));

    if (added) {
        // The recruiter's own days, from local midnight, as cursors on the
        // createdAt order rather than range filters: equality filters with a
        // sort are what Firestore serves by merging the declared indexes. A
        // later page's startAfter(lastDoc) replaces the first cursor and keeps
        // the second.
        constraints.push(...(direction === 'asc'
            ? [startAt(added.start), endBefore(added.end)]
            : [startAfter(added.end), endAt(added.start)]));
    }

    return constraints;
}

/**
 * How long a rollup stays trusted after its last recount: the daily job's 24
 * hours and a margin, so a job that stopped running shows counted numbers.
 */
const ROLLUP_TRUSTED_MS = 36 * 60 * 60 * 1000;

const isCount = (value) => Number.isInteger(value) && value >= 0;
const millisOf = (value) => (typeof value?.toMillis === 'function' ? value.toMillis() : NaN);

/**
 * Whether the rollup document's numbers can be shown: its three counts are
 * whole numbers not below zero, and the server recounted it within
 * `ROLLUP_TRUSTED_MS` (`reconcileDashboardStatsDaily`). Its increments drift,
 * so a rollup never recounted, or one gone below zero, is counted afresh.
 */
function rollupIsTrusted(roll, now = Date.now()) {
    if (!roll || roll.schemaVersion !== 1) return false;
    if (![roll.applicationsTotal, roll.leadsTotal, roll.hiredTotal].every(isCount)) return false;
    const age = now - millisOf(roll.reconciledAt);
    return age >= 0 && age <= ROLLUP_TRUSTED_MS;
}

/**
 * The stats counts against live Firestore: rollup document first when the
 * runtime prefers it and it is trusted (`rollupIsTrusted`), count queries
 * otherwise. Returns the stats object; the hook owns setState and the error
 * handling around this call.
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

        if (rollupIsTrusted(roll)) {
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

/** Applications hired in a window: `hiredAt` from its start to its end. One field, so no composite index. */
export function hiredPeriodConstraints(window) {
    return [where('hiredAt', '>=', window.start), where('hiredAt', '<', window.end)];
}

/**
 * A period of hires (`hiredWindow`) as one list: the period's applications,
 * newest hire first and at most `HIRED_PERIOD_LIMIT`, then the tab's segment and
 * the toolbar's filters on the client, as search does, so no combination waits
 * for a composite index. A record without createdAt is listed too: the hook sorts
 * this list itself. `truncated` says the period held more.
 */
export async function runHiredPeriodList({ companyId, filterContext }) {
    const window = hiredWindow(filterContext.filters);
    if (!window || window.start >= window.end) return { records: [], truncated: false };
    const snapshot = await getDocs(query(
        collection(db, 'companies', companyId, 'applications'),
        ...hiredPeriodConstraints(window),
        orderBy('hiredAt', 'desc'),
        limit(HIRED_PERIOD_LIMIT + 1),
    ));
    const records = snapshot.docs
        .slice(0, HIRED_PERIOD_LIMIT)
        .map((docSnap) => ({ id: docSnap.id, companyId, ...docSnap.data() }));
    return {
        records: applyClientSideFilters(records, filterContext),
        truncated: snapshot.docs.length > HIRED_PERIOD_LIMIT,
    };
}

/**
 * The hiring brief's three numbers for a month, each a server count of the
 * very list it opens: applications added in the month (All Applications on that
 * period), applications in process (the In process tab), and applications hired
 * in the month from the day hire dates began (that period of hires, whatever
 * their status now). A count no record can match is 0 without asking.
 */
export async function loadHiringBrief({ companyId, month }) {
    const appsRef = collection(db, 'companies', companyId, 'applications');
    const countOf = async (constraints) => (constraints
        ? (await getCountFromServer(query(appsRef, ...constraints))).data().count
        : 0);
    const hires = periodRange({ field: 'hiredAt', month });

    const [applications, inProcess, hired] = await Promise.all([
        countOf(buildDashboardConstraints({
            activeTab: 'applications', pipelineSegment: 'all', filters: { period: { field: 'createdAt', month } },
        })),
        countOf(buildDashboardConstraints({ activeTab: 'applications', pipelineSegment: 'in_process', filters: {} })),
        countOf(hires && hires.start < hires.end ? hiredPeriodConstraints(hires) : null),
    ]);
    return { applications, inProcess, hired };
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
