// src/features/companies/hooks/useCompanyDashboard.js

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    collection,
    query,
    orderBy,
    limit,
    startAfter,
    getDocs,
    where,
    getCountFromServer
} from 'firebase/firestore';
import { db, auth } from '@lib/firebase';
import { normalizePhone } from '@shared/utils/helpers';

export function useCompanyDashboard(companyId) {
    // --- State ---
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [latestBatchTime, setLatestBatchTime] = useState(null);
    const [stats, setStats] = useState({
        applications: 0,
        platformLeads: 0,
        companyLeads: 0,
        myLeads: 0
    });

    // --- Pagination State ---
    const [itemsPerPage, setItemsPerPage] = useState(20);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // FIX: Use Ref for cursors to prevent re-render loops
    const lastVisibleDocsRef = useRef({});

    // --- Filter & Search State ---
    const [activeTab, setActiveTab] = useState('applications');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [filters, setFilters] = useState({
        state: '',
        driverType: '',
        dob: '',
        assignee: ''
    });

    // --- Debounce Search ---
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(searchQuery);
        }, 800);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // --- 1. Fetch Stats (Counts) ---
    const fetchStats = useCallback(async () => {
        if (!companyId) return;
        try {
            // Applications
            const appsRef = collection(db, "companies", companyId, "applications");
            const appsSnap = await getCountFromServer(appsRef);

            // Leads
            const leadsRef = collection(db, "companies", companyId, "leads");

            const qPlatform = query(leadsRef, where("isPlatformLead", "==", true));
            const platformSnap = await getCountFromServer(qPlatform);

            const qCompany = query(leadsRef, where("isPlatformLead", "==", false));
            const companySnap = await getCountFromServer(qCompany);

            let myCountVal = 0;
            if (auth.currentUser) {
                const qMy = query(leadsRef, where("assignedTo", "==", auth.currentUser.uid));
                const mySnap = await getCountFromServer(qMy);
                myCountVal = mySnap.data().count;
            }

            setStats({
                applications: appsSnap.data().count,
                platformLeads: platformSnap.data().count,
                companyLeads: companySnap.data().count,
                myLeads: myCountVal
            });
        } catch (e) {
            console.error("Error fetching stats:", e);
        }
    }, [companyId]);

    // --- 2. Build Query Constraints ---
    const buildConstraints = (baseRef, isSearchMode = false) => {
        let constraints = [];

        // A. Tab Constraints
        if (activeTab === 'applications') {
            if (!isSearchMode) {
                // FIX: Changed from 'submittedAt' to 'createdAt' to ensure all docs (even imports) appear
                // Note: Ensure your applications actually have 'createdAt'. If not, we might need a composite check.
                constraints.push(orderBy("createdAt", "desc"));
            }
        } else {
            // Leads Logic
            if (activeTab === 'find_driver') {
                constraints.push(where("isPlatformLead", "==", true));
                if (!isSearchMode) constraints.push(orderBy("distributedAt", "desc"));
            } else if (activeTab === 'company_leads') {
                constraints.push(where("isPlatformLead", "==", false));
                if (!isSearchMode) constraints.push(orderBy("createdAt", "desc"));
            } else if (activeTab === 'my_leads' && auth.currentUser) {
                constraints.push(where("assignedTo", "==", auth.currentUser.uid));
                if (!isSearchMode) constraints.push(orderBy("createdAt", "desc"));
            }
        }

        // B. Filter Constraints
        if (filters.state) {
            constraints.push(where("state", "==", filters.state.toUpperCase()));
        }
        if (filters.driverType) {
            constraints.push(where("driverType", "array-contains", filters.driverType));
        }
        if (filters.assignee) {
            constraints.push(where("assignedTo", "==", filters.assignee));
        }

        return constraints;
    };

    // --- 3. Main Data Fetcher ---
    const fetchData = useCallback(async () => {
        if (!companyId) return;

        setLoading(true);
        setError('');

        try {
            const collectionName = activeTab === 'applications' ? 'applications' : 'leads';
            const baseRef = collection(db, "companies", companyId, collectionName);

            let q;
            const isSearch = !!debouncedSearch;

            if (isSearch) {
                // --- SEARCH MODE ---
                const term = debouncedSearch.trim();
                let searchConstraints = buildConstraints(baseRef, true);

                const isPhone = /^[0-9+() -]{7,}$/.test(term);
                const isEmail = term.includes('@');

                if (isEmail) {
                    searchConstraints.push(where("email", "==", term.toLowerCase()));
                } else if (isPhone) {
                    searchConstraints.push(where("phone", "==", term));
                } else {
                    const termFixed = term.charAt(0).toUpperCase() + term.slice(1);
                    searchConstraints.push(where("lastName", ">=", termFixed));
                    searchConstraints.push(where("lastName", "<=", termFixed + '\uf8ff'));
                }

                searchConstraints.push(limit(50));
                q = query(baseRef, ...searchConstraints);

            } else {
                // --- BROWSE MODE ---
                let constraints = buildConstraints(baseRef, false);

                // Pagination using Ref
                if (currentPage > 1) {
                    const prevPageLastDoc = lastVisibleDocsRef.current[currentPage - 1];
                    if (prevPageLastDoc) {
                        constraints.push(startAfter(prevPageLastDoc));
                    } else {
                        // Fallback if cursor lost
                        setCurrentPage(1);
                        return;
                    }
                }

                constraints.push(limit(itemsPerPage));
                q = query(baseRef, ...constraints);
            }

            // EXECUTE QUERY
            const snapshot = await getDocs(q);
            const newData = snapshot.docs.map(doc => {
                const d = doc.data();
                return {
                    id: doc.id,
                    companyId,
                    ...d,
                    // FIX: Explicitly map fields for DashboardTable
                    lastCall: d.lastContactedAt || d.lastCall,
                    lastCallOutcome: d.lastCallOutcome
                };
            });

            setData(newData);

            // Update Cursor Ref (Does not trigger re-render)
            if (!isSearch && snapshot.docs.length > 0) {
                const lastDoc = snapshot.docs[snapshot.docs.length - 1];
                lastVisibleDocsRef.current[currentPage] = lastDoc;
            }

            // Recalculate Total Pages based on Stats
            const currentCount = (activeTab === 'applications') ? stats.applications :
                (activeTab === 'find_driver') ? stats.platformLeads :
                    (activeTab === 'company_leads') ? stats.companyLeads : stats.myLeads;

            setTotalPages(isSearch ? 1 : Math.ceil(currentCount / itemsPerPage) || 1);

        } catch (err) {
            console.error("Dashboard fetch error:", err);

            // Friendly Error for Missing Indexes
            if (err.message && err.message.includes('requires an index')) {
                setError("Missing Index: Please check the browser console for the creation link.");
                console.warn("CLICK THIS LINK TO CREATE INDEX:", err);
            } else {
                setError(err.message || "Failed to load data.");
            }
        } finally {
            setLoading(false);
        }
        // Remove 'lastVisibleDocs' and 'fetchData' to prevent loops
    }, [companyId, activeTab, currentPage, itemsPerPage, debouncedSearch, filters, stats]);

    // --- 4. Timer Fetcher (SafeHaul Leads) ---
    useEffect(() => {
        const fetchBatchTime = async () => {
            if (!companyId || activeTab !== 'find_driver') {
                setLatestBatchTime(null);
                return;
            }
            try {
                const leadsRef = collection(db, "companies", companyId, "leads");
                const q = query(
                    leadsRef,
                    where("isPlatformLead", "==", true),
                    orderBy("distributedAt", "desc"),
                    limit(1)
                );
                const snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    const d = snapshot.docs[0].data();
                    setLatestBatchTime(d.distributedAt || d.createdAt);
                } else {
                    setLatestBatchTime(null);
                }
            } catch (e) {
                setLatestBatchTime(null);
            }
        };
        fetchBatchTime();
    }, [companyId, activeTab]);

    // --- 5. Init & Refresh Effects ---

    // A. Fetch Stats on Mount/Change
    useEffect(() => {
        fetchStats();
    }, [companyId, fetchStats]);

    // B. Reset Pagination on Tab/Filter Change
    useEffect(() => {
        setData([]);
        lastVisibleDocsRef.current = {}; // Reset ref
        setCurrentPage(1);
    }, [activeTab, companyId, debouncedSearch, filters]);

    // C. Trigger Data Fetch
    // Only runs when these specific dependencies change
    useEffect(() => {
        fetchData();
    }, [companyId, activeTab, currentPage, itemsPerPage, debouncedSearch, filters, fetchData]);

    // --- 6. Handlers ---
    const handleSetItemsPerPage = (num) => {
        setItemsPerPage(num);
        setCurrentPage(1);
        lastVisibleDocsRef.current = {};
    };

    const handleSetFilters = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    return {
        // Data
        paginatedData: data,
        counts: stats,
        latestBatchTime,
        loading,
        error,

        // Actions
        refreshData: () => {
            fetchStats();
            fetchData();
        },

        // Pagination
        currentPage,
        itemsPerPage,
        totalPages,
        totalCount: (activeTab === 'applications') ? stats.applications :
            (activeTab === 'find_driver') ? stats.platformLeads :
                (activeTab === 'company_leads') ? stats.companyLeads : stats.myLeads,

        setItemsPerPage: handleSetItemsPerPage,
        nextPage: () => setCurrentPage(p => p + 1),
        prevPage: () => setCurrentPage(p => Math.max(1, p - 1)),

        // State Controls
        activeTab,
        setActiveTab,
        searchQuery,
        setSearchQuery,
        filters,
        setFilters: handleSetFilters
    };
}