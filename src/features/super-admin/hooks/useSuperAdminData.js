// src/features/super-admin/hooks/useSuperAdminData.js

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
import { SESSION_KEYS } from '@/context/dataContext/sessionKeys';

function readCachedPlatformCompanyCount() {
    try {
        const raw = localStorage.getItem(SESSION_KEYS.PLATFORM_STATS);
        if (!raw) return 0;
        const parsed = JSON.parse(raw);
        return typeof parsed.companies === 'number' ? parsed.companies : 0;
    } catch {
        return 0;
    }
}

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

    // Database "Load More" concurrency guard. Two fast clicks on the visible
    // control would otherwise both read the same (stale) cursor state, fetch the
    // same batch and append it twice — duplicate records and duplicate React
    // keys. The ref is the real guard: it flips synchronously, before any await,
    // so a second invocation in the same tick is rejected at the handler level
    // rather than only being hidden visually. `loadingMore` is the observable
    // mirror that lets each view disable its button and show an accurate state.
    const loadMoreInFlight = useRef({ companies: false, applications: false });
    const [loadingMore, setLoadingMore] = useState({ companies: false, applications: false });

    // Preserved Error State
    const [statsError, setStatsError] = useState({
        companies: false,
        users: false,
        apps: false,
    });

    const [stats, setStats] = useState({
        companyCount: readCachedPlatformCompanyCount(),
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
                    let companyId = 'unknown';
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
                        sourceType: 'Company Lead'
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
        if (type !== 'companies' && type !== 'applications') return;
        // Reject a duplicate concurrent invocation before touching any cursor.
        if (loadMoreInFlight.current[type]) return;
        if (type === 'companies' && (!lastCompanyDoc || !hasMoreCompanies)) return;
        if (type === 'applications' && (!lastAppDoc && !lastLeadDoc && !hasMoreApps)) return;

        console.log(`📡 Loading more ${type}...`);

        loadMoreInFlight.current[type] = true;
        setLoadingMore(prev => ({ ...prev, [type]: true }));

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
                        companyId: parentDoc ? parentDoc.id : 'unknown',
                        status: data.status || 'New Lead',
                        sourceType: 'Company Lead'
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
        } finally {
            // Always release the guard so a retry is allowed after a failure.
            loadMoreInFlight.current[type] = false;
            setLoadingMore(prev => ({ ...prev, [type]: false }));
        }
    }, [lastCompanyDoc, lastAppDoc, lastLeadDoc, hasMoreCompanies, hasMoreApps, showError]);

    // --- 3. CLIENT-SIDE SEARCH (Direct Firestore) ---
    const performClientSearch = useCallback(async (term) => {
        setIsSearching(true);
        setLoading(true);
        console.log(`🔍 Performing Client Search for: "${term}"`);

        try {
            const queryTerm = term;
            const endTerm = term + '\uf8ff';

            // Parallel queries across main collections
            const companiesQuery = query(
                collection(db, "companies"),
                where('companyName', '>=', queryTerm),
                where('companyName', '<=', endTerm),
                limit(20)
            );

            const usersQuery = query(
                collection(db, "users"),
                where('name', '>=', queryTerm),
                where('name', '<=', endTerm),
                limit(20)
            );

            // Leads use a lowercased 'searchName' field in backend logic
            const leadsQuery = query(
                collectionGroup(db, "leads"),
                where('searchName', '>=', queryTerm.toLowerCase()),
                where('searchName', '<=', queryTerm.toLowerCase() + '\uf8ff'),
                limit(20)
            );

            const [compSnap, userSnap, leadSnap] = await Promise.all([
                getDocs(companiesQuery),
                getDocs(usersQuery),
                getDocs(leadsQuery)
            ]);

            setCompanyList(compSnap.docs.map(d => ({ id: d.id, ...d.data() })));
            setUserList(userSnap.docs.map(d => ({ id: d.id, ...d.data() })));

            const mappedLeads = leadSnap.docs.map(l => {
                const data = l.data();
                return {
                    id: l.id,
                    ...data,
                    companyId: data.companyId || 'unknown',
                    sourceType: 'Search Result',
                    createdAt: data.createdAt || { seconds: Date.now() / 1000 }
                };
            });
            setAllApplications(mappedLeads);

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
                performClientSearch(searchQuery);
            } else {
                if (searchQuery.trim().length === 0) {
                    loadRecentData();
                }
            }
        }, 600);

        return () => clearTimeout(timer);
    }, [searchQuery, loadRecentData, performClientSearch]);

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
        loadingMore,
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