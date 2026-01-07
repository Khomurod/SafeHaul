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

        try {
            // A. Fetch Recent Companies (Limit 20)
            const companiesQuery = query(collection(db, "companies"), orderBy('createdAt', 'desc'), limit(20));
            const companiesPromise = getDocs(companiesQuery);

            // B. Fetch Recent Users (Limit 50 - users usually smaller set or less critical to paginate immediately)
            const usersPromise = getDocs(query(collection(db, "users"), orderBy('createdAt', 'desc'), limit(50)));

            // C. Fetch Recent Activity (Leads + Apps mixed)
            const leadsQuery = query(collectionGroup(db, 'leads'), orderBy('createdAt', 'desc'), limit(15));
            const appsQuery = query(collectionGroup(db, 'applications'), orderBy('createdAt', 'desc'), limit(15));
            const leadsPromise = getDocs(leadsQuery);
            const appsPromise = getDocs(appsQuery);

            // D. Fetch REAL Total Counts (Server-Side Aggregation)
            const countCompaniesPromise = getCountFromServer(collection(db, "companies"));
            const countUsersPromise = getCountFromServer(collection(db, "users"));
            const countLeadsPromise = getCountFromServer(collectionGroup(db, "leads"));

            const [
                compSnap, userSnap, leadsSnap, appsSnap,
                totalComp, totalUser, totalLeads
            ] = await Promise.all([
                companiesPromise, usersPromise, leadsPromise, appsPromise,
                countCompaniesPromise, countUsersPromise, countLeadsPromise
            ]);

            // Cursors for pagination
            setLastCompanyDoc(compSnap.docs[compSnap.docs.length - 1]);
            setLastAppDoc(appsSnap.docs[appsSnap.docs.length - 1]);
            setLastLeadDoc(leadsSnap.docs[leadsSnap.docs.length - 1]);

            setHasMoreCompanies(compSnap.docs.length === 20);
            setHasMoreApps(appsSnap.docs.length === 15 || leadsSnap.docs.length === 15);

            // --- Process Companies ---
            const companies = [];
            const compMap = new Map();
            compMap.set('general-leads', 'SafeHaul Pool (Unassigned)');

            compSnap.forEach((doc) => {
                const data = doc.data();
                companies.push({ id: doc.id, ...data });
                compMap.set(doc.id, data.companyName);
            });

            // --- Process Users & Fetch Memberships ---
            const initialUsers = userSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Fetch Memberships for these users (Chunked to 10 for 'in' query)
            const userIds = initialUsers.map(u => u.id);
            const membershipMap = new Map(); // userId -> [memberships]

            if (userIds.length > 0) {
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
            }

            const users = initialUsers.map(user => ({
                ...user,
                memberships: membershipMap.get(user.id) || []
            }));

            // --- Process Unified Activity (Apps + Leads) ---
            const processedLeads = leadsSnap.docs.map(doc => {
                const data = doc.data();
                const parentCollection = doc.ref.parent;
                const parentDoc = parentCollection.parent;
                const companyId = parentDoc ? parentDoc.id : 'general-leads';
                return {
                    id: doc.id,
                    ...data,
                    companyId,
                    status: data.status || 'New Lead',
                    sourceType: data.isPlatformLead ? 'Distributed Lead' : 'Direct Lead'
                };
            });

            const processedApps = appsSnap.docs.map(doc => {
                const data = doc.data();
                const parent = doc.ref.parent.parent;
                const companyId = parent ? parent.id : (data.companyId || 'unknown');
                return {
                    id: doc.id,
                    ...data,
                    companyId,
                    status: data.status || 'New Application',
                    sourceType: 'Company App'
                };
            });

            // Merge and Sort Recent Activity
            const combinedActivity = [...processedLeads, ...processedApps].sort((a, b) => {
                const tA = a.createdAt?.seconds || 0;
                const tB = b.createdAt?.seconds || 0;
                return tB - tA;
            });

            setCompanyList(companies);
            setAllCompaniesMap(compMap);
            setUserList(users);
            setAllApplications(combinedActivity);

            setStats({
                companyCount: totalComp.data().count,
                userCount: totalUser.data().count,
                appCount: totalLeads.data().count // Using leads count as primary metric
            });

        } catch (e) {
            console.error("Error loading recent data:", e);
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