// src/features/super-admin/components/LeadPoolView.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '@lib/firebase';
import { doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import {
    Loader2,
    RefreshCw,
    Database,
    Users,
    Lock,
    AlertTriangle,
    Play,
    Trash2,
    RotateCcw,
    Unlock,
    Upload,
    Pause,
    TrendingUp,
    TrendingDown,
    CheckCircle,
    XCircle
} from 'lucide-react';

// --- STAT CARD COMPONENT ---
function StatCard({ title, value, icon: Icon, color = 'blue', loading = false }) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600 border-blue-100',
        green: 'bg-green-50 text-green-600 border-green-100',
        orange: 'bg-orange-50 text-orange-600 border-orange-100',
        red: 'bg-red-50 text-red-600 border-red-100',
        purple: 'bg-purple-50 text-purple-600 border-purple-100'
    };

    return (
        <div className={`p-5 rounded-2xl border-2 ${colorClasses[color]} transition-all hover:shadow-md`}>
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider opacity-60">{title}</p>
                    {loading ? (
                        <Loader2 className="animate-spin mt-2" size={24} />
                    ) : (
                        <p className="text-3xl font-black mt-1">{value?.toLocaleString() || 0}</p>
                    )}
                </div>
                <div className={`p-2 rounded-lg bg-white/50`}>
                    <Icon size={24} />
                </div>
            </div>
        </div>
    );
}

// --- ACTION BUTTON COMPONENT ---
function ActionButton({ label, icon: Icon, onClick, loading, disabled, variant = 'default', danger = false }) {
    const baseClasses = "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all text-sm";
    const variants = {
        default: danger
            ? "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300"
            : "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
        outline: danger
            ? "border-2 border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
            : "border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50",
        warning: "bg-orange-500 text-white hover:bg-orange-600 disabled:bg-orange-300"
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled || loading}
            className={`${baseClasses} ${variants[variant]}`}
        >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Icon size={18} />}
            {label}
        </button>
    );
}

