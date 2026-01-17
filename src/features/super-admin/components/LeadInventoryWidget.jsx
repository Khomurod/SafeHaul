import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { Loader2, TrendingUp, TrendingDown, Users, Database, Briefcase, RefreshCw } from 'lucide-react';

export default function LeadInventoryWidget() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchData = async () => {
        setLoading(true);
        setError(null);
        try {
            const fn = httpsCallable(functions, 'getLeadSupplyAnalytics');
            const result = await fn();
            setData(result.data);
        } catch (err) {
            console.error(err);
            setError("Failed to load inventory data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []);

    if (loading) return (
        <div className="p-8 flex flex-col items-center justify-center bg-white rounded-2xl border border-gray-200 shadow-sm h-64">
            <Loader2 className="animate-spin text-blue-600 mb-2" size={32}/>
            <p className="text-gray-400 text-sm font-medium">Analyzing Lead Supply...</p>
        </div>
    );

    if (error) return (
        <div className="p-6 text-red-600 bg-red-50 rounded-2xl border border-red-100 text-center">
            <p className="font-bold">{error}</p>
            <button onClick={fetchData} className="mt-2 text-sm underline hover:text-red-800">Try Again</button>
        </div>
    );

    if (!data) return null;

    const isDeficit = data.health.status === 'deficit';
    const supplyPercent = Math.min(100, Math.round((data.supply.availableNow / (data.demand.totalDailyQuota || 1)) * 100));

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Database className="text-blue-600"/> Supply & Demand
                </h2>
                <button 
                    onClick={fetchData} 
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-full transition-all"
                    title="Refresh Data"
                >
                    <RefreshCw size={18}/>
                </button>
            </div>

            {/* MAIN HEALTH CARD */}
            <div className={`p-6 rounded-2xl border-2 transition-all duration-500 ${isDeficit ? 'border-red-100 bg-gradient-to-br from-red-50 to-white' : 'border-green-100 bg-gradient-to-br from-green-50 to-white'}`}>
                <div className="flex justify-between items-start mb-6">
                    <div>
                        <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${isDeficit ? 'text-red-600' : 'text-green-600'}`}>
                            Market Status
                        </p>
                        <h3 className={`text-3xl font-black ${isDeficit ? 'text-red-900' : 'text-green-900'}`}>
                            {isDeficit ? 'SUPPLY SHORTAGE' : 'HEALTHY SURPLUS'}
                        </h3>
                        <p className="text-sm text-gray-500 mt-1">
                            {isDeficit 
                                ? `You need ${Math.abs(data.health.gap)} more leads to meet today's quotas.` 
                                : `You have enough leads for ${Math.floor(data.supply.availableNow / (data.demand.totalDailyQuota || 1))} days.`}
                        </p>
                    </div>
                    <div className={`p-3 rounded-full shadow-sm ${isDeficit ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'}`}>
                        {isDeficit ? <TrendingDown size={32}/> : <TrendingUp size={32}/>}
                    </div>
                </div>

                {/* Visual Supply Bar */}
                <div className="mb-6">
                    <div className="flex justify-between text-xs font-bold text-gray-500 mb-1">
                        <span>Demand: {data.demand.totalDailyQuota}</span>
                        <span>Supply: {data.supply.availableNow}</span>
                    </div>
                    <div className="w-full h-3 bg-gray-200 rounded-full overflow-hidden">
                        <div 
                            className={`h-full rounded-full transition-all duration-1000 ${isDeficit ? 'bg-red-500' : 'bg-green-500'}`}
                            style={{ width: `${supplyPercent}%` }}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 text-center">
                    <div className="bg-white/80 p-3 rounded-xl border border-gray-100 shadow-sm">
                        <span className="block text-gray-400 text-xs font-bold uppercase">Required</span>
                        <span className="font-black text-gray-900 text-xl">{data.demand.totalDailyQuota}</span>
                    </div>
                    <div className="bg-white/80 p-3 rounded-xl border border-gray-100 shadow-sm">
                        <span className="block text-gray-400 text-xs font-bold uppercase">Available</span>
                        <span className="font-black text-gray-900 text-xl">{data.supply.availableNow}</span>
                    </div>
                    <div className="bg-white/80 p-3 rounded-xl border border-gray-100 shadow-sm">
                        <span className="block text-gray-400 text-xs font-bold uppercase">Net Gap</span>
                        <span className={`font-black text-xl ${isDeficit ? 'text-red-600' : 'text-green-600'}`}>
                            {data.health.gap > 0 ? '+' : ''}{data.health.gap}
                        </span>
                    </div>
                </div>
            </div>

            {/* DETAILED BREAKDOWN GRID */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Global Pool Stats */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                    <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <Users size={18} className="text-blue-600"/> Global Pool
                    </h4>
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Total Leads in DB</span>
                            <span className="font-medium text-gray-900">{data.supply.totalInPool}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Currently Locked (In Use)</span>
                            <span className="font-medium text-orange-600">{data.supply.locked}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Fresh / Unlocked</span>
                            <span className="font-bold text-green-600">{data.supply.availableNow}</span>
                        </div>
                    </div>
                </div>

                {/* Company Usage Stats */}
                <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                    <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                        <Briefcase size={18} className="text-purple-600"/> Distribution
                    </h4>
                    <div className="space-y-3">
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Active Companies</span>
                            <span className="font-medium text-gray-900">{data.demand.companiesCount}</span>
                        </div>
                        <div className="border-t border-gray-100 my-2"></div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Private Uploads</span>
                            <span className="font-bold text-purple-600">{data.distribution.totalPrivateUploads}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Platform Leads</span>
                            <span className="font-bold text-blue-600">{data.distribution.totalDistributedInCirculation}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}