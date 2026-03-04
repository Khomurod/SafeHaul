import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Clock, MessageSquare, Users, ArrowRight } from 'lucide-react';
import { staggerContainer, staggerItem } from '../lib/motion';

/**
 * AutomationTemplate - Pre-built automation template card
 */
const AutomationTemplate = ({ title, description, icon, triggers, isPopular }) => (
    <motion.div
        className="glass-card p-6 cursor-pointer relative overflow-hidden"
        variants={staggerItem}
        whileHover={{ scale: 1.02, y: -4 }}
        whileTap={{ scale: 0.98 }}
    >
        {isPopular && (
            <div className="absolute top-3 right-3 bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                Popular
            </div>
        )}

        <div className="text-4xl mb-4">{icon}</div>
        <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
        <p className="text-sm text-slate-400 mb-4">{description}</p>

        <div className="flex items-center gap-2 text-xs text-slate-500">
            <Clock className="w-3 h-3" />
            <span>{triggers}</span>
        </div>

        <motion.div
            className="flex items-center gap-1 text-blue-400 font-bold text-sm mt-4 pt-4 border-t border-white/5"
            whileHover={{ x: 4 }}
        >
            Use Template <ArrowRight className="w-4 h-4" />
        </motion.div>
    </motion.div>
);

/**
 * AutomationBuilder - Visual automation builder placeholder
 */
const AutomationBuilder = ({ companyId }) => {
    const templates = [
        {
            title: 'Reactivation Loop',
            description: 'Automatically re-engage drivers who haven\'t responded in 7+ days',
            icon: '🔄',
            triggers: 'Triggers after 7 days of inactivity',
            isPopular: true,
        },
        {
            title: 'Welcome Sequence',
            description: 'Send a series of onboarding messages to new applicants',
            icon: '👋',
            triggers: 'Triggers on new application',
            isPopular: true,
        },
        {
            title: 'Interview Reminder',
            description: 'Remind drivers about upcoming scheduled interviews',
            icon: '📅',
            triggers: 'Triggers 24h before interview',
            isPopular: false,
        },
        {
            title: 'Win-back Campaign',
            description: 'Re-engage drivers who withdrew their application',
            icon: '💪',
            triggers: 'Triggers on status change to Withdrawn',
            isPopular: false,
        },
        {
            title: 'Birthday Greeting',
            description: 'Send personalized birthday messages to your driver pool',
            icon: '🎂',
            triggers: 'Triggers on driver birthday',
            isPopular: false,
        },
        {
            title: 'Compliance Check',
            description: 'Notify drivers when their documents are expiring',
            icon: '📋',
            triggers: 'Triggers 30 days before expiry',
            isPopular: false,
        },
    ];

    return (
        <motion.div
            variants={staggerContainer}
            initial="initial"
            animate="animate"
        >
            {/* Header */}
            <div className="text-center mb-12">
                <motion.div
                    className="inline-flex items-center gap-2 bg-purple-500/20 text-purple-300 px-4 py-2 rounded-full mb-4"
                    variants={staggerItem}
                >
                    <Zap className="w-4 h-4" />
                    <span className="text-sm font-bold uppercase tracking-wider">Coming Soon</span>
                </motion.div>

                <motion.h2
                    className="text-3xl font-black text-white mb-4"
                    variants={staggerItem}
                >
                    Automation Engine
                </motion.h2>

                <motion.p
                    className="text-slate-400 max-w-2xl mx-auto"
                    variants={staggerItem}
                >
                    Build powerful, automated workflows that engage your drivers at the perfect moment.
                    Set triggers, define conditions, and let the engine do the work.
                </motion.p>
            </div>

            {/* Visual Builder Teaser */}
            <motion.div
                className="glass-card p-8 mb-10 relative overflow-hidden"
                variants={staggerItem}
            >
                <div className="absolute inset-0 bg-gradient-to-r from-purple-600/10 to-blue-600/10" />

                <div className="relative z-10 flex items-center justify-center gap-8">
                    {/* Mock Flow Diagram */}
                    <div className="flex items-center gap-4">
                        <div className="w-20 h-20 rounded-2xl bg-purple-600/30 border border-purple-500/30 flex items-center justify-center">
                            <Users className="w-8 h-8 text-purple-300" />
                        </div>
                        <motion.div
                            className="w-12 h-0.5 bg-gradient-to-r from-purple-500 to-blue-500"
                            animate={{ opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                        />
                        <div className="w-20 h-20 rounded-2xl bg-blue-600/30 border border-blue-500/30 flex items-center justify-center">
                            <Clock className="w-8 h-8 text-blue-300" />
                        </div>
                        <motion.div
                            className="w-12 h-0.5 bg-gradient-to-r from-blue-500 to-emerald-500"
                            animate={{ opacity: [0.5, 1, 0.5] }}
                            transition={{ duration: 1.5, repeat: Infinity, delay: 0.5 }}
                        />
                        <div className="w-20 h-20 rounded-2xl bg-emerald-600/30 border border-emerald-500/30 flex items-center justify-center">
                            <MessageSquare className="w-8 h-8 text-emerald-300" />
                        </div>
                    </div>
                </div>

                <p className="text-center text-slate-400 mt-6">
                    Visual drag-and-drop builder for creating automated sequences
                </p>
            </motion.div>

            {/* Template Gallery */}
            <motion.h3
                className="text-xl font-bold text-white mb-6"
                variants={staggerItem}
            >
                Automation Templates
            </motion.h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {templates.map((template, i) => (
                    <AutomationTemplate key={i} {...template} />
                ))}
            </div>

            {/* Request Access CTA */}
            <motion.div
                className="mt-12 text-center"
                variants={staggerItem}
            >
                <p className="text-slate-400 mb-4">
                    Want early access to the Automation Engine?
                </p>
                <motion.button
                    className="glass-button-primary px-8 py-4 rounded-xl font-bold text-lg"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                >
                    ⚡ Join the Waitlist
                </motion.button>
            </motion.div>
        </motion.div>
    );
};

export default AutomationBuilder;
