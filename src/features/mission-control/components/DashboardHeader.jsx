import React from 'react';
import { motion } from 'framer-motion';
import { orbPulse, staggerContainer, staggerItem } from '../lib/motion';

/**
 * MetricsOrb - Animated floating stat bubble
 */
const MetricsOrb = ({ value, label, color = 'blue', delay = 0 }) => {
    const colorMap = {
        blue: {
            bg: 'from-blue-600/20 to-blue-500/10',
            border: 'border-blue-500/30',
            glow: 'shadow-blue-500/20',
            text: 'text-blue-400',
            value: 'text-blue-100',
        },
        green: {
            bg: 'from-emerald-600/20 to-emerald-500/10',
            border: 'border-emerald-500/30',
            glow: 'shadow-emerald-500/20',
            text: 'text-emerald-400',
            value: 'text-emerald-100',
        },
        purple: {
            bg: 'from-purple-600/20 to-purple-500/10',
            border: 'border-purple-500/30',
            glow: 'shadow-purple-500/20',
            text: 'text-purple-400',
            value: 'text-purple-100',
        },
        amber: {
            bg: 'from-amber-600/20 to-amber-500/10',
            border: 'border-amber-500/30',
            glow: 'shadow-amber-500/20',
            text: 'text-amber-400',
            value: 'text-amber-100',
        },
    };

    const colors = colorMap[color] || colorMap.blue;

    const formatValue = (val) => {
        if (typeof val === 'number') {
            if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
            if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
            return val.toString();
        }
        return val;
    };

    return (
        <motion.div
            className={`
        relative p-6 rounded-2xl
        bg-gradient-to-br ${colors.bg}
        border ${colors.border}
        shadow-xl ${colors.glow}
        backdrop-blur-sm
      `}
            initial={{ opacity: 0, scale: 0.8, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ delay, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            whileHover={{ scale: 1.05, transition: { duration: 0.2 } }}
        >
            {/* Glow ring */}
            <motion.div
                className={`absolute inset-0 rounded-2xl ${colors.border} border opacity-50`}
                animate={{
                    opacity: [0.3, 0.6, 0.3],
                    scale: [1, 1.02, 1],
                }}
                transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'easeInOut',
                }}
            />

            <div className="relative z-10 text-center">
                <motion.div
                    className={`text-3xl font-black ${colors.value} mb-1`}
                    key={value}
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                >
                    {formatValue(value)}
                </motion.div>
                <div className={`text-xs font-bold uppercase tracking-widest ${colors.text}`}>
                    {label}
                </div>
            </div>
        </motion.div>
    );
};

/**
 * DashboardHeader - Mission Control header with branding and metrics
 */
const DashboardHeader = ({ metrics, isLoading }) => {
    return (
        <motion.header
            className="mb-12"
            variants={staggerContainer}
            initial="initial"
            animate="animate"
        >
            {/* Title Section */}
            <motion.div
                className="text-center mb-10"
                variants={staggerItem}
            >
                <div className="inline-flex items-center gap-3 mb-4">
                    <motion.div
                        className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center shadow-xl shadow-blue-500/30"
                        whileHover={{ rotate: 10, scale: 1.1 }}
                        transition={{ type: 'spring', stiffness: 300 }}
                    >
                        <span className="text-2xl font-black text-white">MC</span>
                    </motion.div>
                    <div className="text-left">
                        <div className="text-xs font-bold text-blue-400 uppercase tracking-[0.2em]">
                            SafeHaul Core
                        </div>
                        <h1 className="text-3xl font-black text-white tracking-tight">
                            Mission Control
                        </h1>
                    </div>
                </div>
                <p className="text-slate-400 text-lg max-w-xl mx-auto">
                    Driver engagement command center. Launch campaigns, monitor performance, automate outreach.
                </p>
            </motion.div>

            {/* Metrics Orbs */}
            <motion.div
                className="flex justify-center gap-6 flex-wrap"
                variants={staggerItem}
            >
                {isLoading ? (
                    // Loading placeholders
                    <>
                        {[...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="w-32 h-24 rounded-2xl mc-shimmer"
                            />
                        ))}
                    </>
                ) : (
                    <>
                        <MetricsOrb
                            value={metrics.totalSent}
                            label="Total Sent"
                            color="blue"
                            delay={0}
                        />
                        <MetricsOrb
                            value={metrics.activeNow}
                            label="Active Now"
                            color="green"
                            delay={0.1}
                        />
                        <MetricsOrb
                            value={`${metrics.successRate}%`}
                            label="Success Rate"
                            color="purple"
                            delay={0.2}
                        />
                        <MetricsOrb
                            value={`${metrics.responseRate}%`}
                            label="Response Rate"
                            color="amber"
                            delay={0.3}
                        />
                    </>
                )}
            </motion.div>
        </motion.header>
    );
};

export default DashboardHeader;
