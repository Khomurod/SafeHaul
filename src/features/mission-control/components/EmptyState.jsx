import React from 'react';
import { motion } from 'framer-motion';
import { Rocket, Users, Zap, Target, MessageSquare, Search } from 'lucide-react';

/**
 * EmptyState - Reusable animated empty state component
 */
const EmptyState = ({
    icon: Icon = Rocket,
    emoji,
    title,
    description,
    actionLabel,
    onAction,
    variant = 'default', // default | floating | pulse
}) => {
    const variants = {
        default: {},
        floating: {
            y: [0, -12, 0],
        },
        pulse: {
            scale: [1, 1.1, 1],
            opacity: [1, 0.8, 1],
        },
    };

    return (
        <motion.div
            className="glass-card p-12 text-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
        >
            {/* Icon/Emoji */}
            <motion.div
                className="mb-6"
                animate={variants[variant]}
                transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            >
                {emoji ? (
                    <span className="text-7xl">{emoji}</span>
                ) : (
                    <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-white/10 flex items-center justify-center mx-auto">
                        <Icon className="w-10 h-10 text-blue-400" />
                    </div>
                )}
            </motion.div>

            {/* Title */}
            <h3 className="text-2xl font-black text-white mb-3">{title}</h3>

            {/* Description */}
            <p className="text-slate-400 mb-8 max-w-md mx-auto">
                {description}
            </p>

            {/* Action Button */}
            {actionLabel && onAction && (
                <motion.button
                    className="px-8 py-4 rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 text-white font-bold shadow-lg shadow-blue-500/30 flex items-center gap-2 mx-auto"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onAction}
                >
                    {actionLabel}
                </motion.button>
            )}
        </motion.div>
    );
};

// Pre-built empty states for common scenarios

export const NoSquadsEmpty = ({ onAction }) => (
    <EmptyState
        emoji="🎯"
        title="No Squads Yet"
        description="Create your first audience segment to start targeting drivers with precision campaigns."
        actionLabel="Create First Squad"
        onAction={onAction}
        variant="floating"
    />
);

export const NoMissionsEmpty = ({ onAction }) => (
    <EmptyState
        emoji="🚀"
        title="Ready for Liftoff"
        description="Launch your first engagement mission to start connecting with drivers. All campaigns will appear here."
        actionLabel="Create First Mission"
        onAction={onAction}
        variant="floating"
    />
);

export const NoAutomationsEmpty = ({ onAction }) => (
    <EmptyState
        emoji="⚡"
        title="Automation Engine"
        description="Build powerful automated workflows that engage your drivers at the perfect moment."
        actionLabel="Join the Waitlist"
        onAction={onAction}
        variant="pulse"
    />
);

export const NoResultsEmpty = ({ onClear }) => (
    <EmptyState
        icon={Search}
        title="No Results Found"
        description="Try adjusting your filters or search criteria to find what you're looking for."
        actionLabel="Clear Filters"
        onAction={onClear}
        variant="default"
    />
);

export const NoDriversEmpty = ({ onAction }) => (
    <EmptyState
        emoji="👥"
        title="No Drivers Match"
        description="Your current filters don't match any drivers. Try broadening your search criteria."
        actionLabel="Reset Filters"
        onAction={onAction}
        variant="default"
    />
);

export const LoadingState = () => (
    <div className="flex flex-col items-center justify-center py-20">
        <motion.div
            className="w-16 h-16 rounded-full border-4 border-blue-500 border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        />
        <p className="text-slate-400 mt-4">Loading...</p>
    </div>
);

export const ErrorState = ({ message, onRetry }) => (
    <EmptyState
        emoji="⚠️"
        title="Something Went Wrong"
        description={message || "We couldn't complete this action. Please try again."}
        actionLabel="Try Again"
        onAction={onRetry}
        variant="default"
    />
);

export default EmptyState;
