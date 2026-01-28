import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

// Components
import ParticleField from './components/ParticleField';
import DashboardHeader from './components/DashboardHeader';
import SquadGrid from './segments/SquadGrid';
import CampaignBuilder from './campaign-builder/CampaignBuilder';
import MissionTimeline from './timeline/MissionTimeline';
import AutomationBuilder from './automations/AutomationBuilder';

// Styles
import './styles/mission-control-theme.css';
import './styles/glass.css';
import './styles/animations.css';

// Motion presets
import { pageTransition, tabContent, staggerContainer } from './lib/motion';

/**
 * MissionControlView - Main container for the Engagement Engine
 * Replaces the old CampaignsView with a premium dark mode experience
 */
const MissionControlView = ({ companyId }) => {
    const [activeTab, setActiveTab] = useState('command-center');
    const [metrics, setMetrics] = useState({
        totalSent: 0,
        activeNow: 0,
        successRate: 0,
        responseRate: 0,
    });
    const [isLoading, setIsLoading] = useState(true);

    // Tabs configuration
    const tabs = [
        { id: 'command-center', label: 'Command Center', icon: '🎯' },
        { id: 'missions', label: 'Missions', icon: '🚀' },
        { id: 'automations', label: 'Automations', icon: '⚡' },
    ];

    // Real-time metrics subscription
    useEffect(() => {
        if (!companyId) return;

        const sessionsRef = collection(db, 'companies', companyId, 'bulk_sessions');
        const q = query(sessionsRef, orderBy('createdAt', 'desc'), limit(100));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            let totalSent = 0;
            let activeCount = 0;
            let totalSuccess = 0;
            let totalAttempts = 0;

            snapshot.docs.forEach(doc => {
                const data = doc.data();
                const progress = data.progress || {};

                totalSent += progress.successCount || 0;
                totalAttempts += progress.processedCount || 0;
                totalSuccess += progress.successCount || 0;

                if (data.status === 'active') {
                    activeCount++;
                }
            });

            setMetrics({
                totalSent,
                activeNow: activeCount,
                successRate: totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 100) : 0,
                responseRate: 0, // TODO: Calculate from response tracking
            });
            setIsLoading(false);
        });

        return () => unsubscribe();
    }, [companyId]);

    // Render active tab content
    const renderContent = () => {
        switch (activeTab) {
            case 'command-center':
                return <SquadGrid companyId={companyId} />;
            case 'missions':
                return <MissionTimeline companyId={companyId} />;
            case 'automations':
                return <AutomationBuilder companyId={companyId} />;
            default:
                return null;
        }
    };

    return (
        <div className="mission-control">
            {/* Particle Background */}
            <ParticleField
                particleCount={60}
                color="rgba(59, 130, 246, 0.5)"
                speed={0.2}
            />

            {/* Main Content */}
            <motion.div
                className="relative z-10 min-h-screen p-8"
                initial="initial"
                animate="animate"
                variants={staggerContainer}
            >
                {/* Header */}
                <DashboardHeader
                    metrics={metrics}
                    isLoading={isLoading}
                />

                {/* Tab Navigation */}
                <nav className="flex justify-center mb-12">
                    <div className="glass-card p-2 flex gap-2">
                        {tabs.map(tab => (
                            <motion.button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`
                  flex items-center gap-3 px-8 py-4 rounded-xl font-bold text-sm uppercase tracking-wider
                  transition-all duration-300
                  ${activeTab === tab.id
                                        ? 'bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/25'
                                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                                    }
                `}
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                            >
                                <span className="text-lg">{tab.icon}</span>
                                {tab.label}
                            </motion.button>
                        ))}
                    </div>
                </nav>

                {/* Tab Content */}
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeTab}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        variants={tabContent}
                        className="max-w-7xl mx-auto"
                    >
                        {renderContent()}
                    </motion.div>
                </AnimatePresence>
            </motion.div>
        </div>
    );
};

export default MissionControlView;
