import React from 'react';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';

/**
 * InlineValidationNote - Soft warning for inconsistent entries
 * 
 * @param {'warning' | 'info' | 'error'} type - Note type
 * @param {string} message - Note message
 * @param {string} className - Additional CSS classes
 */
export function InlineValidationNote({
    type = 'warning',
    message,
    className = ''
}) {
    const config = {
        warning: {
            bg: 'bg-amber-50',
            border: 'border-amber-200',
            text: 'text-amber-700',
            icon: AlertTriangle
        },
        info: {
            bg: 'bg-blue-50',
            border: 'border-blue-200',
            text: 'text-blue-700',
            icon: Info
        },
        error: {
            bg: 'bg-red-50',
            border: 'border-red-200',
            text: 'text-red-700',
            icon: AlertCircle
        }
    };

    const { bg, border, text, icon: Icon } = config[type];

    return (
        <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border ${bg} ${border} ${className}`}>
            <Icon size={16} className={`${text} mt-0.5 shrink-0`} />
            <span className={`text-sm ${text}`}>{message}</span>
        </div>
    );
}

export default InlineValidationNote;
