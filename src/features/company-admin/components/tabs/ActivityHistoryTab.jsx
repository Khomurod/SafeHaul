import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@lib/firebase';
import {
    Loader2, CircleDot, User, FileText, RefreshCcw, MessageSquare,
    Mail, Phone, ShieldCheck, AlertCircle, Filter, Calendar, Zap,
    Settings, Briefcase, CheckCircle2, XCircle
} from 'lucide-react';

export function ActivityHistoryTab({ companyId, applicationId, collectionName }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filterType, setFilterType] = useState('all');

    useEffect(() => {
        if (companyId && applicationId) fetchLogs();
    }, [companyId, applicationId, collectionName]);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const validCollection = (collectionName === 'leads') ? 'leads' : 'applications';
            const logsRef = collection(db, "companies", companyId, validCollection, applicationId, "activity_logs");
            const q = query(logsRef, orderBy("timestamp", "desc"));

            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setLogs(data);
        } catch (error) {
            console.error("Error loading history:", error);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (type, action) => {
        const lowerAction = action.toLowerCase();
        const lowerType = (type || '').toLowerCase();

        if (lowerType === 'call' || lowerAction.includes('call')) return <Phone size={16} className="text-emerald-600" />;
        if (lowerAction.includes('note')) return <MessageSquare size={16} className="text-gray-600" />;
        if (lowerAction.includes('email')) return <Mail size={16} className="text-indigo-600" />;
        if (lowerAction.includes('assigned')) return <RefreshCcw size={16} className="text-orange-600" />;
        if (lowerAction.includes('status')) {
            if (lowerAction.includes('approved') || lowerAction.includes('hired')) return <CheckCircle2 size={16} className="text-purple-600" />;
            if (lowerAction.includes('rejected') || lowerAction.includes('disqualified')) return <XCircle size={16} className="text-red-500" />;
            return <CircleDot size={16} className="text-blue-600" />;
        }
        if (lowerType === 'upload' || lowerAction.includes('file') || lowerAction.includes('document')) return <FileText size={16} className="text-green-600" />;
        if (lowerAction.includes('pev') || lowerAction.includes('verification')) return <ShieldCheck size={16} className="text-amber-600" />;
        if (lowerAction.includes('converted')) return <Zap size={16} className="text-yellow-600" />;
        if (lowerAction.includes('settings') || lowerAction.includes('updated')) return <Settings size={16} className="text-gray-400" />;

        return <User size={16} className="text-gray-400" />;
    };

    const filteredLogs = useMemo(() => {
        if (filterType === 'all') return logs;
        return logs.filter(log => {
            const action = log.action.toLowerCase();
            const type = (log.type || '').toLowerCase();
            if (filterType === 'calls') return type === 'call' || action.includes('call');
            if (filterType === 'notes') return action.includes('note');
            if (filterType === 'status') return action.includes('status');
            if (filterType === 'documents') return type === 'upload' || action.includes('file') || action.includes('document');
            return true;
        });
    }, [logs, filterType]);

    const groupedLogs = useMemo(() => {
        const groups = {};
        filteredLogs.forEach(log => {
            if (!log.timestamp) {
                if (!groups['Recent']) groups['Recent'] = [];
                groups['Recent'].push(log);
                return;
            }
            const date = new Date(log.timestamp.seconds * 1000);
            const today = new Date();
            const yesterday = new Date();
            yesterday.setDate(today.getDate() - 1);

            let groupKey = '';
            if (date.toDateString() === today.toDateString()) groupKey = 'Today';
            else if (date.toDateString() === yesterday.toDateString()) groupKey = 'Yesterday';
            else groupKey = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

            if (!groups[groupKey]) groups[groupKey] = [];
            groups[groupKey].push(log);
        });
        return groups;
    }, [filteredLogs]);

    if (loading) return <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></div>;

    return (
        <div className="flex flex-col h-full bg-white rounded-xl">
            {/* Filter Header */}
            <div className="p-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50 rounded-t-xl">
                <div className="flex items-center gap-2">
                    <Calendar size={18} className="text-gray-400" />
                    <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Audit Trail</h3>
                </div>
                <div className="flex items-center gap-2">
                    <Filter size={14} className="text-gray-400" />
                    <select
                        value={filterType}
                        onChange={(e) => setFilterType(e.target.value)}
                        className="text-xs font-bold bg-white border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
                    >
                        <option value="all">All Activities</option>
                        <option value="calls">Calls</option>
                        <option value="notes">Notes</option>
                        <option value="status">Status Changes</option>
                        <option value="documents">Documents</option>
                    </select>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-gray-200">
                {logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-400 border-2 border-dashed border-gray-100 rounded-xl">
                        <FileText size={32} className="mb-2 opacity-20" />
                        <p className="text-sm">No activity recorded for this driver.</p>
                    </div>
                ) : filteredLogs.length === 0 ? (
                    <div className="p-10 text-center text-gray-500 italic">No activities match the selected filter.</div>
                ) : (
                    <div className="space-y-8 relative">
                        {/* Vertical Line */}
                        <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-gray-100"></div>

                        {Object.entries(groupedLogs).map(([group, groupLogs]) => (
                            <div key={group} className="space-y-4">
                                <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider pl-8 mb-2 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-gray-300"></div>
                                    {group}
                                </h4>

                                {groupLogs.map((log) => (
                                    <div key={log.id} className="relative pl-10 group/item">
                                        {/* Icon Container */}
                                        <div className="absolute left-0 top-0 w-8 h-8 rounded-full bg-white border border-gray-200 flex items-center justify-center z-10 shadow-sm group-hover/item:border-blue-400 transition-colors">
                                            {getIcon(log.type, log.action)}
                                        </div>

                                        {/* Activity Content */}
                                        <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm group-hover/item:shadow-md transition-all group-hover/item:border-blue-100">
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-gray-800 text-sm">{log.action}</span>
                                                    {log.outcomeLabel && (
                                                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-semibold rounded-full border border-blue-100">
                                                            {log.outcomeLabel}
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="text-[10px] font-mono text-gray-400">
                                                    {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Pending'}
                                                </span>
                                            </div>

                                            {log.details && (
                                                <p className="text-sm text-gray-600 leading-relaxed font-medium whitespace-pre-wrap">
                                                    {log.details}
                                                </p>
                                            )}

                                            <div className="mt-3 pt-3 border-t border-gray-50 flex items-center justify-between">
                                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500">
                                                    <div className="w-5 h-5 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center text-[9px]">
                                                        {log.performedByName?.charAt(0) || 'S'}
                                                    </div>
                                                    {log.performedByName || 'System Auto'}
                                                </div>

                                                {(log.type === 'call' && log.duration) && (
                                                    <span className="text-[11px] text-gray-400 font-medium">Duration: {log.duration}s</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}