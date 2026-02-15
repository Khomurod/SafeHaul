import { useState, useCallback, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '@lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';

export function useLeadPool() {
    // --- State ---
    const [supplyData, setSupplyData] = useState(null);
    const [badLeadsData, setBadLeadsData] = useState(null);
    const [companyDistData, setCompanyDistData] = useState([]);
    const [loadingSupply, setLoadingSupply] = useState(true);
    const [loadingBadLeads, setLoadingBadLeads] = useState(true);
    const [loadingCompanies, setLoadingCompanies] = useState(true);
    const [error, setError] = useState(null);

    // Action loading states
    const [distributing, setDistributing] = useState(false);
    const [cleaning, setCleaning] = useState(false);
    const [recalling, setRecalling] = useState(false);
    const [unlocking, setUnlocking] = useState(false);
    const [migrating, setMigrating] = useState(false);

    // Maintenance mode
    const [maintenanceMode, setMaintenanceMode] = useState(false);
    const [savingMaintenance, setSavingMaintenance] = useState(false);

    // Toggle loading state for individual companies
    const [togglingCompany, setTogglingCompany] = useState(null);

    // --- Fetch Data ---
    const fetchSupplyData = useCallback(async () => {
        setLoadingSupply(true);
        try {
            const fn = httpsCallable(functions, 'getLeadSupplyAnalytics');
            const result = await fn();
            setSupplyData(result.data);
        } catch (err) {
            console.error("Supply analytics error:", err);
            setError("Failed to load supply data.");
        } finally {
            setLoadingSupply(false);
        }
    }, []);

    const fetchBadLeadsData = useCallback(async () => {
        setLoadingBadLeads(true);
        try {
            const fn = httpsCallable(functions, 'getBadLeadsAnalytics');
            const result = await fn();
            setBadLeadsData(result.data);
        } catch (err) {
            console.error("Bad leads analytics error:", err);
        } finally {
            setLoadingBadLeads(false);
        }
    }, []);

    const fetchCompanyDistribution = useCallback(async () => {
        setLoadingCompanies(true);
        try {
            const fn = httpsCallable(functions, 'getCompanyDistributionStatus');
            const result = await fn();
            setCompanyDistData(result.data?.companies || []);
        } catch (err) {
            console.error("Company distribution error:", err);
        } finally {
            setLoadingCompanies(false);
        }
    }, []);

    const refreshAll = useCallback(() => {
        fetchSupplyData();
        fetchBadLeadsData();
        fetchCompanyDistribution();
    }, [fetchSupplyData, fetchBadLeadsData, fetchCompanyDistribution]);

    // Listen for maintenance mode
    useEffect(() => {
        const unsub = onSnapshot(doc(db, "system_settings", "distribution"), (doc) => {
            if (doc.exists()) {
                setMaintenanceMode(doc.data().maintenance_mode || false);
            }
        });
        return () => unsub();
    }, []);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    // --- Actions ---

    const toggleCompanyActive = async (companyId, companyName, currentStatus) => {
        const action = currentStatus ? 'deactivate' : 'activate';
        if (!window.confirm(`${action.toUpperCase()} "${companyName}"?\n\n${currentStatus
            ? 'This company will stop receiving platform leads.'
            : 'This company will start receiving platform leads.'}`)) {
            return;
        }

        setTogglingCompany(companyId);
        try {
            await updateDoc(doc(db, 'companies', companyId), {
                isActive: !currentStatus
            });
            // Refresh the list
            fetchCompanyDistribution();
        } catch (err) {
            alert(`Failed to ${action} company: ${err.message}`);
        } finally {
            setTogglingCompany(null);
        }
    };

    const handleDistribute = async () => {
        if (!window.confirm("Force distribute leads to all companies NOW? This will start a new distribution round.")) return;
        setDistributing(true);
        try {
            const fn = httpsCallable(functions, 'distributeDailyLeads', { timeout: 600000 });
            const result = await fn();
            alert(`✅ Distribution complete!\n\n${result.data.details?.join('\n') || result.data.message}`);
            refreshAll();
        } catch (err) {
            alert(`❌ Distribution failed: ${err.message}`);
        } finally {
            setDistributing(false);
        }
    };

    const handleCleanup = async () => {
        if (!window.confirm("Remove bad/test leads from the pool? This cannot be undone.")) return;
        setCleaning(true);
        try {
            const fn = httpsCallable(functions, 'cleanupBadLeads', { timeout: 540000 });
            const result = await fn();
            alert(`✅ Cleanup complete!\n\n${result.data.message}`);
            refreshAll();
        } catch (err) {
            alert(`❌ Cleanup failed: ${err.message}`);
        } finally {
            setCleaning(false);
        }
    };

    const handleRecall = async () => {
        if (!window.confirm("⚠️ RECALL ALL PLATFORM LEADS?\n\nThis will DELETE all SafeHaul Network leads from ALL companies and unlock them in the global pool.\n\nThis action cannot be undone!")) return;
        setRecalling(true);
        try {
            const fn = httpsCallable(functions, 'recallAllPlatformLeads', { timeout: 600000 });
            const result = await fn();
            alert(`✅ Recall complete!\n\nDeleted: ${result.data.deletedCount} leads\nUnlocked: ${result.data.unlockedCount} pool leads`);
            refreshAll();
        } catch (err) {
            alert(`❌ Recall failed: ${err.message}`);
        } finally {
            setRecalling(false);
        }
    };

    const handleForceUnlock = async () => {
        if (!window.confirm("Unlock ALL leads in the pool? This makes every lead available for distribution.")) return;
        setUnlocking(true);
        try {
            const fn = httpsCallable(functions, 'forceUnlockPool', { timeout: 540000 });
            const result = await fn();
            alert(`✅ Pool unlocked!\n\n${result.data.message}`);
            refreshAll();
        } catch (err) {
            alert(`❌ Unlock failed: ${err.message}`);
        } finally {
            setUnlocking(false);
        }
    };

    const handleMigrate = async () => {
        if (!window.confirm("Migrate drivers collection to leads pool? This imports missing drivers.")) return;
        setMigrating(true);
        try {
            const fn = httpsCallable(functions, 'migrateDriversToLeads', { timeout: 540000 });
            const result = await fn();
            alert(`✅ Migration complete!\n\n${result.data.message}`);
            refreshAll();
        } catch (err) {
            alert(`❌ Migration failed: ${err.message}`);
        } finally {
            setMigrating(false);
        }
    };

    const toggleMaintenance = async () => {
        setSavingMaintenance(true);
        try {
            await setDoc(doc(db, "system_settings", "distribution"), {
                maintenance_mode: !maintenanceMode
            }, { merge: true });
        } catch (err) {
            alert(`Failed to toggle maintenance: ${err.message}`);
        } finally {
            setSavingMaintenance(false);
        }
    };

    return {
        supplyData,
        badLeadsData,
        companyDistData,
        loadingSupply,
        loadingBadLeads,
        loadingCompanies,
        error,
        distributing,
        cleaning,
        recalling,
        unlocking,
        migrating,
        maintenanceMode,
        savingMaintenance,
        togglingCompany,
        refreshAll,
        toggleCompanyActive,
        handleDistribute,
        handleCleanup,
        handleRecall,
        handleForceUnlock,
        handleMigrate,
        toggleMaintenance
    };
}
