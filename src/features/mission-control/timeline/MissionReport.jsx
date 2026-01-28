import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, doc, onSnapshot, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import {
    ArrowLeft, Download, RotateCcw, Pause, Play, XCircle,
    CheckCircle, Clock, Users, MessageSquare, TrendingUp, AlertTriangle
} from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase/config';
import { staggerContainer, staggerItem } from '../lib/motion';

/**
 * MissionReport - Detailed view of a specific campaign mission
 */
const MissionReport = ({ companyId, sessionId, onBack }) => {
    const [session, setSession] = useState(null);
    const [attempts, setAttempts] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);

    // Real-time session data
    useEffect(() => {
        if (!companyId || !sessionId) return;

        const sessionRef = doc(db, 'companies', companyId, 'bulk_sessions', sessionId);
        const unsubscribe = onSnapshot(sessionRef, (snap) => {
            if (snap.exists()) {
                setSession({ id: snap.id, ...snap.data() });
            }
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [companyId, sessionId]);

    // Fetch attempts
    useEffect(() => {
        const fetchAttempts = async () => {
            if (!companyId || !sessionId) return;
            try {
                const attemptsRef = collection(db, 'companies', companyId, 'bulk_sessions', sessionId, 'attempts');
                const q = query(attemptsRef, orderBy('timestamp', 'desc'), limit(100));
                const snapshot = await getDocs(q);
                setAttempts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (err) {
                console.error('Error fetching attempts:', err);
            }
        };
        fetchAttempts();
    }, [companyId, sessionId, session?.progress?.processedCount]);

    const handlePause = async () => {
        setActionLoading('pause');
        try {
            // Update session status to paused
            const updateStatus = httpsCallable(functions, 'updateBulkSessionStatus');
            await updateStatus({ companyId, sessionId, status: 'paused' });
        } catch (err) {
            console.error('Pause error:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleResume = async () => {
        setActionLoading('resume');
        try {
            const updateStatus = httpsCallable(functions, 'updateBulkSessionStatus');
            await updateStatus({ companyId, sessionId, status: 'active' });
        } catch (err) {
            console.error('Resume error:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleRetry = async () => {
        setActionLoading('retry');
        try {
            const retryFailed = httpsCallable(functions, 'retryFailedAttempts');
            await retryFailed({ companyId, sessionId });
        } catch (err) {
            console.error('Retry error:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const handleCancel = async () => {
        if (!confirm('Are you sure you want to cancel this mission?')) return;
        setActionLoading('cancel');
        try {
            const updateStatus = httpsCallable(functions, 'updateBulkSessionStatus');
            await updateStatus({ companyId, sessionId, status: 'cancelled' });
        } catch (err) {
            console.error('Cancel error:', err);
        } finally {
            setActionLoading(null);
        }
    };

    const exportCSV = () => {
        const headers = ['Driver Name', 'Phone/Email', 'Status', 'Error', 'Timestamp'];
        const rows = attempts.map(a => [
            a.driverName || 'Unknown',
            a.phone || a.email || '--',
            a.status,
            a.error || '',
            a.timestamp?.toDate?.()?.toLocaleString() || ''
        ]);

        const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mission-${sessionId.slice(-6)}-report.csv`;
        a.click();
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-20">
                <div className="w-12 h-12 rounded-full border-4 border-blue-500 border-t-transparent animate-spin" />
            </div>
        );
    }

    if (!session) {
        return (
            <div className="text-center py-20 text-slate-400">
                Mission not found
            </div>
        );
    }

    const progress = session.progress || {};
    const total = progress.totalCount || 1;
    const processed = progress.processedCount || 0;
    const success = progress.successCount || 0;
    const failed = progress.failedCount || 0;
    const percent = Math.round((processed / total) * 100);
    const successRate = processed > 0 ? Math.round((success / processed) * 100) : 0;

    const statusColors = {
        active: 'from-blue-600 to-blue-500',
        completed: 'from-emerald-600 to-emerald-500',
        paused: 'from-amber-600 to-amber-500',
        failed: 'from-red-600 to-red-500',
        cancelled: 'from-slate-600 to-slate-500',
    };

    return (
        <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
        >
            {/* Header */}
            <motion.div variants={staggerItem} className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <motion.button
                        className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400"
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={onBack}
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </motion.button>
                    <div>
                        <h2 className="text-2xl font-black text-white">
                            Mission #{sessionId.slice(-6).toUpperCase()}
                        </h2>
                        <p className="text-slate-400">
                            {session.method === 'sms' ? '📱 SMS Campaign' : '📧 Email Campaign'}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3">
                    {session.status === 'active' && (
                        <motion.button
                            className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 font-bold flex items-center gap-2"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handlePause}
                            disabled={actionLoading === 'pause'}
                        >
                            <Pause className="w-4 h-4" />
                            Pause
                        </motion.button>
                    )}
                    {session.status === 'paused' && (
                        <motion.button
                            className="px-4 py-2 rounded-xl bg-blue-500/20 text-blue-300 font-bold flex items-center gap-2"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleResume}
                            disabled={actionLoading === 'resume'}
                        >
                            <Play className="w-4 h-4" />
                            Resume
                        </motion.button>
                    )}
                    {failed > 0 && session.status !== 'active' && (
                        <motion.button
                            className="px-4 py-2 rounded-xl bg-amber-500/20 text-amber-300 font-bold flex items-center gap-2"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleRetry}
                            disabled={actionLoading === 'retry'}
                        >
                            <RotateCcw className="w-4 h-4" />
                            Retry {failed}
                        </motion.button>
                    )}
                    <motion.button
                        className="px-4 py-2 rounded-xl bg-white/5 text-white font-bold flex items-center gap-2"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={exportCSV}
                    >
                        <Download className="w-4 h-4" />
                        Export
                    </motion.button>
                    {(session.status === 'active' || session.status === 'paused') && (
                        <motion.button
                            className="px-4 py-2 rounded-xl bg-red-500/20 text-red-300 font-bold flex items-center gap-2"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleCancel}
                            disabled={actionLoading === 'cancel'}
                        >
                            <XCircle className="w-4 h-4" />
                            Cancel
                        </motion.button>
                    )}
                </div>
            </motion.div>

            {/* Stats Grid */}
            <motion.div variants={staggerItem} className="grid grid-cols-4 gap-4 mb-8">
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <Users className="w-5 h-5 text-blue-400" />
                        <span className="text-slate-400 text-sm">Total Targets</span>
                    </div>
                    <div className="text-3xl font-black text-white">{total.toLocaleString()}</div>
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <MessageSquare className="w-5 h-5 text-purple-400" />
                        <span className="text-slate-400 text-sm">Processed</span>
                    </div>
                    <div className="text-3xl font-black text-white">{processed.toLocaleString()}</div>
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <CheckCircle className="w-5 h-5 text-emerald-400" />
                        <span className="text-slate-400 text-sm">Delivered</span>
                    </div>
                    <div className="text-3xl font-black text-emerald-400">{success.toLocaleString()}</div>
                </div>
                <div className="glass-card p-5">
                    <div className="flex items-center gap-3 mb-2">
                        <AlertTriangle className="w-5 h-5 text-red-400" />
                        <span className="text-slate-400 text-sm">Failed</span>
                    </div>
                    <div className="text-3xl font-black text-red-400">{failed.toLocaleString()}</div>
                </div>
            </motion.div>

            {/* Progress Bar */}
            <motion.div variants={staggerItem} className="glass-card p-6 mb-8">
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <span className="text-white font-bold">Progress</span>
                        <span className={`
              ml-3 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider
              bg-gradient-to-r ${statusColors[session.status] || statusColors.active}
            `}>
                            {session.status}
                        </span>
                    </div>
                    <div className="text-right">
                        <span className="text-3xl font-black text-white">{percent}%</span>
                        <span className="text-slate-400 ml-2">({successRate}% success rate)</span>
                    </div>
                </div>
                <div className="h-4 bg-slate-800 rounded-full overflow-hidden">
                    <motion.div
                        className={`h-full bg-gradient-to-r ${statusColors[session.status] || statusColors.active}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${percent}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                    />
                </div>
            </motion.div>

            {/* Attempts Table */}
            <motion.div variants={staggerItem} className="glass-card overflow-hidden">
                <div className="p-5 border-b border-white/10">
                    <h3 className="text-white font-bold">Delivery Log</h3>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="border-b border-white/5">
                                <th className="text-left p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Driver</th>
                                <th className="text-left p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Contact</th>
                                <th className="text-left p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
                                <th className="text-left p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Details</th>
                                <th className="text-left p-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            {attempts.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="p-8 text-center text-slate-500">
                                        No delivery attempts yet
                                    </td>
                                </tr>
                            ) : (
                                attempts.map((att) => (
                                    <tr key={att.id} className="border-b border-white/5 hover:bg-white/5">
                                        <td className="p-4 text-white font-medium">{att.driverName || 'Unknown'}</td>
                                        <td className="p-4 text-slate-400 font-mono text-sm">{att.phone || att.email || '--'}</td>
                                        <td className="p-4">
                                            <span className={`
                        px-2 py-1 rounded-full text-xs font-bold
                        ${att.status === 'delivered' || att.status === 'sent'
                                                    ? 'bg-emerald-500/20 text-emerald-300'
                                                    : 'bg-red-500/20 text-red-300'
                                                }
                      `}>
                                                {att.status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-slate-400 text-sm max-w-xs truncate">
                                            {att.error || 'Delivered successfully'}
                                        </td>
                                        <td className="p-4 text-slate-500 text-sm">
                                            {att.timestamp?.toDate?.()?.toLocaleTimeString() || '--'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </motion.div>
        </motion.div>
    );
};

export default MissionReport;