// --- MAIN COMPONENT ---
export function LeadPoolView({ onDataUpdate }) {
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

    // --- Toggle Company Active Status ---
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

    // --- Action Handlers ---
    const handleDistribute = async () => {
        if (!window.confirm("Force distribute leads to all companies NOW? This will start a new distribution round.")) return;
        setDistributing(true);
        try {
            const fn = httpsCallable(functions, 'distributeDailyLeads', { timeout: 600000 });
            const result = await fn();
            alert(`✅ Distribution complete!\n\n${result.data.details?.join('\n') || result.data.message}`);
            refreshAll();
            onDataUpdate?.();
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
            onDataUpdate?.();
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

    // --- Derived Values ---
    const isDeficit = supplyData?.health?.status === 'deficit';
    const anyActionLoading = distributing || cleaning || recalling || unlocking || migrating;

    return (
        <div className="space-y-6">
            {/* HEADER */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                        <Database className="text-blue-600" size={28} />
                        Lead Pool Management
                    </h1>
                    <p className="text-gray-500 mt-1">Manage the global SafeHaul Network lead distribution system</p>
                </div>
                <button
                    onClick={refreshAll}
                    disabled={loadingSupply}
                    className="p-3 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 transition-all shadow-sm"
                >
                    <RefreshCw size={20} className={loadingSupply ? 'animate-spin text-blue-600' : 'text-gray-600'} />
                </button>
            </div>

            {/* ERROR STATE */}
            {error && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 flex items-center gap-2">
                    <AlertTriangle size={20} />
                    {error}
                </div>
            )}

            {/* MAINTENANCE MODE BANNER */}
            {maintenanceMode && (
                <div className="p-4 bg-red-100 border-2 border-red-300 rounded-xl flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Pause className="text-red-600" size={24} />
                        <div>
                            <p className="font-bold text-red-800">Distribution Paused</p>
                            <p className="text-sm text-red-600">Maintenance mode is ON. No leads will be distributed.</p>
                        </div>
                    </div>
                    <button
                        onClick={toggleMaintenance}
                        disabled={savingMaintenance}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition-all"
                    >
                        {savingMaintenance ? <Loader2 className="animate-spin" size={18} /> : 'Resume'}
                    </button>
                </div>
            )}

            {/* STATS CARDS */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Total in Pool"
                    value={supplyData?.supply?.totalInPool}
                    icon={Database}
                    color="blue"
                    loading={loadingSupply}
                />
                <StatCard
                    title="Available Now"
                    value={supplyData?.supply?.availableNow}
                    icon={isDeficit ? TrendingDown : TrendingUp}
                    color={isDeficit ? 'red' : 'green'}
                    loading={loadingSupply}
                />
                <StatCard
                    title="Locked"
                    value={supplyData?.supply?.locked}
                    icon={Lock}
                    color="orange"
                    loading={loadingSupply}
                />
                <StatCard
                    title="Bad Leads"
                    value={badLeadsData?.stats?.totalBad}
                    icon={AlertTriangle}
                    color="red"
                    loading={loadingBadLeads}
                />
            </div>

            {/* HEALTH STATUS */}
            {supplyData && (
                <div className={`p-5 rounded-2xl border-2 ${isDeficit ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            {isDeficit ? (
                                <XCircle className="text-red-600" size={28} />
                            ) : (
                                <CheckCircle className="text-green-600" size={28} />
                            )}
                            <div>
                                <p className={`font-bold text-lg ${isDeficit ? 'text-red-800' : 'text-green-800'}`}>
                                    {isDeficit ? 'SUPPLY SHORTAGE' : 'HEALTHY SURPLUS'}
                                </p>
                                <p className={`text-sm ${isDeficit ? 'text-red-600' : 'text-green-600'}`}>
                                    Daily Demand: {supplyData.demand.totalDailyQuota} | Available: {supplyData.supply.availableNow} | Gap: {supplyData.health.gap > 0 ? '+' : ''}{supplyData.health.gap}
                                </p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-sm text-gray-500">{supplyData.demand.companiesCount} active companies</p>
                            <p className="text-sm text-gray-500">{supplyData.distribution.totalDistributedInCirculation} leads in circulation</p>
                        </div>
                    </div>
                </div>
            )}

            {/* ACTION BUTTONS */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Actions</h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                    <ActionButton
                        label="Distribute Now"
                        icon={Play}
                        onClick={handleDistribute}
                        loading={distributing}
                        disabled={anyActionLoading || maintenanceMode}
                    />
                    <ActionButton
                        label="Cleanup Bad Leads"
                        icon={Trash2}
                        onClick={handleCleanup}
                        loading={cleaning}
                        disabled={anyActionLoading}
                        variant="outline"
                    />
                    <ActionButton
                        label="Force Unlock Pool"
                        icon={Unlock}
                        onClick={handleForceUnlock}
                        loading={unlocking}
                        disabled={anyActionLoading}
                        variant="outline"
                    />
                    <ActionButton
                        label="Migrate Drivers"
                        icon={Upload}
                        onClick={handleMigrate}
                        loading={migrating}
                        disabled={anyActionLoading}
                        variant="outline"
                    />
                    <ActionButton
                        label={maintenanceMode ? "Resume Distribution" : "Pause Distribution"}
                        icon={maintenanceMode ? Play : Pause}
                        onClick={toggleMaintenance}
                        loading={savingMaintenance}
                        disabled={anyActionLoading}
                        variant={maintenanceMode ? "default" : "warning"}
                    />
                    <ActionButton
                        label="Recall All Leads"
                        icon={RotateCcw}
                        onClick={handleRecall}
                        loading={recalling}
                        disabled={anyActionLoading}
                        variant="outline"
                        danger
                    />
                </div>
            </div>

            {/* BAD LEADS BREAKDOWN */}
            {badLeadsData && (
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <AlertTriangle className="text-orange-500" size={20} />
                        Bad Leads Analysis
                    </h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
                        <div className="text-center p-3 bg-red-50 rounded-xl">
                            <p className="text-2xl font-bold text-red-600">{badLeadsData.stats.missingContact}</p>
                            <p className="text-xs text-gray-500">No Contact Info</p>
                        </div>
                        <div className="text-center p-3 bg-red-50 rounded-xl">
                            <p className="text-2xl font-bold text-red-600">{badLeadsData.stats.testData}</p>
                            <p className="text-xs text-gray-500">Test Data</p>
                        </div>
                        <div className="text-center p-3 bg-orange-50 rounded-xl">
                            <p className="text-2xl font-bold text-orange-600">{badLeadsData.stats.missingNames}</p>
                            <p className="text-xs text-gray-500">Missing Names</p>
                        </div>
                        <div className="text-center p-3 bg-orange-50 rounded-xl">
                            <p className="text-2xl font-bold text-orange-600">{badLeadsData.stats.placeholderEmails}</p>
                            <p className="text-xs text-gray-500">Placeholder Emails</p>
                        </div>
                        <div className="text-center p-3 bg-yellow-50 rounded-xl">
                            <p className="text-2xl font-bold text-yellow-600">{badLeadsData.stats.shortPhones}</p>
                            <p className="text-xs text-gray-500">Short Phones</p>
                        </div>
                        <div className="text-center p-3 bg-purple-50 rounded-xl">
                            <p className="text-2xl font-bold text-purple-600">{badLeadsData.stats.duplicatePhones}</p>
                            <p className="text-xs text-gray-500">Duplicates</p>
                        </div>
                    </div>
                </div>
            )}

            {/* POOL DISTRIBUTION INFO */}
            {supplyData && (
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                    <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <Users className="text-blue-600" size={20} />
                        Distribution Overview
                    </h3>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 text-center">
                        <div className="p-4 bg-gray-50 rounded-xl">
                            <p className="text-3xl font-bold text-gray-900">{supplyData.demand.companiesCount}</p>
                            <p className="text-sm text-gray-500">Active Companies</p>
                        </div>
                        <div className="p-4 bg-gray-50 rounded-xl">
                            <p className="text-3xl font-bold text-gray-900">{supplyData.demand.totalDailyQuota}</p>
                            <p className="text-sm text-gray-500">Daily Demand</p>
                        </div>
                        <div className="p-4 bg-blue-50 rounded-xl">
                            <p className="text-3xl font-bold text-blue-600">{supplyData.distribution.totalDistributedInCirculation}</p>
                            <p className="text-sm text-gray-500">Platform Leads</p>
                        </div>
                        <div className="p-4 bg-purple-50 rounded-xl">
                            <p className="text-3xl font-bold text-purple-600">{supplyData.distribution.totalPrivateUploads}</p>
                            <p className="text-sm text-gray-500">Private Uploads</p>
                        </div>
                    </div>
                </div>
            )}

            {/* COMPANY DISTRIBUTION STATUS */}
            <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                    <Users className="text-blue-600" size={20} />
                    Company Distribution Status
                </h3>

                {loadingCompanies ? (
                    <div className="flex justify-center py-8">
                        <Loader2 className="animate-spin text-blue-600" size={32} />
                    </div>
                ) : companyDistData.length === 0 ? (
                    <p className="text-gray-500 text-center py-8">No company data available</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b border-gray-200">
                                    <th className="text-left py-3 px-4 font-semibold text-gray-700 text-sm">Company</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 text-sm">Status</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 text-sm">Daily Quota</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 text-sm">Platform Leads</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 text-sm">Private Leads</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 text-sm">Last Distribution</th>
                                    <th className="text-center py-3 px-4 font-semibold text-gray-700 text-sm">Next in</th>
                                </tr>
                            </thead>
                            <tbody>
                                {companyDistData.map((company, idx) => {
                                    const isActive = company.isActive;
                                    const nextDistTime = company.nextDistribution;
                                    const lastDistTime = company.lastDistribution;

                                    return (
                                        <tr key={company.id} className={`border-b border-gray-100 hover:bg-gray-50 ${!isActive ? 'opacity-50' : ''}`}>
                                            <td className="py-3 px-4">
                                                <div>
                                                    <p className="font-semibold text-gray-900">{company.companyName}</p>
                                                    <p className="text-xs text-gray-500">{company.slug}</p>
                                                </div>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleCompanyActive(company.id, company.companyName, isActive);
                                                    }}
                                                    disabled={togglingCompany === company.id}
                                                    className="group relative"
                                                    title={`Click to ${isActive ? 'deactivate' : 'activate'} this company`}
                                                >
                                                    {togglingCompany === company.id ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 text-blue-600 text-xs font-semibold">
                                                            <Loader2 size={12} className="animate-spin" />
                                                            Updating...
                                                        </span>
                                                    ) : isActive ? (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-green-100 text-green-700 text-xs font-semibold hover:bg-green-200 transition-colors cursor-pointer">
                                                            <CheckCircle size={12} />
                                                            Active
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-100 text-red-600 text-xs font-semibold hover:bg-red-200 transition-colors cursor-pointer">
                                                            <XCircle size={12} />
                                                            Inactive
                                                        </span>
                                                    )}
                                                </button>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className="font-semibold text-gray-900">{company.dailyQuota || 0}</span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className="font-semibold text-blue-600">{company.platformLeadsCount || 0}</span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                <span className="font-semibold text-purple-600">{company.privateLeadsCount || 0}</span>
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                {lastDistTime ? (
                                                    <div className="text-sm">
                                                        <p className="text-gray-700 font-medium">{lastDistTime.date}</p>
                                                        <p className="text-gray-500 text-xs">{lastDistTime.time}</p>
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400 text-sm">Never</span>
                                                )}
                                            </td>
                                            <td className="py-3 px-4 text-center">
                                                {isActive && nextDistTime ? (
                                                    <div className="text-sm">
                                                        <p className="text-gray-700 font-semibold">{nextDistTime.countdown}</p>
                                                        <p className="text-gray-500 text-xs">{nextDistTime.exactTime}</p>
                                                    </div>
                                                ) : (
                                                    <span className="text-gray-400 text-sm">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

export default LeadPoolView;
