import React, { useState } from 'react';
import { 
    BarChart3, Download, Calendar, Users, Phone, 
    FileText, Zap, TrendingUp, ArrowUpRight, User 
} from 'lucide-react';
import { useAnalytics } from '@features/analytics';

function SummaryCard({ title, value, icon: Icon, colorClass, trend }) {
    return (
        <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-start justify-between">
            <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-1">{title}</p>
                <h3 className="text-2xl font-bold text-gray-900">{value}</h3>
                {trend && (
                    <div className="flex items-center gap-1 mt-2 text-xs font-medium text-green-600 bg-green-50 w-fit px-2 py-0.5 rounded">
                        <TrendingUp size={12} />
                        <span>{trend}</span>
                    </div>
                )}
            </div>
            <div className={`p-3 rounded-lg ${colorClass}`}>
                <Icon size={20} />
            </div>
        </div>
    );
}

function ActivityTrendChart({ data }) {
    if (!data || data.length === 0) return <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No data available</div>;

    const height = 200;
    const width = 800;
    const padding = 20;
    
    const maxValue = Math.max(...data.map(d => d.value), 5);
    const points = data.map((d, i) => {
        const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
        const y = height - ((d.value / maxValue) * (height - padding * 2)) - padding;
        return `${x},${y}`;
    }).join(' ');

    return (
        <div className="w-full h-64 overflow-hidden">
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
                {[0, 0.25, 0.5, 0.75, 1].map(tick => (
                    <line 
                        key={tick}
                        x1={padding} 
                        y1={height - (tick * (height - padding * 2)) - padding} 
                        x2={width - padding} 
                        y2={height - (tick * (height - padding * 2)) - padding} 
                        stroke="#f3f4f6" 
                        strokeWidth="1" 
                    />
                ))}
                
                <polyline 
                    fill="none" 
                    stroke="#2563eb" 
                    strokeWidth="3" 
                    points={points} 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                />
                
                <polygon 
                    fill="url(#gradient)" 
                    points={`${padding},${height-padding} ${points} ${width-padding},${height-padding}`} 
                    opacity="0.1"
                />
                
                <defs>
                    <linearGradient id="gradient" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="#2563eb" />
                        <stop offset="100%" stopColor="white" />
                    </linearGradient>
                </defs>

                <text x={padding} y={height} className="text-[10px] fill-gray-400">{data[0]?.date}</text>
                <text x={width/2} y={height} className="text-[10px] fill-gray-400 text-anchor-middle">{data[Math.floor(data.length/2)]?.date}</text>
                <text x={width-padding} y={height} className="text-[10px] fill-gray-400 text-anchor-end">{data[data.length-1]?.date}</text>
            </svg>
        </div>
    );
}

