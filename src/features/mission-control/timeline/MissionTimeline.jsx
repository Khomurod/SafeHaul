import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Clock, CheckCircle, XCircle, Pause, Play, RotateCcw, Download, Rocket, Plus } from 'lucide-react';
import { staggerContainer, staggerItem } from '../lib/motion';
import MissionReport from './MissionReport';
import CampaignBuilder from '../campaign-builder/CampaignBuilder';

/**
 * MissionBar - Individual campaign timeline bar
 */
const MissionBar = ({ mission, onViewReport }) => {
    const statusColors = {
        active: 'from-blue-600 to-blue-500',
        completed: 'from-emerald-600 to-emerald-500',
        paused: 'from-amber-600 to-amber-500',
        failed: 'from-red-600 to-red-500',
        scheduled: 'from-purple-600 to-purple-500',
        cancelled: 'from-slate-600 to-slate-500',
    };

    const statusIcons = {
        active: <Play className="w-4 h-4" />,
        completed: <CheckCircle className="w-4 h-4" />,
        paused: <Pause className="w-4 h-4" />,
        failed: <XCircle className="w-4 h-4" />,
        scheduled: <Clock className="w-4 h-4" />,
        cancelled: <XCircle className="w-4 h-4" />,
    };

    const progress = mission.progress || {};
    const total = progress.totalCount || 1;
    const processed = progress.processedCount || 0;
    const percent = Math.round((processed / total) * 100);

    const formatDate = (timestamp) => {
        if (!timestamp) return '--';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    return (
        <motion.div
            className="glass-card p-5 cursor-pointer"
            variants={staggerItem}
            whileHover={{ scale: 1.01, x: 4 }}
            onClick={() => onViewReport(mission)}
        >
            <div className="flex items-center gap-4">
                {/* Status Icon */}
                <div className={`
          w-12 h-12 rounded-xl flex items-center justify-center text-white
          bg-gradient-to-br ${statusColors[mission.status] || statusColors.active}
          shadow-lg
        `}>
                    {statusIcons[mission.status] || statusIcons.active}
                </div>

                {/* Mission Info */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-white font-bold truncate">
                            {mission.name || `Mission #${mission.id?.slice(-6)?.toUpperCase()}`}
                        </h3>
                        <span className={`
              px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider
              ${mission.status === 'active' ? 'bg-blue-500/20 text-blue-300' :
                                mission.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' :
                                    mission.status === 'paused' ? 'bg-amber-500/20 text-amber-300' :
                                        'bg-slate-500/20 text-slate-300'}
            `}>
                            {mission.status}
                        </span>
                    </div>
                    <p className="text-sm text-slate-400 truncate">
                        {mission.method === 'sms' ? '📱 SMS' : '📧 Email'} • {progress.totalCount || 0} targets
                    </p>
                </div>

                {/* Progress */}
                <div className="text-right">
                    <div className="text-2xl font-black text-white">{percent}%</div>
                    <div className="text-xs text-slate-400">
                        {progress.successCount || 0} delivered
                    </div>
                </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-4 h-2 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                    className={`h-full bg-gradient-to-r ${statusColors[mission.status] || statusColors.active}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${percent}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/5">
                <span className="text-xs text-slate-500">
                    Started: {formatDate(mission.createdAt)}
                </span>
                {progress.failedCount > 0 && (
                    <span className="px-3 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-bold">
                        {progress.failedCount} failed
                    </span>
                )}
            </div>
        </motion.div>
    );
};

/**
 * EmptyMissionsState - Animated empty state
 */
const EmptyMissionsState = ({ onCreateNew }) => (
    <motion.div
        className="glass-card p-12 text-center"
        variants={staggerItem}
        initial="initial"
        animate="animate"
    >
        <motion.div
            className="text-8xl mb-6"
            animate={{
                y: [0, -10, 0],
                rotate: [0, 5, 0, -5, 0],
            }}
            transition={{ duration: 4, repeat: Infinity }}
        >
            🚀
        </motion.div>
        <h3 className="text-2xl font-black text-white mb-3">Ready for Liftoff</h3>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
            Launch your first engagement mission to start connecting with drivers.
            All active and past campaigns will appear here.
        </p>
        <motion.button
            className="px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold shadow-lg shadow-blue-500/30 flex items-center gap-2 mx-auto"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCreateNew}
        >
            <Plus className="w-5 h-5" />
            Create First Mission
        </motion.button>
    </motion.div>
);

/**
 * MissionTimeline - Full campaign history with nested report view
 */
const MissionTimeline = ({ companyId }) => {
    const [missions, setMissions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedMission, setSelectedMission] = useState(null);
    const [showBuilder, setShowBuilder] = useState(false);

    useEffect(() => {
        if (!companyId) return;

        const sessionsRef = collection(db, 'companies', companyId, 'bulk_sessions');
        const q = query(sessionsRef, orderBy('createdAt', 'desc'), limit(20));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const missionData = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
            }));
            setMissions(missionData);
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [companyId]);

    const handleViewReport = (mission) => {
        setSelectedMission(mission);
    };

    const handleBackToList = () => {
        setSelectedMission(null);
    };

    const handleBuilderSuccess = (result) => {
        setShowBuilder(false);
        // The real-time subscription will automatically pick up the new session
    };

    // Show detailed report if mission selected
    if (selectedMission) {
        return (
            <MissionReport
                companyId={companyId}
                sessionId={selectedMission.id}
                onBack={handleBackToList}
            />
        );
    }

    if (isLoading) {
        return (
            <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-32 rounded-2xl mc-shimmer" />
                ))}
            </div>
        );
    }

    return (
        <>
            <motion.div
                variants={staggerContainer}
                initial="initial"
                animate="animate"
            >
                {/* Header */}
                <div className="flex items-center justify-between mb-8">
                    <div>
                        <h2 className="text-2xl font-black text-white">Mission History</h2>
                        <p className="text-slate-400">Track and analyze your campaign performance</p>
                    </div>
                    <motion.button
                        className="glass-button-primary px-6 py-3 rounded-xl font-bold flex items-center gap-2"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setShowBuilder(true)}
                    >
                        <Rocket className="w-5 h-5" />
                        New Mission
                    </motion.button>
                </div>

                {/* Missions List */}
                {missions.length === 0 ? (
                    <EmptyMissionsState onCreateNew={() => setShowBuilder(true)} />
                ) : (
                    <div className="space-y-4">
                        {missions.map(mission => (
                            <MissionBar
                                key={mission.id}
                                mission={mission}
                                onViewReport={handleViewReport}
                            />
                        ))}
                    </div>
                )}
            </motion.div>

            {/* Campaign Builder Modal */}
            <AnimatePresence>
                {showBuilder && (
                    <CampaignBuilder
                        companyId={companyId}
                        onClose={() => setShowBuilder(false)}
                        onSuccess={handleBuilderSuccess}
                    />
                )}
            </AnimatePresence>
        </>
    );
};

export default MissionTimeline;
