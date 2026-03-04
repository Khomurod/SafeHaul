import React from 'react';
import { CheckCircle, HelpCircle } from 'lucide-react';

/**
 * FieldConfidenceTag - Shows "Verified" vs "Self-Reported" tags
 * 
 * @param {'verified' | 'self-reported'} confidence - Confidence level
 * @param {'sm' | 'md'} size - Tag size
 */
export function FieldConfidenceTag({ confidence = 'self-reported', size = 'sm' }) {
    const isVerified = confidence === 'verified';

    const sizeClasses = size === 'sm'
        ? 'text-xs px-1.5 py-0.5 gap-1'
        : 'text-sm px-2 py-1 gap-1.5';

    const iconSize = size === 'sm' ? 12 : 14;

    if (isVerified) {
        return (
            <span className={`inline-flex items-center ${sizeClasses} font-medium text-green-700 bg-green-50 border border-green-200 rounded`}>
                <CheckCircle size={iconSize} />
                Verified
            </span>
        );
    }

    return (
        <span className={`inline-flex items-center ${sizeClasses} font-medium text-gray-500 bg-gray-50 border border-gray-200 rounded`}>
            <HelpCircle size={iconSize} />
            Self-Reported
        </span>
    );
}

export default FieldConfidenceTag;
