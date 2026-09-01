// src/features/companies/hooks/useCompanyDashboard.js

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    collection,
    query,
    limit,
    startAfter,
    getDocs,
    getCountFromServer,
} from 'firebase/firestore';
import { db, auth } from '@lib/firebase';
import { isE2ETestMode } from '@lib/runtime/e2eMode';
import {
    classifySearchTerm,
    recordMatchesSearch,
    applyClientSideFilters,
} from './dashboardSearch';
// The Firestore side — constraint planning, the parallel search execution and
// the stats counts — lives in `dashboardQueries.js` since the 2026-09-01
// source-size split. This hook owns state, effects and pagination, and passes
// its current state in as plain arguments.
import {
    buildDashboardConstraints,
    loadDashboardStats,
    runDashboardSearch,
} from './dashboardQueries';
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
            setStats(await loadDashboardStats({ companyId }));
        } catch (e) {
            console.error("Error fetching stats:", e);
            setStatsFetchError(e?.message || 'Could not load dashboard counts.');
        }
    }, [companyId, e2eRecordsForTab]);

    // Same recreation set as before the split: the old useCallback depended on
    // [activeTab, filters] plus builders that recreated on pipelineSegment.
    const buildConstraints = useCallback(
        () => buildDashboardConstraints({ activeTab, pipelineSegment, filters }),
        [activeTab, pipelineSegment, filters],
    );

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

    // One expression, so the promise the caller awaits is the module's own
    // (the `CA-9` wrapper shape). Same recreation set as the original.
    const runSearchQuery = useCallback(
        (term) => runDashboardSearch({ companyId, activeTab, term, filterContext: clientFilterContext() }),
        [companyId, activeTab, clientFilterContext],
    );

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
