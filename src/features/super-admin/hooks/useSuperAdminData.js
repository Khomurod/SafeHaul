import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '@lib/firebase';
import { 
    collection, 
    getDocs, 
    collectionGroup, 
    query, 
    orderBy 
} from 'firebase/firestore';
import { loadAllMemberships } from '@features/auth';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function useSuperAdminData() {
    const { showError } = useToast();

    // --- STATE ---
    const [companyList, setCompanyList] = useState([]);
    const [userList, setUserList] = useState([]);
    const [allApplications, setAllApplications] = useState([]);
    const [allCompaniesMap, setAllCompaniesMap] = useState(new Map());

    const [loading, setLoading] = useState(true);
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

    // --- MAIN FETCH FUNCTION ---
    const loadAllData = useCallback(async () => {
        setLoading(true);
        setStatsError({ companies: false, users: false, apps: false });

        console.log("🚀 Starting Super Admin Full Data Fetch...");

        // --- 1. Fetch Companies ---
        const fetchCompanies = async () => {
            try {
                const companies = [];
                const compMap = new Map();
                compMap.set('general-leads', 'SafeHaul Pool (Unassigned)');

                // FIX: Removed orderBy('createdAt') to prevent hiding docs missing that field
                const compQuery = query(collection(db, "companies"));
                const companiesSnap = await getDocs(compQuery);

                companiesSnap.forEach((doc) => {
                    const data = doc.data();
                    companies.push({ id: doc.id, ...data });
                    compMap.set(doc.id, data.companyName);
                });

                // Sort in memory (Safe)
                companies.sort((a, b) => {
                    const tA = a.createdAt?.seconds || 0;
                    const tB = b.createdAt?.seconds || 0;
                    return tB - tA;
                });

                return { companies, compMap };
            } catch (e) {
                console.error("Error loading companies:", e);
                setStatsError(prev => ({ ...prev, companies: true }));
                return { companies: [], compMap: new Map() };
            }
        };

        // --- 2. Fetch Users & Memberships ---
        const fetchUsers = async () => {
            try {
                // FIX: Removed orderBy to ensure we get all users
                const userQuery = query(collection(db, "users"));

                const [usersSnap, membershipsSnap] = await Promise.all([
                    getDocs(userQuery),
                    loadAllMemberships(),
                ]);

                const membershipsMap = new Map();
                membershipsSnap.forEach((doc) => {
                    const membership = doc.data();
                    if (!membershipsMap.has(membership.userId)) {
                        membershipsMap.set(membership.userId, []);
                    }
                    membershipsMap.get(membership.userId).push(membership);
                });

                const users = usersSnap.docs.map((userDoc) => ({
                    id: userDoc.id,
                    ...userDoc.data(),
                    memberships: membershipsMap.get(userDoc.id) || [],
                }));

                // Sort in memory
                users.sort((a, b) => {
                    const tA = a.createdAt?.seconds || 0;
                    const tB = b.createdAt?.seconds || 0;
                    return tB - tA;
                });

                return users;
            } catch (e) {
                console.error("Error loading users:", e);
                setStatsError(prev => ({ ...prev, users: true }));
                return [];
            }
        };

        // --- 3. Fetch Unified DB (Apps + Leads + Bulk Drivers) ---
        const fetchApps = async () => {
            try {
                // We keep orderBy here because 'submittedAt' is usually consistent on apps,
                // but if this fails, we can remove it too.
                const appQuery = query(
                    collectionGroup(db, 'applications'), 
                    orderBy('createdAt', 'desc')
                );

                const leadsQuery = query(
                    collectionGroup(db, 'leads'), 
                    orderBy('createdAt', 'desc')
                );

                // Removed orderBy for drivers to be safe
                const driversQuery = query(collection(db, 'drivers'));

                const [appSnap, leadSnap, bulkSnap] = await Promise.all([
                    getDocs(appQuery),
                    getDocs(leadsQuery),
                    getDocs(driversQuery)
                ]);

                // --- Process Applications ---
                const brandedApps = appSnap.docs.map((doc) => {
                    const data = doc.data();
                    const parent = doc.ref.parent.parent;
                    const companyId = parent ? parent.id : data.companyId;
                    return {
                        id: doc.id,
                        ...data,
                        companyId: companyId,
                        sourceType: 'Company App',
                        status: data.status || 'New Application'
                    };
                });

                // --- Process Leads ---
                const allLeads = leadSnap.docs.map((doc) => {
                    const data = doc.data();
                    const parentCollection = doc.ref.parent;
                    const parentDoc = parentCollection.parent;

                    if (!parentDoc) {
                        return {
                            id: doc.id,
                            ...data,
                            companyId: 'general-leads',
                            status: data.status || 'New Lead',
                            sourceType: 'Global Pool'
                        };
                    } else {
                        const isDistributed = data.isPlatformLead === true;
                        return {
                            id: doc.id,
                            ...data,
                            companyId: parentDoc.id,
                            status: data.status || 'New Lead',
                            sourceType: isDistributed ? 'Distributed Lead' : 'Company Import'
                        };
                    }
                });

                // --- Process Bulk Drivers ---
                const existingIds = new Set([...brandedApps, ...allLeads].map(x => x.id));
                const bulkLeads = bulkSnap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(d => d.driverProfile?.isBulkUpload)
                    .filter(d => !existingIds.has(d.id))
                    .map(d => ({
                        id: d.id,
                        ...d.personalInfo,
                        companyId: 'general-leads',
                        status: 'Bulk Lead',
                        sourceType: 'Global Pool',
                        createdAt: d.createdAt
                    }));

                const combined = [...brandedApps, ...allLeads, ...bulkLeads];

                combined.sort((a, b) => {
                    const dateA = a.createdAt?.seconds || a.submittedAt?.seconds || 0;
                    const dateB = b.createdAt?.seconds || b.submittedAt?.seconds || 0;
                    return dateB - dateA;
                });

                return combined;

            } catch (e) {
                console.error("Error loading apps/leads:", e);
                setStatsError(prev => ({ ...prev, apps: true }));
                return [];
            }
        };

        // --- EXECUTE ---
        const [compResult, usersResult, appsResult] = await Promise.all([
            fetchCompanies(),
            fetchUsers(),
            fetchApps()
        ]);

        setCompanyList(compResult.companies);
        setAllCompaniesMap(compResult.compMap);
        setUserList(usersResult);
        setAllApplications(appsResult);

        setStats({
            companyCount: compResult.companies.length,
            userCount: usersResult.length,
            appCount: appsResult.length
        });

        setLoading(false);

    }, [showError]);

    useEffect(() => {
        loadAllData();
    }, [loadAllData]);

    // --- SEARCH LOGIC ---
    const searchResults = useMemo(() => {
        const term = searchQuery.toLowerCase().trim();
        if (!term) return { companies: [], users: [], applications: [] };

        const matchedCompanies = companyList.filter(c => 
            c.companyName?.toLowerCase().includes(term) || 
            c.appSlug?.toLowerCase().includes(term)
        );

        const matchedUsers = userList.filter(u => 
            u.name?.toLowerCase().includes(term) || 
            u.email?.toLowerCase().includes(term)
        );

        const matchedApps = allApplications.filter(a => {
            const fname = a.firstName || a['first-name'] || a.personalInfo?.firstName || '';
            const lname = a.lastName || a['last-name'] || a.personalInfo?.lastName || '';
            const fullName = `${fname} ${lname}`.toLowerCase();
            const email = (a.email || a.personalInfo?.email || '').toLowerCase();
            const phone = (a.phone || a.personalInfo?.phone || '').toLowerCase();
            const id = a.id.toLowerCase();

            return fullName.includes(term) || email.includes(term) || phone.includes(term) || id.includes(term);
        });

        return { companies: matchedCompanies, users: matchedUsers, applications: matchedApps };
    }, [searchQuery, companyList, userList, allApplications]);

    const totalSearchResults = searchResults.companies.length + searchResults.users.length + searchResults.applications.length;

    return {
        companyList,
        userList,
        allApplications,
        allCompaniesMap,
        stats,
        loading,
        statsError,
        searchQuery,
        setSearchQuery,
        searchResults,
        totalSearchResults,
        refreshData: loadAllData
    };
}