import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Rocket, X, CheckCircle, AlertTriangle, Clock, Users, MessageSquare, Mail, Phone } from 'lucide-react';

/**
 * LaunchSequence - Cinematic campaign launch modal with countdown
 */
const LaunchSequence = ({
    isOpen,
    onClose,
    onLaunch,
    targetCount = 0,
    method = 'sms',
    scheduledFor = null,
    isExecuting = false,
}) => {
    const [phase, setPhase] = useState('confirm'); // confirm | countdown | launching | success | error
    const [countdown, setCountdown] = useState(3);
    const [error, setError] = useState(null);

    // Reset phase when modal opens
    useEffect(() => {
        if (isOpen) {
            setPhase('confirm');
            setCountdown(3);
            setError(null);
        }
    }, [isOpen]);

    // Countdown logic
    useEffect(() => {
        if (phase === 'countdown' && countdown > 0) {
            const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
            return () => clearTimeout(timer);
        }
        if (phase === 'countdown' && countdown === 0) {
            handleLaunch();
        }
    }, [phase, countdown]);

    const startCountdown = () => {
        setPhase('countdown');
    };

    const handleLaunch = async () => {
        setPhase('launching');
        try {
            await onLaunch();
            setPhase('success');
        } catch (err) {
            console.error('Launch failed:', err);
            setError(err.message || 'Launch failed. Please try again.');
            setPhase('error');
        }
    };

    const methodIcon = method === 'sms' ? <Phone className="w-6 h-6" /> : <Mail className="w-6 h-6" />;
    const methodLabel = method === 'sms' ? 'SMS Messages' : 'Emails';

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                className="fixed inset-0 z-50 flex items-center justify-center"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
            >
                {/* Backdrop */}
                <motion.div
                    className="absolute inset-0 bg-black/90 backdrop-blur-xl"
                    onClick={phase === 'confirm' ? onClose : undefined}
                />

                {/* Modal */}
                <motion.div
                    className="relative z-10 w-full max-w-lg mx-4"
                    initial={{ scale: 0.9, y: 20 }}
                    animate={{ scale: 1, y: 0 }}
                    exit={{ scale: 0.9, y: 20 }}
                >
                    {/* Confirm Phase */}
                    {phase === 'confirm' && (
                        <div className="glass-card p-8 text-center">
                            <button
                                onClick={onClose}
                                className="absolute top-4 right-4 p-2 rounded-lg hover:bg-white/5 text-slate-400"
                            >
                                <X className="w-5 h-5" />
                            </button>

                            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-600 to-blue-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-blue-500/30">
                                <Rocket className="w-10 h-10 text-white" />
                            </div>

                            <h2 className="text-2xl font-black text-white mb-2">Ready to Launch?</h2>
                            <p className="text-slate-400 mb-8">
                                {scheduledFor ? 'Your campaign will be scheduled for later.' : 'Your campaign will start immediately.'}
                            </p>

                            {/* Summary */}
                            <div className="bg-white/5 rounded-2xl p-6 mb-8 text-left space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 text-slate-400">
                                        <Users className="w-5 h-5" />
                                        <span>Target Audience</span>
                                    </div>
                                    <span className="text-white font-bold">{targetCount.toLocaleString()} drivers</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3 text-slate-400">
                                        {methodIcon}
                                        <span>Delivery Method</span>
                                    </div>
                                    <span className="text-white font-bold">{methodLabel}</span>
                                </div>
                                {scheduledFor && (
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 text-slate-400">
                                            <Clock className="w-5 h-5" />
                                            <span>Scheduled For</span>
                                        </div>
                                        <span className="text-white font-bold">
                                            {new Date(scheduledFor).toLocaleString()}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-4">
                                <motion.button
                                    className="flex-1 py-4 rounded-xl bg-white/5 text-white font-bold border border-white/10"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={onClose}
                                >
                                    Cancel
                                </motion.button>
                                <motion.button
                                    className="flex-1 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold shadow-lg shadow-blue-500/30 flex items-center justify-center gap-2"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={startCountdown}
                                >
                                    <Rocket className="w-5 h-5" />
                                    {scheduledFor ? 'Schedule' : 'Launch Now'}
                                </motion.button>
                            </div>
                        </div>
                    )}

                    {/* Countdown Phase */}
                    {phase === 'countdown' && (
                        <div className="text-center py-12">
                            <motion.div
                                className="text-[120px] font-black text-white leading-none"
                                key={countdown}
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 1.5, opacity: 0 }}
                                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                            >
                                {countdown}
                            </motion.div>
                            <p className="text-slate-400 text-lg mt-4">Launching mission...</p>
                        </div>
                    )}

                    {/* Launching Phase */}
                    {phase === 'launching' && (
                        <div className="text-center py-12">
                            <motion.div
                                className="w-24 h-24 rounded-full border-4 border-blue-500 border-t-transparent mx-auto mb-6"
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            />
                            <h2 className="text-2xl font-black text-white mb-2">Launching...</h2>
                            <p className="text-slate-400">Initializing campaign sequence</p>
                        </div>
                    )}

                    {/* Success Phase */}
                    {phase === 'success' && (
                        <div className="glass-card p-8 text-center glass-glow-green">
                            <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                            >
                                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-600 to-emerald-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-emerald-500/30">
                                    <CheckCircle className="w-10 h-10 text-white" />
                                </div>
                            </motion.div>

                            <h2 className="text-2xl font-black text-white mb-2">Mission Launched! 🚀</h2>
                            <p className="text-slate-400 mb-8">
                                {scheduledFor
                                    ? 'Your campaign has been scheduled successfully.'
                                    : `Sending ${methodLabel.toLowerCase()} to ${targetCount.toLocaleString()} drivers.`
                                }
                            </p>

                            <motion.button
                                className="px-8 py-4 rounded-xl bg-white/10 text-white font-bold border border-white/10"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={onClose}
                            >
                                View Mission Status
                            </motion.button>
                        </div>
                    )}

                    {/* Error Phase */}
                    {phase === 'error' && (
                        <div className="glass-card p-8 text-center">
                            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-red-600 to-red-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-red-500/30">
                                <AlertTriangle className="w-10 h-10 text-white" />
                            </div>

                            <h2 className="text-2xl font-black text-white mb-2">Launch Failed</h2>
                            <p className="text-red-400 mb-8">{error}</p>

                            <div className="flex gap-4">
                                <motion.button
                                    className="flex-1 py-4 rounded-xl bg-white/5 text-white font-bold border border-white/10"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={onClose}
                                >
                                    Cancel
                                </motion.button>
                                <motion.button
                                    className="flex-1 py-4 rounded-xl bg-gradient-to-r from-red-600 to-red-500 text-white font-bold"
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => setPhase('confirm')}
                                >
                                    Try Again
                                </motion.button>
                            </div>
                        </div>
                    )}
                </motion.div>

                {/* Confetti for success */}
                {phase === 'success' && (
                    <Confetti />
                )}
            </motion.div>
        </AnimatePresence>
    );
};

/**
 * Confetti - Celebration particles
 */
const Confetti = () => {
    const particles = Array.from({ length: 50 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        delay: Math.random() * 0.5,
        color: ['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444'][Math.floor(Math.random() * 5)],
    }));

    return (
        <div className="fixed inset-0 pointer-events-none z-20 overflow-hidden">
            {particles.map(p => (
                <motion.div
                    key={p.id}
                    className="absolute w-3 h-3 rounded-full"
                    style={{
                        left: `${p.x}%`,
                        top: '-20px',
                        backgroundColor: p.color,
                    }}
                    initial={{ y: 0, opacity: 1, rotate: 0 }}
                    animate={{
                        y: '100vh',
                        opacity: 0,
                        rotate: 720,
                    }}
                    transition={{
                        duration: 2 + Math.random(),
                        delay: p.delay,
                        ease: 'easeOut',
                    }}
                />
            ))}
        </div>
    );
};

export default LaunchSequence;
