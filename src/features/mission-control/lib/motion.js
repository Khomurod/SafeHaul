/**
 * Motion Presets for Framer Motion
 * Mission Control premium animations
 */

// Easing curves
export const easing = {
    smooth: [0.4, 0, 0.2, 1],
    bounce: [0.34, 1.56, 0.64, 1],
    snappy: [0.16, 1, 0.3, 1],
    gentle: [0.25, 0.1, 0.25, 1],
};

// Fade variants
export const fadeIn = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.3, ease: easing.smooth },
};

export const fadeInUp = {
    initial: { opacity: 0, y: 20 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 20 },
    transition: { duration: 0.4, ease: easing.smooth },
};

export const fadeInScale = {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.95 },
    transition: { duration: 0.3, ease: easing.bounce },
};

// Slide variants
export const slideIn = {
    left: {
        initial: { x: -100, opacity: 0 },
        animate: { x: 0, opacity: 1 },
        exit: { x: -100, opacity: 0 },
    },
    right: {
        initial: { x: 100, opacity: 0 },
        animate: { x: 0, opacity: 1 },
        exit: { x: 100, opacity: 0 },
    },
    up: {
        initial: { y: 50, opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: 50, opacity: 0 },
    },
    down: {
        initial: { y: -50, opacity: 0 },
        animate: { y: 0, opacity: 1 },
        exit: { y: -50, opacity: 0 },
    },
};

// Stagger container
export const staggerContainer = {
    initial: {},
    animate: {
        transition: {
            staggerChildren: 0.08,
            delayChildren: 0.1,
        },
    },
};

export const staggerItem = {
    initial: { opacity: 0, y: 16 },
    animate: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.4, ease: easing.smooth },
    },
};

// Card hover effect
export const cardHover = {
    rest: {
        scale: 1,
        boxShadow: '0 4px 24px rgba(0, 0, 0, 0.4)',
    },
    hover: {
        scale: 1.02,
        boxShadow: '0 8px 48px rgba(0, 0, 0, 0.5)',
        transition: { duration: 0.3, ease: easing.smooth },
    },
    tap: {
        scale: 0.98,
    },
};

// Glow pulse for live indicators
export const glowPulse = {
    animate: {
        boxShadow: [
            '0 0 20px rgba(59, 130, 246, 0.3)',
            '0 0 40px rgba(59, 130, 246, 0.5)',
            '0 0 20px rgba(59, 130, 246, 0.3)',
        ],
        transition: {
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
        },
    },
};

// Float animation
export const float = {
    animate: {
        y: [0, -8, 0],
        transition: {
            duration: 3,
            repeat: Infinity,
            ease: 'easeInOut',
        },
    },
};

// Metrics orb animation
export const orbPulse = {
    animate: {
        scale: [1, 1.05, 1],
        opacity: [1, 0.9, 1],
        transition: {
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
        },
    },
};

// Number counter animation config
export const counterSpring = {
    type: 'spring',
    stiffness: 100,
    damping: 15,
};

// Modal/overlay variants
export const overlay = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: 0.2 },
};

export const modal = {
    initial: { opacity: 0, scale: 0.9, y: 20 },
    animate: { opacity: 1, scale: 1, y: 0 },
    exit: { opacity: 0, scale: 0.9, y: 20 },
    transition: { duration: 0.3, ease: easing.bounce },
};

// Success celebration
export const celebration = {
    initial: { scale: 0, rotate: -180 },
    animate: {
        scale: [0, 1.2, 1],
        rotate: 0,
        transition: { duration: 0.6, ease: easing.bounce },
    },
};

// Error shake
export const shake = {
    animate: {
        x: [-4, 4, -4, 4, -2, 2, 0],
        transition: { duration: 0.5 },
    },
};

// Page transition
export const pageTransition = {
    initial: { opacity: 0, x: 20 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
    transition: { duration: 0.3, ease: easing.smooth },
};

// Tab content transition
export const tabContent = {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -10 },
    transition: { duration: 0.2 },
};