export function AnalyticsView() {
    const { loading, stats, dateRange, setDateRange } = useAnalytics();
    const [activeTab, setActiveTab] = useState('overview');

    const handleExport = () => {
        let headers = [];
        let rows = [];
        let filename = "export.csv";

        if (activeTab === 'users') {
            headers = ['Recruiter Name', 'Company', 'Calls Made', 'Last Active'];
            rows = stats.userPerformance.map(u => [
                u.userName, 
                u.companyName, 
                u.callsMade, 
                u.lastActive ? new Date(u.lastActive.seconds * 1000).toLocaleString() : 'N/A'
            ]);
            filename = `recruiter_performance_${dateRange}.csv`;
        } else {
            headers = ['Company Name', 'Calls Made', 'Total Actions'];
            rows = stats.companyPerformance.map(c => [c.companyName, c.callsMade, c.actions]);
            filename = `company_performance_${dateRange}.csv`;
        }
        
        const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="space-y-6 h-full flex flex-col">
            
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm shrink-0">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <BarChart3 className="text-blue-600" /> Platform Analytics
                    </h2>
                    <p className="text-sm text-gray-500">Monitor usage and performance across all companies.</p>
                </div>
                
                <div className="flex gap-2">
                    <div className="flex bg-gray-100 p-1 rounded-lg">
                        {['7d', '30d', '90d'].map(range => (
                            <button
                                key={range}
                                onClick={() => setDateRange(range)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
                                    dateRange === range 
                                    ? 'bg-white text-blue-700 shadow-sm' 
                                    : 'text-gray-500 hover:text-gray-700'
                                }`}
                            >
                                {range.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    
                    <button 
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-700 transition shadow-sm"
                    >
                        <Download size={16} /> Export {activeTab === 'users' ? 'Recruiters' : 'Companies'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 shrink-0">
                <SummaryCard 
                    title="Total Calls" 
                    value={stats.summary.totalCalls} 
                    icon={Phone} 
                    colorClass="bg-blue-100 text-blue-600"
                    trend="Real-time"
                />
                <SummaryCard 
                    title="Active Companies" 
                    value={stats.companyPerformance.length} 
                    icon={Users} 
                    colorClass="bg-purple-100 text-purple-600"
                    trend="Active"
                />
                <SummaryCard 
                    title="Active Recruiters" 
                    value={stats.summary.activeRecruiters} 
                    icon={User} 
                    colorClass="bg-orange-100 text-orange-600"
                    trend="This Period"
                />
                <SummaryCard 
                    title="Platform Health" 
                    value="100%" 
                    icon={Zap} 
                    colorClass="bg-yellow-100 text-yellow-600"
                    trend="Operational"
                />
            </div>

            <div className="flex-1 min-h-0 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
                <div className="flex border-b border-gray-200 px-6 pt-2 overflow-x-auto">
                    <button 
                        onClick={() => setActiveTab('overview')}
                        className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overview' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        Activity Overview
                    </button>
                    <button 
                        onClick={() => setActiveTab('companies')}
                        className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'companies' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        Company Performance
                    </button>
                    <button 
                        onClick={() => setActiveTab('users')}
                        className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        Recruiter Stats
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6 bg-gray-50">
                    
                    {activeTab === 'overview' && (
                        <div className="space-y-6">
                            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                <h4 className="text-sm font-bold text-gray-800 mb-6 flex items-center gap-2">
                                    <TrendingUp size={16} className="text-blue-500" /> Daily Activity Trend
                                </h4>
                                <ActivityTrendChart data={stats.dailyTrend} />
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                    <h4 className="text-sm font-bold text-gray-800 mb-4">Top Companies (By Calls)</h4>
                                    <div className="space-y-4">
                                        {stats.companyPerformance.slice(0, 5).map((comp, i) => (
                                            <div key={i} className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold text-xs">
                                                        {i + 1}
                                                    </div>
                                                    <span className="text-sm font-medium text-gray-700">{comp.companyName}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className="h-2 w-24 bg-gray-100 rounded-full overflow-hidden">
                                                        <div 
                                                            className="h-full bg-blue-500 rounded-full" 
                                                            style={{ width: `${(comp.callsMade / (stats.summary.totalCalls || 1)) * 100}%` }}
                                                        ></div>
                                                    </div>
                                                    <span className="text-xs font-bold text-gray-600">{comp.callsMade} calls</span>
                                                </div>
                                            </div>
                                        ))}
                                        {stats.companyPerformance.length === 0 && <p className="text-xs text-gray-400 italic">No data yet.</p>}
                                    </div>
                                </div>

                                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                    <h4 className="text-sm font-bold text-gray-800 mb-4">Top Recruiters (By Calls)</h4>
                                    <div className="space-y-4">
                                        {stats.userPerformance.slice(0, 5).map((user, i) => (
                                            <div key={i} className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center text-purple-600 font-bold text-xs">
                                                        {i + 1}
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-700">{user.userName}</p>
                                                        <p className="text-[10px] text-gray-400">{user.companyName}</p>
                                                    </div>
                                                </div>
                                                <span className="text-xs font-bold text-gray-600">{user.callsMade} calls</span>
                                            </div>
                                        ))}
                                        {stats.userPerformance.length === 0 && <p className="text-xs text-gray-400 italic">No data yet.</p>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'companies' && (
                        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase">
                                    <tr>
                                        <th className="px-6 py-4 border-b border-gray-200">Company</th>
                                        <th className="px-6 py-4 border-b border-gray-200 text-center">Calls Made</th>
                                        <th className="px-6 py-4 border-b border-gray-200 text-center">Total Actions</th>
                                        <th className="px-6 py-4 border-b border-gray-200 text-right">Engagement</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {stats.companyPerformance.map((comp) => (
                                        <tr key={comp.companyId} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 font-medium text-gray-900">{comp.companyName}</td>
                                            <td className="px-6 py-4 text-center text-gray-600">{comp.callsMade}</td>
                                            <td className="px-6 py-4 text-center text-gray-600">{comp.actions}</td>
                                            <td className="px-6 py-4 text-right">
                                                <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${
                                                    comp.callsMade > 20 
                                                    ? 'bg-green-100 text-green-700' 
                                                    : 'bg-yellow-100 text-yellow-700'
                                                }`}>
                                                    {comp.callsMade > 20 ? 'High' : 'Low'} <ArrowUpRight size={12} />
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {stats.companyPerformance.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="p-6 text-center text-gray-400 italic">No data found for this period.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {activeTab === 'users' && (
                        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-50 text-xs font-bold text-gray-500 uppercase">
                                    <tr>
                                        <th className="px-6 py-4 border-b border-gray-200">Recruiter Name</th>
                                        <th className="px-6 py-4 border-b border-gray-200">Company</th>
                                        <th className="px-6 py-4 border-b border-gray-200 text-center">Calls Made</th>
                                        <th className="px-6 py-4 border-b border-gray-200 text-right">Last Active</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {stats.userPerformance.map((user) => (
                                        <tr key={user.userId} className="hover:bg-gray-50 transition-colors">
                                            <td className="px-6 py-4 font-bold text-gray-900">{user.userName}</td>
                                            <td className="px-6 py-4 text-gray-600">{user.companyName}</td>
                                            <td className="px-6 py-4 text-center text-blue-600 font-mono font-bold">{user.callsMade}</td>
                                            <td className="px-6 py-4 text-right text-sm text-gray-500">
                                                {user.lastActive?.toDate 
                                                    ? user.lastActive.toDate().toLocaleString() 
                                                    : 'Unknown'}
                                            </td>
                                        </tr>
                                    ))}
                                    {stats.userPerformance.length === 0 && (
                                        <tr>
                                            <td colSpan="4" className="p-6 text-center text-gray-400 italic">No activity found for this period.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}