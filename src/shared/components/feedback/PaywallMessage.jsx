import React from 'react';
import { Lock, Mail } from 'lucide-react';

/**
 * Reusable component for displaying a paywall/upgrade message
 * when a feature is disabled for the company.
 */
export function PaywallMessage({ title, message }) {
    return (
        <div className="flex flex-col items-center justify-center p-12 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl border-2 border-dashed border-gray-200 text-center">
            <div className="w-20 h-20 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mb-6 shadow-lg">
                <Lock size={40} />
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">{title || 'Paid Feature'}</h3>
            <p className="text-gray-600 max-w-md mb-6 leading-relaxed">
                {message || 'This feature is only available to premium subscribers.'}
            </p>
            <a
                href="mailto:info@safehaul.io"
                className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition shadow-lg"
            >
                <Mail size={18} /> Contact info@safehaul.io
            </a>
        </div>
    );
}
