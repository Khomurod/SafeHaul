import React from 'react';

/**
 * StatusBadge - Muted pill badge for status display
 * 
 * @param {string} status - Status value (New, In Review, Qualified, Hold, Rejected, Approved, Stale)
 * @param {'sm' | 'md'} size - Badge size
 * @param {'pill' | 'dot'} variant - Badge variant
 */
export function StatusBadge({ status, size = 'sm', variant = 'pill' }) {
    const statusConfig = {
        'New': {
            bg: 'bg-blue-100',
            text: 'text-blue-700',
            border: 'border-blue-200',
            dot: 'bg-blue-500'
        },
        'In Review': {
            bg: 'bg-purple-100',
            text: 'text-purple-700',
            border: 'border-purple-200',
            dot: 'bg-purple-500'
        },
        'Qualified': {
            bg: 'bg-green-100',
            text: 'text-green-700',
            border: 'border-green-200',
            dot: 'bg-green-500'
        },
        'Approved': {
            bg: 'bg-green-100',
            text: 'text-green-700',
            border: 'border-green-200',
            dot: 'bg-green-500'
        },
        'Hold': {
            bg: 'bg-amber-100',
            text: 'text-amber-700',
            border: 'border-amber-200',
            dot: 'bg-amber-500'
        },
        'Needs Info': {
            bg: 'bg-amber-100',
            text: 'text-amber-700',
            border: 'border-amber-200',
            dot: 'bg-amber-500'
        },
        'Rejected': {
            bg: 'bg-red-100',
            text: 'text-red-700',
            border: 'border-red-200',
            dot: 'bg-red-500'
        },
        'Stale': {
            bg: 'bg-gray-100',
            text: 'text-gray-600',
            border: 'border-gray-200',
            dot: 'bg-gray-400'
        },
        'Background Check': {
            bg: 'bg-indigo-100',
            text: 'text-indigo-700',
            border: 'border-indigo-200',
            dot: 'bg-indigo-500'
        },
        'Offer Sent': {
            bg: 'bg-teal-100',
            text: 'text-teal-700',
            border: 'border-teal-200',
            dot: 'bg-teal-500'
        }
    };

    const config = statusConfig[status] || statusConfig['New'];
    const sizeClasses = size === 'sm'
        ? 'px-2 py-0.5 text-xs'
        : 'px-3 py-1 text-sm';

    if (variant === 'dot') {
        return (
            <span className={`inline-flex items-center gap-1.5 ${sizeClasses} font-medium ${config.text}`}>
                <span className={`w-2 h-2 rounded-full ${config.dot}`} />
                {status}
            </span>
        );
    }

    return (
        <span className={`inline-flex items-center ${sizeClasses} font-semibold rounded-full border ${config.bg} ${config.text} ${config.border}`}>
            {status}
        </span>
    );
}

export default StatusBadge;
