// src/features/company-admin/components/InlineLeaderboard.jsx
import React, { useState, useEffect } from 'react';
import { collection, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@lib/firebase';
import {
    Loader2, Calendar, Trophy, Search,
    Medal, RefreshCw
} from 'lucide-react';

export function InlineLeaderboard({ companyId }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [leaderboard, setLeaderboard] = useState([]);

    // Get Chicago date
    const getChicagoToday = () => {
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Chicago',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
        return formatter.format(new Date());
    };

    const [startDate, setStartDate] = useState(getChicagoToday);
    const [endDate, setEndDate] = useState(getChicagoToday);

    useEffect(() => {
        if (companyId) fetchData();
    }, [companyId]);

    const fetchData = async () => {
        setLoading(true);
        setError('');
        try {
            const statsRef = collection(db, 'companies', companyId, 'stats_daily');
            const q = query(
                statsRef,
                where('__name__', '>=', startDate),
                where('__name__', '<=', endDate),
                orderBy('__name__')
            );

            const snap = await getDocs(q);
            const userTotals = {};

            snap.forEach(doc => {
                const data = doc.data();
                const byUser = data.byUser || {};
                Object.keys(byUser).forEach(userId => {
                    const userData = byUser[userId];
                    if (!userTotals[userId]) {
                        userTotals[userId] = {
                            id: userId,
                            name: userData.name || 'Unknown Recruiter',
                            dials: 0,
                            connected: 0,
                            voicemail: 0,
                            callback: 0,
                            notInt: 0,
                            notQual: 0
                        };
                    }
                    userTotals[userId].dials += (userData.dials || 0);
                    userTotals[userId].connected += (userData.connected || 0);
                    userTotals[userId].voicemail += (userData.voicemail || 0);
                    userTotals[userId].callback += (userData.callback || 0);
                    userTotals[userId].notInt += (userData.notInt || 0);
                    userTotals[userId].notQual += (userData.notQual || 0);
                });
            });

            const sortedLeaderboard = Object.values(userTotals).sort((a, b) => b.dials - a.dials);
            setLeaderboard(sortedLeaderboard);

        } catch (error) {
            console.error("Failed to fetch performance:", error);
            setError("Failed to load data.");
        } finally {
            setLoading(false);
        }
    };

    const handleSearchClick = (e) => {
        e.preventDefault();
        fetchData();
    };

    const totalDials = leaderboard.reduce((acc, curr) => acc + curr.dials, 0);

    const getInitials = (name) => name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();

    const getRankIcon = (index) => {
        if (index === 0) return <Medal size={18} className="text-yellow-500" />;
        if (index === 1) return <Medal size={18} className="text-gray-400" />;
        if (index === 2) return <Medal size={18} className="text-orange-600" />;
        return <span className="text-sm font-bold text-gray-400 w-5 text-center">{index + 1}</span>;
    };

    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-yellow-50 rounded-lg text-yellow-600">
                        <Trophy size={20} />
                    </div>
                    <div>
                        <h3 className="text-lg font-bold text-gray-900">Team Leaderboard</h3>
                        <p className="text-xs text-gray-500">
                            <span className="font-semibold text-blue-600">{totalDials}</span> total calls today
                        </p>
                    </div>
                </div>

                {/* Date Filter */}
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 text-xs">
                        <Calendar size={14} className="text-gray-400" />
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-transparent font-medium text-gray-700 outline-none cursor-pointer"
                        />
                        <span className="text-gray-300">–</span>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-transparent font-medium text-gray-700 outline-none cursor-pointer"
                        />
                    </div>
                    <button
                        onClick={handleSearchClick}
                        disabled={loading}
                        className="p-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
                        title="Refresh"
                    >
                        {loading ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="bg-gray-50 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                        <tr>
                            <th className="px-4 py-3 w-16 text-center">Rank</th>
                            <th className="px-4 py-3">Recruiter</th>
                            <th className="px-4 py-3 text-center">Dials</th>
                            <th className="px-4 py-3 text-center text-green-600">Connected</th>
                            <th className="px-4 py-3 text-center text-blue-600">Callback</th>
                            <th className="px-4 py-3 text-center text-gray-400">VM</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {loading ? (
                            <tr>
                                <td colSpan="6" className="p-8 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <Loader2 className="animate-spin text-blue-500" size={24} />
                                        <span className="text-sm text-gray-500">Loading performance data...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : leaderboard.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="p-8 text-center">
                                    <div className="flex flex-col items-center gap-2">
                                        <Trophy size={32} className="text-gray-300" />
                                        <span className="text-sm font-semibold text-gray-600">No activity yet</span>
                                        <span className="text-xs text-gray-400">Make some calls to see your leaderboard!</span>
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            leaderboard.slice(0, 10).map((agent, index) => (
                                <tr key={agent.id} className="hover:bg-blue-50/40 transition-colors">
                                    <td className="px-4 py-3 text-center">
                                        <div className="flex justify-center">{getRankIcon(index)}</div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold text-white 
                                                ${index === 0 ? 'bg-gradient-to-br from-blue-500 to-indigo-600' :
                                                    index === 1 ? 'bg-gradient-to-br from-gray-400 to-gray-600' :
                                                        index === 2 ? 'bg-gradient-to-br from-orange-400 to-orange-600' :
                                                            'bg-gray-200 text-gray-600'}`}>
                                                {getInitials(agent.name)}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold text-gray-900">{agent.name}</p>
                                                {index === 0 && (
                                                    <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-700 rounded font-bold uppercase">MVP</span>
                                                )}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <span className="px-2.5 py-1 bg-gray-100 text-gray-900 font-bold text-sm rounded-lg">
                                            {agent.dials}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-center font-semibold text-green-600">{agent.connected}</td>
                                    <td className="px-4 py-3 text-center font-semibold text-blue-600">{agent.callback}</td>
                                    <td className="px-4 py-3 text-center text-gray-400">{agent.voicemail}</td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
