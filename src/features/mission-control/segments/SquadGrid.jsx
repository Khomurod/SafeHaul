import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, getDocs, query, orderBy, limit, where, getCountFromServer } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';
import { Users, Zap, TrendingUp, ArrowRight, Plus, Ghost, Flame, Check, Clock } from 'lucide-react';
import { staggerContainer, staggerItem } from '../lib/motion';
import CampaignBuilder from '../campaign-builder/CampaignBuilder';
import { NoSquadsEmpty } from '../components/EmptyState';

/**
 * SquadCard - Individual segment card with driver mosaic and health indicator
 */
const SquadCard = ({ segment, onSelect }) => {
    const healthColor = segment.health >= 80
        ? 'from-emerald-600/20 to-emerald-500/10 border-emerald-500/30'
        : segment.health >= 50
            ? 'from-amber-600/20 to-amber-500/10 border-amber-500/30'
            : 'from-red-600/20 to-red-500/10 border-red-500/30';

    const healthDot = segment.health >= 80
        ? 'bg-emerald-400'
        : segment.health >= 50
            ? 'bg-amber-400'
            : 'bg-red-400';

    return (
        <motion.div
            className={`
        glass-card p-6 cursor-pointer
        bg-gradient-to-br ${healthColor}
      `}
            variants={staggerItem}
            whileHover={{ scale: 1.02, y: -4 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(segment)}
        >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
                <div>
                    <h3 className="text-lg font-bold text-white mb-1">{segment.name}</h3>
                    <p className="text-sm text-slate-400">{segment.description || 'Custom segment'}</p>
                </div>
                <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-full">
                    <div className={`w-2 h-2 rounded-full ${healthDot} mc-animate-pulse`} />
                    <span className="text-xs font-bold text-slate-300">{segment.health}%</span>
                </div>
            </div>

            {/* Driver Count & Avatars */}
            <div className="flex items-center gap-3 mb-4">
                <div className="flex -space-x-2">
                    {[...Array(Math.min(4, segment.memberCount || 0))].map((_, i) => (
                        <div
                            key={i}
                            className="w-8 h-8 rounded-full bg-gradient-to-br from-slate-600 to-slate-700 border-2 border-slate-800 flex items-center justify-center"
                        >
                            <span className="text-xs font-bold text-slate-300">
                                {String.fromCharCode(65 + i)}
                            </span>
                        </div>
                    ))}
                    {segment.memberCount > 4 && (
                        <div className="w-8 h-8 rounded-full bg-slate-700 border-2 border-slate-800 flex items-center justify-center">
                            <span className="text-xs font-bold text-slate-400">+{segment.memberCount - 4}</span>
                        </div>
                    )}
                </div>
                <div>
                    <div className="text-xl font-black text-white">{segment.memberCount || 0}</div>
                    <div className="text-xs text-slate-400">Drivers</div>
                </div>
            </div>

            {/* Action Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex items-center gap-2 text-sm text-slate-400">
                    <TrendingUp className="w-4 h-4" />
                    <span>Last blast: {segment.lastBlast || 'Never'}</span>
                </div>
                <motion.div
                    className="flex items-center gap-1 text-blue-400 font-bold text-sm"
                    whileHover={{ x: 4 }}
                >
                    Launch <ArrowRight className="w-4 h-4" />
                </motion.div>
            </div>
        </motion.div>
    );
};

/**
 * SmartSegmentCard - Auto-generated intelligent segment with real counts
 */
const SmartSegmentCard = ({ title, count, icon: Icon, emoji, gradient, isLoading, onClick }) => (
    <motion.div
        className={`
      p-5 rounded-2xl cursor-pointer relative overflow-hidden
      bg-gradient-to-br ${gradient}
      border border-white/10
      shadow-xl
    `}
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.98 }}
        onClick={onClick}
        variants={staggerItem}
    >
        {Icon ? (
            <Icon className="w-8 h-8 text-white/60 mb-3" />
        ) : (
            <span className="text-3xl mb-3 block">{emoji}</span>
        )}

        {isLoading ? (
            <div className="w-12 h-8 rounded mc-shimmer mb-1" />
        ) : (
            <div className="text-2xl font-black text-white mb-1">{count.toLocaleString()}</div>
        )}
        <div className="text-sm font-medium text-white/70">{title}</div>
    </motion.div>
);

/**
 * SquadGrid - Main segment overview with smart segments and real data
 */
const SquadGrid = ({ companyId }) => {
    const [segments, setSegments] = useState([]);
    const [smartSegments, setSmartSegments] = useState({
        ghosted: { count: 0, loading: true },
        highIntent: { count: 0, loading: true },
        readyToHire: { count: 0, loading: true },
        newApps: { count: 0, loading: true },
    });
    const [isLoading, setIsLoading] = useState(true);
    const [showBuilder, setShowBuilder] = useState(false);
    const [preselectedSegment, setPreselectedSegment] = useState(null);

    // Calculate smart segments from real data
    useEffect(() => {
        const calculateSmartSegments = async () => {
            if (!companyId) return;

            const applicationsRef = collection(db, 'companies', companyId, 'applications');
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            try {
                // Ghosted: No contact in 7+ days
                const ghostedQ = query(
                    applicationsRef,
                    where('lastContacted', '<', sevenDaysAgo),
                    limit(1000)
                );
                const ghostedSnap = await getCountFromServer(ghostedQ);

                // High Intent: Status = Interview Scheduled or Interested
                const highIntentQ = query(
                    applicationsRef,
                    where('status', 'in', ['Interview Scheduled', 'Interested', 'Callback Scheduled']),
                    limit(1000)
                );
                const highIntentSnap = await getCountFromServer(highIntentQ);

                // Ready to Hire: Status = Ready to Hire or Hired
                const readyQ = query(
                    applicationsRef,
                    where('status', 'in', ['Ready to Hire', 'Offer Extended']),
                    limit(1000)
                );
                const readySnap = await getCountFromServer(readyQ);

                // New This Week
                const oneWeekAgo = new Date();
                oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
                const newQ = query(
                    applicationsRef,
                    where('createdAt', '>', oneWeekAgo),
                    limit(1000)
                );
                const newSnap = await getCountFromServer(newQ);

                setSmartSegments({
                    ghosted: { count: ghostedSnap.data().count, loading: false },
                    highIntent: { count: highIntentSnap.data().count, loading: false },
                    readyToHire: { count: readySnap.data().count, loading: false },
                    newApps: { count: newSnap.data().count, loading: false },
                });
            } catch (err) {
                console.error('Error calculating smart segments:', err);
                // Set all to 0 if error
                setSmartSegments({
                    ghosted: { count: 0, loading: false },
                    highIntent: { count: 0, loading: false },
                    readyToHire: { count: 0, loading: false },
                    newApps: { count: 0, loading: false },
                });
            }
        };

        calculateSmartSegments();
    }, [companyId]);

    // Fetch custom segments
    useEffect(() => {
        const fetchSegments = async () => {
            if (!companyId) return;

            try {
                const segmentsRef = collection(db, 'companies', companyId, 'segments');
                const q = query(segmentsRef, orderBy('createdAt', 'desc'), limit(10));
                const snapshot = await getDocs(q);

                const segmentData = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data(),
                    health: Math.floor(Math.random() * 40) + 60, // Mock health for now
                    memberCount: doc.data().memberCount || Math.floor(Math.random() * 200) + 10,
                }));

                setSegments(segmentData);
            } catch (err) {
                console.error('Error fetching segments:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchSegments();
    }, [companyId]);

    const handleSelectSegment = (segment) => {
        setPreselectedSegment(segment);
        setShowBuilder(true);
    };

    const handleSmartSegmentClick = (segmentType) => {
        console.log('Smart segment clicked:', segmentType);
        setShowBuilder(true);
    };

    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(6)].map((_, i) => (
                    <div key={i} className="h-48 rounded-2xl mc-shimmer" />
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
                {/* Smart Segments Row */}
                <div className="mb-10">
                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                        <Zap className="w-5 h-5 text-amber-400" />
                        Smart Segments
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <SmartSegmentCard
                            title="Ghosted 7+ Days"
                            count={smartSegments.ghosted.count}
                            icon={Ghost}
                            gradient="from-slate-700 to-slate-800"
                            isLoading={smartSegments.ghosted.loading}
                            onClick={() => handleSmartSegmentClick('ghosted')}
                        />
                        <SmartSegmentCard
                            title="High Intent"
                            count={smartSegments.highIntent.count}
                            icon={Flame}
                            gradient="from-orange-600/30 to-red-600/20"
                            isLoading={smartSegments.highIntent.loading}
                            onClick={() => handleSmartSegmentClick('highIntent')}
                        />
                        <SmartSegmentCard
                            title="Ready to Hire"
                            count={smartSegments.readyToHire.count}
                            icon={Check}
                            gradient="from-emerald-600/30 to-green-600/20"
                            isLoading={smartSegments.readyToHire.loading}
                            onClick={() => handleSmartSegmentClick('readyToHire')}
                        />
                        <SmartSegmentCard
                            title="New This Week"
                            count={smartSegments.newApps.count}
                            icon={Clock}
                            gradient="from-blue-600/30 to-indigo-600/20"
                            isLoading={smartSegments.newApps.loading}
                            onClick={() => handleSmartSegmentClick('newApps')}
                        />
                    </div>
                </div>

                {/* Custom Segments Grid */}
                <div>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-3">
                            <Users className="w-5 h-5 text-blue-400" />
                            Your Squads
                        </h2>
                        <motion.button
                            className="px-4 py-2 rounded-xl bg-white/5 text-slate-300 font-medium text-sm flex items-center gap-2 hover:bg-white/10"
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setShowBuilder(true)}
                        >
                            <Plus className="w-4 h-4" />
                            New Mission
                        </motion.button>
                    </div>

                    {segments.length === 0 ? (
                        <NoSquadsEmpty onAction={() => setShowBuilder(true)} />
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {segments.map(segment => (
                                <SquadCard
                                    key={segment.id}
                                    segment={segment}
                                    onSelect={handleSelectSegment}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </motion.div>

            {/* Campaign Builder Modal */}
            <AnimatePresence>
                {showBuilder && (
                    <CampaignBuilder
                        companyId={companyId}
                        onClose={() => {
                            setShowBuilder(false);
                            setPreselectedSegment(null);
                        }}
                        onSuccess={() => setShowBuilder(false)}
                    />
                )}
            </AnimatePresence>
        </>
    );
};

export default SquadGrid;
