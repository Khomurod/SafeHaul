// src/features/companies/hooks/useCompanyDashboard.js

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    getDocs,
    getDoc,
    doc,
    where,
    getCountFromServer,
    documentId,
} from 'firebase/firestore';
import { db, auth } from '@lib/firebase';
import { shouldPreferDashboardRollup } from '@lib/runtime/dashboardRollup';
import { getStatusesForSegment } from '@shared/utils/applicationStatus';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import {
    classifySearchTerm,
    buildSearchPlans,
    recordMatchesSearch,
    applyClientSideFilters,
    mergeSearchResults,
    SEARCH_PLAN_LIMIT,
    PREFIX_END,
} from './dashboardSearch';
import { E2E_DASHBOARD_APPLICATIONS, E2E_DASHBOARD_LEADS } from './e2eDashboardFixtures';

/** applications: all | new | hired | terminated | declined — leads: all | attempting | in_process | interested */
export function useCompanyDashboard(companyId) {
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [statsFetchError, setStatsFetchError] = useState('');
    const [listCountError, setListCountError] = useState('');

    const [latestBatchTime, setLatestBatchTime] = useState(null);
    const [teamMembers, setTeamMembers] = useState([]);
    const [stats, setStats] = useState({
        applications: 0,
        companyLeads: 0,
        myLeads: 0,
        hired: 0
    });

    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [listTotalCount, setListTotalCount] = useState(0);

    const lastVisibleDocsRef = useRef({});
    // Monotonic fetch id — a stale (slower) fetch must never overwrite the
    // results of a newer query, or cleared searches briefly show old rows.
    const fetchVersionRef = useRef(0);

    const [activeTab, setActiveTab] = useState('applications');
    const [pipelineSegment, setPipelineSegment] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filters, setFilters] = useState({
        state: '',
        driverType: '',
        dob: '',
        assignee: '',
        dateFilter: '',
        myAssignmentsOnly: false
    });

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        setPipelineSegment('all');
    }, [activeTab]);

    // E2E fixture dataset: the placeholder Firebase project is unreachable in
    // E2E runs, so search/filters/tabs are exercised against in-memory records
    // through the same pure helpers the live query path uses.
    const e2eRecordsForTab = useCallback((tab) => {
        const source = tab === 'applications' ? E2E_DASHBOARD_APPLICATIONS : E2E_DASHBOARD_LEADS;
        return source.map((record) => ({ ...record, companyId }));
    }, [companyId]);

    const fetchStats = useCallback(async () => {
        if (!companyId) return;
        setStatsFetchError('');

        if (isE2ETestMode) {
            const apps = e2eRecordsForTab('applications');
            const leads = e2eRecordsForTab('company_leads');
            const uid = auth.currentUser?.uid || 'e2e-company_admin';
            setStats({
                applications: apps.length,
                companyLeads: leads.length,
                myLeads: leads.filter((l) => l.assignedTo === uid).length,
                hired: applyClientSideFilters(apps, { activeTab: 'applications', pipelineSegment: 'hired' }).length,
            });
            return;
        }

        try {
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
                    setStats({
                        applications: roll.applicationsTotal,
                        companyLeads: roll.leadsTotal,
                        myLeads: myLeadsSnap.data().count,
                        hired: roll.hiredTotal,
                    });
                    return;
                }
            }

            const hiredQuery = query(appsRef, where('status', 'in', getStatusesForSegment('hired')));
            const [appsSnap, companyLeadsSnap, myLeadsSnap, hiredSnap] = await Promise.all([
                getCountFromServer(appsRef),
                getCountFromServer(leadsRef),
                myLeadsSnapPromise,
                getCountFromServer(hiredQuery),
            ]);

            setStats({
                applications: appsSnap.data().count,
                companyLeads: companyLeadsSnap.data().count,
                myLeads: myLeadsSnap.data().count,
                hired: hiredSnap.data().count,
            });
        } catch (e) {
            console.error("Error fetching stats:", e);
            setStatsFetchError(e?.message || 'Could not load dashboard counts.');
        }
    }, [companyId, e2eRecordsForTab]);

    const pipelineConstraints = useCallback(() => {
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
    }, [activeTab, pipelineSegment]);

    const usesPipelineOrderBy = useCallback(() => {
        if (activeTab === 'applications' && pipelineSegment !== 'all') return true;
        if ((activeTab === 'company_leads' || activeTab === 'my_leads') && pipelineSegment !== 'all') return true;
        return false;
    }, [activeTab, pipelineSegment]);

    const buildConstraints = useCallback(() => {
        let constraints = [];

        if (activeTab === 'applications') {
            if (!usesPipelineOrderBy()) {
                // legacy browse: no orderBy (document-id ordering)
            }
        } else if (activeTab === 'company_leads') {
            if (!usesPipelineOrderBy()) {
                constraints.push(orderBy("createdAt", "desc"));
            }
        } else if (activeTab === 'my_leads' && auth.currentUser) {
            constraints.push(where("assignedTo", "==", auth.currentUser.uid));
            if (!usesPipelineOrderBy()) {
                constraints.push(orderBy("createdAt", "desc"));
            }
        }

        constraints.push(...pipelineConstraints());

        if (filters.myAssignmentsOnly && auth.currentUser &&
            (activeTab === 'applications' || activeTab === 'company_leads')) {
            constraints.push(where('assignedTo', '==', auth.currentUser.uid));
        }

        if (filters.state) {
            constraints.push(where("state", "==", filters.state.toUpperCase()));
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

        if (usesPipelineOrderBy()) {
            constraints.push(orderBy('createdAt', 'desc'));
        }

        return constraints;
    }, [activeTab, filters, pipelineConstraints, usesPipelineOrderBy]);

    const clientFilterContext = useCallback(() => ({
        activeTab,
        pipelineSegment,
        filters,
        // E2E mode has no real Firebase session; the fixture records are
        // assigned to the mock admin uid used by DataContext.
        currentUid: auth.currentUser?.uid || (isE2ETestMode ? 'e2e-company_admin' : null),
    }), [activeTab, pipelineSegment, filters]);

    const fetchListTotalCount = useCallback(async () => {
        if (!companyId || debouncedSearch) return;
        setListCountError('');

        if (isE2ETestMode) {
            const records = applyClientSideFilters(e2eRecordsForTab(activeTab), clientFilterContext());
            setListTotalCount(records.length);
            return;
        }

        try {
            const collectionName = activeTab === 'applications' ? 'applications' : 'leads';
            const baseRef = collection(db, "companies", companyId, collectionName);
            const constraints = buildConstraints();
            const snap = await getCountFromServer(query(baseRef, ...constraints));
            setListTotalCount(snap.data().count);
        } catch (e) {
            console.error('fetchListTotalCount', e);
            setListTotalCount(0);
            setListCountError(e?.message || 'Could not load total count.');
        }
    }, [companyId, activeTab, debouncedSearch, buildConstraints, clientFilterContext, e2eRecordsForTab]);

    useEffect(() => {
        fetchListTotalCount();
    }, [fetchListTotalCount]);

    /**
     * Search mode: run the classified term's single-field query plans in
     * parallel, merge + verify client-side, then apply the active tab scope,
     * pipeline segment, and toolbar filters. Single-field queries only —
     * combining search with tabs/filters can never hit a missing composite
     * index, and nothing downloads the whole collection.
     */
    const runSearchQuery = useCallback(async (term) => {
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
        return applyClientSideFilters(verified, clientFilterContext());
    }, [companyId, activeTab, clientFilterContext]);

    const fetchData = useCallback(async () => {
        if (!companyId) return;

        const fetchVersion = ++fetchVersionRef.current;
        setLoading(true);
        setError('');

        try {
            const isSearch = !!debouncedSearch;

            if (isE2ETestMode) {
                let records = applyClientSideFilters(e2eRecordsForTab(activeTab), clientFilterContext());
                if (isSearch) {
                    const classified = classifySearchTerm(debouncedSearch);
                    records = records.filter((record) => recordMatchesSearch(record, classified));
                }
                if (fetchVersion !== fetchVersionRef.current) return;
                setData(records);
                if (isSearch) setTotalPages(1);
                return;
            }

            const collectionName = activeTab === 'applications' ? 'applications' : 'leads';
            const baseRef = collection(db, "companies", companyId, collectionName);

            let newData;

            if (isSearch) {
                newData = await runSearchQuery(debouncedSearch.trim());
            } else {
                let constraints = buildConstraints();

                if (currentPage > 1) {
                    const prevPageLastDoc = lastVisibleDocsRef.current[currentPage - 1];
                    if (prevPageLastDoc) {
                        constraints.push(startAfter(prevPageLastDoc));
                    } else {
                        setCurrentPage(1);
                        return;
                    }
                }

                constraints.push(limit(itemsPerPage));
                const snapshot = await getDocs(query(baseRef, ...constraints));
                newData = snapshot.docs.map(docSnap => {
                    const d = docSnap.data();
                    return {
                        id: docSnap.id,
                        companyId,
                        ...d,
                    };
                });

                if (filters.dateFilter) {
                    const filterDate = new Date(filters.dateFilter + 'T00:00:00');
                    const filterYear = filterDate.getFullYear();
                    const filterMonth = filterDate.getMonth();
                    const filterDay = filterDate.getDate();

                    newData = newData.filter(item => {
                        const ts = item.submittedAt || item.createdAt;
                        if (!ts) return false;
                        try {
                            const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000);
                            return d.getFullYear() === filterYear && d.getMonth() === filterMonth && d.getDate() === filterDay;
                        } catch {
                            return false;
                        }
                    });
                }

                if (fetchVersion === fetchVersionRef.current && snapshot.docs.length > 0) {
                    const lastDoc = snapshot.docs[snapshot.docs.length - 1];
                    lastVisibleDocsRef.current[currentPage] = lastDoc;
                }
            }

            // Drop stale responses — a newer query has already started.
            if (fetchVersion !== fetchVersionRef.current) return;

            setData(newData.map((record) => ({
                ...record,
                lastCall: record.lastContactedAt || record.lastCall,
                lastCallOutcome: record.lastCallOutcome,
            })));

            if (isSearch) {
                setTotalPages(1);
            }

        } catch (err) {
            if (fetchVersion !== fetchVersionRef.current) return;
            console.error("Dashboard fetch error:", err);

            if (err.message && err.message.includes('requires an index')) {
                setError("Missing Index: Please check the browser console for the creation link.");
                console.warn("CLICK THIS LINK TO CREATE INDEX:", err);
            } else {
                setError(err.message || "Failed to load data.");
            }
        } finally {
            if (fetchVersion === fetchVersionRef.current) {
                setLoading(false);
            }
        }
    }, [companyId, activeTab, currentPage, itemsPerPage, debouncedSearch, filters, buildConstraints, runSearchQuery, clientFilterContext, e2eRecordsForTab]);

    useEffect(() => {
        if (debouncedSearch) {
            setTotalPages(1);
        } else {
            setTotalPages(Math.max(1, Math.ceil((listTotalCount || 0) / itemsPerPage)));
        }
    }, [listTotalCount, itemsPerPage, debouncedSearch]);

    // NOTE: latestBatchTime previously tracked the most recent Lead Distribution Engine
    // batch (platform-leads "Dealer" feature). The engine has been removed; keep the
    // state as `null` so downstream consumers gracefully render no batch label.
    useEffect(() => {
        setLatestBatchTime(null);
    }, [companyId, activeTab]);

    useEffect(() => {
        fetchStats();
    }, [companyId, fetchStats]);

    useEffect(() => {
        const fetchTeamMembers = async () => {
            if (!companyId) return;
            if (isE2ETestMode) {
                setTeamMembers([{ id: 'e2e-company_admin', name: 'E2E Admin' }]);
                return;
            }
            try {
                const teamRef = collection(db, "companies", companyId, "team");
                const snapshot = await getDocs(teamRef);
                const members = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
                setTeamMembers(members);
            } catch (e) {
                console.error("Error fetching team members:", e);
            }
        };
        fetchTeamMembers();
    }, [companyId]);

    // Any change to scope, search, filters, or pipeline resets pagination and
    // clears page cursors so stale cursors can never leak across queries.
    useEffect(() => {
        setData([]);
        lastVisibleDocsRef.current = {};
        setCurrentPage(1);
    }, [activeTab, companyId, debouncedSearch, filters, pipelineSegment]);

    useEffect(() => {
        fetchData();
    }, [companyId, activeTab, currentPage, itemsPerPage, debouncedSearch, filters, pipelineSegment, fetchData]);

    const handleSetItemsPerPage = (num) => {
        setItemsPerPage(num);
        setCurrentPage(1);
        lastVisibleDocsRef.current = {};
    };

    const handleSetFilters = (keyOrObjOrFn, value) => {
        if (typeof keyOrObjOrFn === 'function') {
            setFilters(keyOrObjOrFn);
        } else if (typeof keyOrObjOrFn === 'object' && keyOrObjOrFn !== null) {
            setFilters(keyOrObjOrFn);
        } else {
            setFilters(prev => ({ ...prev, [keyOrObjOrFn]: value }));
        }
    };

    const headerTotalCount = debouncedSearch
        ? data.length
        : listTotalCount;

    return {
        paginatedData: data,
        counts: stats,
        latestBatchTime,
        teamMembers,
        loading,
        error,

        refreshData: () => {
            setStatsFetchError('');
            setListCountError('');
            fetchStats();
            fetchListTotalCount();
            fetchData();
        },

        statsFetchError,
        listCountError,

        currentPage,
        itemsPerPage,
        totalPages,
        totalCount: headerTotalCount,

        setItemsPerPage: handleSetItemsPerPage,
        nextPage: () => setCurrentPage(p => p + 1),
        prevPage: () => setCurrentPage(p => Math.max(1, p - 1)),

        activeTab,
        setActiveTab,
        pipelineSegment,
        setPipelineSegment,
        searchQuery,
        setSearchQuery,
        filters,
        setFilters: handleSetFilters
    };
}
