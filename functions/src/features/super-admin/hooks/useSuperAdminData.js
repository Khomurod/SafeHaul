// src/features/super-admin/hooks/useSuperAdminData.js

import { useState, useEffect, useMemo, useCallback } from 'react';
import { db, functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import {
    collection,
    getDocs,
    collectionGroup,
    query,
    orderBy,
    limit,
    getCountFromServer,
    where,
    startAfter
} from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function useSuperAdminData() {
    const { showError } = useToast();

    // --- STATE ---
    const [companyList, setCompanyList] = useState([]);
    const [userList, setUserList] = useState([]);
    const [allApplications, setAllApplications] = useState([]); // Unified Leads/Apps
    const [allCompaniesMap, setAllCompaniesMap] = useState(new Map());

    const [loading, setLoading] = useState(true);
    const [isSearching, setIsSearching] = useState(false);

    // Pagination Cursors
    const [lastCompanyDoc, setLastCompanyDoc] = useState(null);
    const [lastAppDoc, setLastAppDoc] = useState(null);
    const [lastLeadDoc, setLastLeadDoc] = useState(null);

    const [hasMoreCompanies, setHasMoreCompanies] = useState(true);
    const [hasMoreApps, setHasMoreApps] = useState(true);

    // Preserved Error State
    const [statsError, setStatsError] = useState({
        companies: false,
        users: false,
        apps: false,
    });

    const [stats, setStats] = useState({
        companyCount: 0,
        userCount: 0,
        appCount: 0
    });

    const [searchQuery, setSearchQuery] = useState('');

    // --- 1. LOAD RECENT DATA (Initial Paginated Fetch) ---
    const loadRecentData = useCallback(async () => {
        setLoading(true);
        setStatsError({ companies: false, users: false, apps: false });
        console.log("🚀 Fetching initial dashboard data (Paginated)...");

        // Helper to safely fetch with logging
        const safeFetch = async (promise, label, fallback = []) => {
            try {
                const res = await promise;
                return { success: true, data: res };
            } catch (err) {
                console.error(`❌ Error fetching ${label}:`, err);
                return { success: false, error: err, data: fallback };
            }
        };

        try {
            // A. Prepare Queries
            const companiesQuery = query(collection(db, "companies"), orderBy('createdAt', 'desc'), limit(20));
            const usersQuery = query(collection(db, "users"), orderBy('createdAt', 'desc'), limit(50));
            const leadsQuery = query(collectionGroup(db, 'leads'), orderBy('createdAt', 'desc'), limit(15));
            const appsQuery = query(collectionGroup(db, 'applications'), orderBy('createdAt', 'desc'), limit(15));

            // B. Execute Fetches Independently (Parallel)
            const [
                compResult,
                userResult,
                leadsResult,
                appsResult,
                countCompResult,
                countUserResult,
                countLeadsResult
            ] = await Promise.all([
                safeFetch(getDocs(companiesQuery), "Companies"),
                safeFetch(getDocs(usersQuery), "Users"),
                safeFetch(getDocs(leadsQuery), "Leads"),
                safeFetch(getDocs(appsQuery), "Applications"),
                safeFetch(getCountFromServer(collection(db, "companies")), "Count Companies", { data: () => ({ count: 0 }) }),
                safeFetch(getCountFromServer(collection(db, "users")), "Count Users", { data: () => ({ count: 0 }) }),
                safeFetch(getCountFromServer(collectionGroup(db, "leads")), "Count Leads", { data: () => ({ count: 0 }) })
            ]);

            // C. Handle Errors Flags
            setStatsError({
                companies: !compResult.success,
                users: !userResult.success,
                apps: !leadsResult.success && !appsResult.success
            });

            // D. Process Companies
            if (compResult.success) {
                const companies = [];
                const compMap = new Map();
                compMap.set('general-leads', 'SafeHaul Pool (Unassigned)');

                compResult.data.forEach((doc) => {
                    const data = doc.data();
                    companies.push({ id: doc.id, ...data });
                    compMap.set(doc.id, data.companyName);
                });

                setCompanyList(companies);
                setAllCompaniesMap(compMap);
                setLastCompanyDoc(compResult.data.docs[compResult.data.docs.length - 1]);
                setHasMoreCompanies(compResult.data.docs.length === 20);
            }

            // E. Process Users
            if (userResult.success) {
                const initialUsers = userResult.data.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // Fetch Memberships (Nested Safety)
                const userIds = initialUsers.map(u => u.id);
                const membershipMap = new Map();

                if (userIds.length > 0) {
                    try {
                        const chunks = [];
                        for (let i = 0; i < userIds.length; i += 10) {
                            chunks.push(userIds.slice(i, i + 10));
                        }

                        await Promise.all(chunks.map(async (chunk) => {
                            const q = query(collection(db, "memberships"), where("userId", "in", chunk));
                            const snap = await getDocs(q);
                            snap.forEach(doc => {
                                const m = doc.data();
                                const current = membershipMap.get(m.userId) || [];
                                current.push(m);
                                membershipMap.set(m.userId, current);
                            });
                        }));
                    } catch (memErr) {
                        console.error("⚠️ Error fetching memberships:", memErr);
                    }
                }

                const users = initialUsers.map(user => ({
                    ...user,
                    memberships: membershipMap.get(user.id) || []
                }));
                setUserList(users);
            }

            // F. Process Unified Activity
            let combinedActivity = [];

            if (leadsResult.success) {
                const processedLeads = leadsResult.data.docs.map(doc => {
                    const data = doc.data();
                    // Handle potential permission errors accessing parent details safely
                    let companyId = 'general-leads';
                    try {
                        const parentCollection = doc.ref.parent;
                        const parentDoc = parentCollection.parent;
                        if (parentDoc) companyId = parentDoc.id;
                    } catch (e) { /* ignore ref errors */ }

                    return {
                        id: doc.id,
                        ...data,
                        companyId,
                        status: data.status || 'New Lead',
                        sourceType: data.isPlatformLead ? 'Distributed Lead' : 'Direct Lead'
                    };
                });
                combinedActivity = [...combinedActivity, ...processedLeads];
                setLastLeadDoc(leadsResult.data.docs[leadsResult.data.docs.length - 1]);
            }

            if (appsResult.success) {
                const processedApps = appsResult.data.docs.map(doc => {
                    const data = doc.data();
                    let companyId = data.companyId || 'unknown';
                    try {
                        const parent = doc.ref.parent.parent;
                        if (parent) companyId = parent.id;
                    } catch (e) { /* ignore */ }

                    return {
                        id: doc.id,
                        ...data,
                        companyId,
                        status: data.status || 'New Application',
                        sourceType: 'Company App'
                    };
                });
                combinedActivity = [...combinedActivity, ...processedApps];
                setLastAppDoc(appsResult.data.docs[appsResult.data.docs.length - 1]);
            }

            // Sort Combined
            combinedActivity.sort((a, b) => {
                const tA = a.createdAt?.seconds || 0;
                const tB = b.createdAt?.seconds || 0;
                return tB - tA;
            });

            setAllApplications(combinedActivity);
            setHasMoreApps((leadsResult.success && leadsResult.data.docs.length === 15) ||
                (appsResult.success && appsResult.data.docs.length === 15));


            // G. Update Counts
            setStats({
                companyCount: countCompResult.success ? countCompResult.data.data().count : 0,
                userCount: countUserResult.success ? countUserResult.data.data().count : 0,
                appCount: countLeadsResult.success ? countLeadsResult.data.data().count : 0
            });

        } catch (e) {
            console.error("🔥 Fatal Error loading recent data:", e);
            setStatsError({ companies: true, users: true, apps: true });
            showError("Failed to load dashboard data.");
        } finally {
            setLoading(false);
        }
    }, [showError]);

    // --- 2. LOAD MORE (Pagination Logic) ---
    const loadMore = useCallback(async (type) => {
        if (type === 'companies' && (!lastCompanyDoc || !hasMoreCompanies)) return;
        if (type === 'applications' && (!lastAppDoc && !lastLeadDoc && !hasMoreApps)) return;

        console.log(`📡 Loading more ${type}...`);

        try {
            if (type === 'companies') {
                const q = query(
                    collection(db, "companies"),
                    orderBy('createdAt', 'desc'),
                    startAfter(lastCompanyDoc),
                    limit(20)
                );
                const snap = await getDocs(q);

                if (snap.empty) {
                    setHasMoreCompanies(false);
                    return;
                }

                const newCompanies = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setCompanyList(prev => [...prev, ...newCompanies]);
                setLastCompanyDoc(snap.docs[snap.docs.length - 1]);
                setHasMoreCompanies(snap.docs.length === 20);

                // Update Companies Map
                setAllCompaniesMap(prev => {
                    const newMap = new Map(prev);
                    newCompanies.forEach(c => newMap.set(c.id, c.companyName));
                    return newMap;
                });
            } else if (type === 'applications') {
                // Fetch next batches
                const leadsPromise = lastLeadDoc ? getDocs(query(
                    collectionGroup(db, 'leads'),
                    orderBy('createdAt', 'desc'),
                    startAfter(lastLeadDoc),
                    limit(15)
                )) : Promise.resolve({ docs: [] });

                const appsPromise = lastAppDoc ? getDocs(query(
                    collectionGroup(db, 'applications'),
                    orderBy('createdAt', 'desc'),
                    startAfter(lastAppDoc),
                    limit(15)
                )) : Promise.resolve({ docs: [] });

                const [leadsSnap, appsSnap] = await Promise.all([leadsPromise, appsPromise]);

                if (leadsSnap.docs.length === 0 && appsSnap.docs.length === 0) {
                    setHasMoreApps(false);
                    return;
                }

                // Process new items (Reuse mapping logic)
                const newLeads = leadsSnap.docs.map(doc => {
                    const data = doc.data();
                    const parentDoc = doc.ref.parent.parent;
                    return {
                        id: doc.id,
                        ...data,
                        companyId: parentDoc ? parentDoc.id : 'general-leads',
                        status: data.status || 'New Lead',
                        sourceType: data.isPlatformLead ? 'Distributed Lead' : 'Direct Lead'
                    };
                });

                const newApps = appsSnap.docs.map(doc => {
                    const data = doc.data();
                    const parent = doc.ref.parent.parent;
                    return {
                        id: doc.id,
                        ...data,
                        companyId: parent ? parent.id : (data.companyId || 'unknown'),
                        status: data.status || 'New Application',
                        sourceType: 'Company App'
                    };
                });

                const combined = [...newLeads, ...newApps].sort((a, b) => {
                    const tA = a.createdAt?.seconds || 0;
                    const tB = b.createdAt?.seconds || 0;
                    return tB - tA;
                });

                setAllApplications(prev => [...prev, ...combined]);

                if (leadsSnap.docs.length > 0) setLastLeadDoc(leadsSnap.docs[leadsSnap.docs.length - 1]);
                if (appsSnap.docs.length > 0) setLastAppDoc(appsSnap.docs[appsSnap.docs.length - 1]);

                setHasMoreApps(leadsSnap.docs.length === 15 || appsSnap.docs.length === 15);
            }
        } catch (err) {
            console.error(`Error loading more ${type}:`, err);
            showError(`Failed to load more ${type}.`);
        }
    }, [lastCompanyDoc, lastAppDoc, lastLeadDoc, hasMoreCompanies, hasMoreApps, showError]);

    // --- 3. SERVER-SIDE SEARCH (Cloud Function) ---
    const performServerSearch = useCallback(async (term) => {
        setIsSearching(true);
        setLoading(true);
        console.log(`🔍 Calling Cloud Search for: "${term}"`);

        try {
            const searchFn = httpsCallable(functions, 'searchUnifiedData');
            const result = await searchFn({ query: term });
            const data = result.data.data;

            setCompanyList(data.companies || []);
            setUserList(data.users || []);

            const mappedApps = (data.leads || []).map(l => ({
                id: l.id,
                firstName: l.firstName,
                lastName: l.lastName,
                email: l.email,
                phone: l.phone,
                status: l.status,
                companyId: l.companyId || 'unknown',
                sourceType: 'Search Result',
                createdAt: { seconds: Date.now() / 1000 }
            }));
            setAllApplications(mappedApps);

        } catch (e) {
            console.error("Search failed:", e);
            showError("Search failed. Please try again.");
        } finally {
            setLoading(false);
            setIsSearching(false);
        }
    }, [showError]);

    // --- 4. CONTROLLER ---
    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery && searchQuery.trim().length >= 2) {
                performServerSearch(searchQuery);
            } else {
                if (searchQuery.trim().length === 0) {
                    loadRecentData();
                }
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [searchQuery, loadRecentData, performServerSearch]);

    // --- RETURN (Preserving Interface) ---
    return {
        companyList,
        userList,
        allApplications,
        allCompaniesMap,
        stats,
        loading,
        statsError, // Preserved
        searchQuery,
        setSearchQuery,
        // Pagination
        loadMore,
        hasMoreCompanies,
        hasMoreApps,
        // UI expects this structure for rendering tables
        searchResults: {
            companies: companyList,
            users: userList,
            applications: allApplications
        },
        totalSearchResults: companyList.length + userList.length + allApplications.length,
        refreshData: loadRecentData
    };
}