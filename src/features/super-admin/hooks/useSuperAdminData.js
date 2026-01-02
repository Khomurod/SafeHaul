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
    where
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

    // --- 1. LOAD RECENT DATA (Optimized: Limit 50) ---
    const loadRecentData = useCallback(async () => {
        setLoading(true);
        setStatsError({ companies: false, users: false, apps: false });
        console.log("🚀 Fetching recent dashboard data (Optimized)...");

        try {
            // A. Fetch Recent Companies (Limit 50)
            const companiesPromise = getDocs(query(collection(db, "companies"), orderBy('createdAt', 'desc'), limit(50)));

            // B. Fetch Recent Users (Limit 50)
            const usersPromise = getDocs(query(collection(db, "users"), orderBy('createdAt', 'desc'), limit(50)));

            // C. Fetch Recent Activity (Leads + Apps mixed)
            const leadsPromise = getDocs(query(collectionGroup(db, 'leads'), orderBy('createdAt', 'desc'), limit(25)));
            const appsPromise = getDocs(query(collectionGroup(db, 'applications'), orderBy('createdAt', 'desc'), limit(25)));

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

    // --- 2. SERVER-SIDE SEARCH (Cloud Function) ---
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

    // --- 3. CONTROLLER ---
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