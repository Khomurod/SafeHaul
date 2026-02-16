import React from 'react';
import { Loader2 } from 'lucide-react';

export function StatCard({ title, value, icon: Icon, color = 'blue', loading = false }) {
    const colorClasses = {
        blue: 'bg-blue-50 text-blue-600 border-blue-100',
        green: 'bg-green-50 text-green-600 border-green-100',
        orange: 'bg-orange-50 text-orange-600 border-orange-100',
        red: 'bg-red-50 text-red-600 border-red-100',
        purple: 'bg-purple-50 text-purple-600 border-purple-100'
    };

    return (
        <div className={`p-5 rounded-2xl border-2 ${colorClasses[color]} transition-all hover:shadow-md`}>
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs font-bold uppercase tracking-wider opacity-60">{title}</p>
                    {loading ? (
                        <Loader2 className="animate-spin mt-2" size={24} />
                    ) : (
                        <p className="text-3xl font-black mt-1">{value?.toLocaleString() || 0}</p>
                    )}
                </div>
                <div className={`p-2 rounded-lg bg-white/50`}>
                    <Icon size={24} />
                </div>
            </div>
        </div>
    );
}
