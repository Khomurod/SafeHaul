import React from 'react';

/**
 * StickyActionBar - Fixed action bar for primary actions
 * 
 * @param {React.ReactNode} children - Action buttons
 * @param {'top' | 'bottom'} position - Position of the bar
 * @param {string} className - Additional CSS classes
 */
export function StickyActionBar({
    children,
    position = 'bottom',
    className = ''
}) {
    const positionClasses = position === 'top'
        ? 'top-0 border-b'
        : 'bottom-0 border-t';

    return (
        <div className={`sticky ${positionClasses} z-20 px-6 py-4 bg-white border-gray-200 shadow-sticky flex items-center justify-between gap-4 ${className}`}>
            {children}
        </div>
    );
}

/**
 * ActionGroup - Group of action buttons within StickyActionBar
 * 
 * @param {'left' | 'right' | 'center'} align - Alignment of buttons
 * @param {React.ReactNode} children - Action buttons
 */
export function ActionGroup({ align = 'left', children }) {
    const alignClasses = {
        left: 'justify-start',
        right: 'justify-end',
        center: 'justify-center'
    };

    return (
        <div className={`flex items-center gap-3 ${alignClasses[align]}`}>
            {children}
        </div>
    );
}

/**
 * ActionButton - Styled button for use in StickyActionBar
 * 
 * @param {'primary' | 'secondary' | 'danger' | 'ghost'} variant - Button style
 * @param {React.ReactNode} icon - Optional icon
 * @param {React.ReactNode} children - Button text
 * @param {boolean} disabled - Disabled state
 * @param {function} onClick - Click handler
 */
export function ActionButton({
    variant = 'secondary',
    icon,
    children,
    disabled = false,
    onClick,
    className = ''
}) {
    const variantClasses = {
        primary: 'bg-gradient-to-r from-blue-600 to-purple-600 text-white hover:from-blue-700 hover:to-purple-700 shadow-md',
        secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50 shadow-sm',
        danger: 'text-red-600 hover:bg-red-50',
        ghost: 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`inline-flex items-center gap-2 px-4 py-2 font-semibold rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
        >
            {icon}
            {children}
        </button>
    );
}

export default StickyActionBar;
