import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@lib/firebase';
import { Loader2, CircleDot, User, FileText, RefreshCcw, MessageSquare, Mail } from 'lucide-react';

export function ActivityHistoryTab({ companyId, applicationId, collectionName }) {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if(companyId && applicationId) fetchLogs();
    }, [companyId, applicationId, collectionName]);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            // Normalize collection name to ensure we hit the right path
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
        if (action.includes('Assigned')) return <RefreshCcw size={16} className="text-orange-600"/>;
        if (action.includes('Status')) return <CircleDot size={16} className="text-blue-600"/>;
        if (action.includes('Note')) return <MessageSquare size={16} className="text-gray-600"/>;
        if (action.includes('Email')) return <Mail size={16} className="text-purple-600"/>;
        if (type === 'upload') return <FileText size={16} className="text-green-600"/>;
        return <User size={16} className="text-gray-500"/>;
    };

    if (loading) return <div className="p-10 text-center"><Loader2 className="animate-spin mx-auto text-blue-600"/></div>;

    if (logs.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 border-2 border-dashed border-gray-200 rounded-xl">
                <FileText size={32} className="mb-2 opacity-20" />
                <p>No activity recorded yet.</p>
            </div>
        );
    }

    return (
        <div className="py-4 px-2">
            <div className="relative border-l-2 border-gray-200 ml-4 space-y-8">
                {logs.map((log) => (
                    <div key={log.id} className="ml-8 relative">

                        {/* Timeline Dot */}
                        <div className="absolute -left-[41px] top-0 w-8 h-8 bg-white border-2 border-gray-200 rounded-full flex items-center justify-center z-10 shadow-sm">
                            {getIcon(log.type, log.action)}
                        </div>

                        {/* Content Card */}
                        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 hover:border-blue-200 transition-colors">
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-gray-900 text-sm">{log.action}</span>
                                <span className="text-xs text-gray-400">
                                    {log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : 'Just now'}
                                </span>
                            </div>
                            <p className="text-sm text-gray-600 whitespace-pre-wrap">{log.details}</p>
                            <div className="mt-2 text-xs font-semibold text-blue-600 flex items-center gap-1">
                                <User size={10} /> {log.performedByName || 'System'}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}