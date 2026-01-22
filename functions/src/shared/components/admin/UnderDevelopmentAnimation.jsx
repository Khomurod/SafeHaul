import React from 'react';
import { Construction, Wrench, HardHat } from 'lucide-react';

export function UnderDevelopmentAnimation() {
    return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
            <div className="relative mb-8">
                <div className="absolute inset-0 bg-yellow-200 rounded-full blur-xl opacity-50 animate-pulse" />
                <div className="relative bg-yellow-100 p-6 rounded-full border-4 border-yellow-300">
                    <Construction size={64} className="text-yellow-600" />
                </div>
            </div>
            
            <h3 className="text-2xl font-bold text-gray-800 mb-3">Under Development</h3>
            <p className="text-gray-500 text-center max-w-md mb-6">
                We're working hard to bring you this feature. Check back soon!
            </p>
            
            <div className="flex items-center gap-4 text-gray-400">
                <div className="flex items-center gap-1 animate-bounce" style={{ animationDelay: '0ms' }}>
                    <Wrench size={20} />
                </div>
                <div className="flex items-center gap-1 animate-bounce" style={{ animationDelay: '150ms' }}>
                    <HardHat size={20} />
                </div>
                <div className="flex items-center gap-1 animate-bounce" style={{ animationDelay: '300ms' }}>
                    <Wrench size={20} />
                </div>
            </div>
        </div>
    );
}
