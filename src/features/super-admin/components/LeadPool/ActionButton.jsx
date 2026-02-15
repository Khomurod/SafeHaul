import React from 'react';
import { Loader2 } from 'lucide-react';

export function ActionButton({ label, icon: Icon, onClick, loading, disabled, variant = 'default', danger = false }) {
    const baseClasses = "flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold transition-all text-sm";
    const variants = {
        default: danger
            ? "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300"
            : "bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400",
        outline: danger
            ? "border-2 border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
            : "border-2 border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50",
        warning: "bg-orange-500 text-white hover:bg-orange-600 disabled:bg-orange-300"
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled || loading}
            className={`${baseClasses} ${variants[variant]}`}
        >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Icon size={18} />}
            {label}
        </button>
    );
}
