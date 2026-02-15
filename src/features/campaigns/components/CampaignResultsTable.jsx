import React, { useState, useEffect } from 'react';
import { collection, query, limit, getDocs, orderBy } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { CheckCircle2, AlertCircle, Clock, Search } from 'lucide-react';

export function CampaignResultsTable({ companyId, campaignId }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        const fetchLogs = async () => {
            if (!companyId || !campaignId) {
                setLoading(false);
                return;
            }
            try {
                // Fetch last 100 logs
                const q = query(
                    collection(db, 'companies', companyId, 'bulk_sessions', campaignId, 'logs'),
                    orderBy('timestamp', 'desc'),
                    limit(200)
                );
                const snap = await getDocs(q);
                setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (err) {
                console.error("Failed to fetch logs:", err);
            } finally {
                setLoading(false);
            }
        };
        fetchLogs();
    }, [companyId, campaignId]);

    const filteredLogs = logs.filter(log =>
        log.recipientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.recipientIdentity?.includes(searchTerm)
    );

    if (loading) return <div className="p-8 text-center text-slate-400 text-sm font-medium animate-pulse">Loading detailed results...</div>;

    if (logs.length === 0) return <div className="p-8 text-center text-slate-400 text-sm font-medium">No messages sent yet.</div>;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider">Recipient Log</h3>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                    <input
                        type="text"
                        placeholder="Search name or phone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-300 w-48 transition-all"
                    />
                </div>
            </div>

            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10">
                        <tr>
                            <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Recipient</th>
                            <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Contact</th>
                            <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                            <th className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Time</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredLogs.map(log => (
                            <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-3">
                                    <div className="text-sm font-bold text-slate-900">{log.recipientName || 'Unknown'}</div>
                                </td>
                                <td className="px-6 py-3">
                                    <div className="text-xs font-mono text-slate-500">{log.recipientIdentity}</div>
                                </td>
                                <td className="px-6 py-3">
                                    <div className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${log.status === 'delivered' ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {log.status === 'delivered' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                                        {log.status === 'delivered' ? 'Delivered' : 'Failed'}
                                    </div>
                                    {log.error && (
                                        <div className="text-[10px] text-red-400 mt-1 font-medium">{log.error}</div>
                                    )}
                                </td>
                                <td className="px-6 py-3">
                                    <div className="text-xs text-slate-400 font-medium flex items-center gap-1">
                                        <Clock size={12} />
                                        {log.timestamp?.toDate ? log.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
