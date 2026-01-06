import React from 'react';
import { ArrowLeft, FileText, Globe } from 'lucide-react';
import { getFieldValue } from '@shared/utils/helpers';

export function DriverHeader({ driver, onBack, activeTab, setActiveTab }) {
    const pi = driver.personalInfo || {};

    return (
        <div className="p-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-4 mb-4">
                <button 
                    onClick={onBack} 
                    className="p-2 hover:bg-white rounded-full border border-transparent hover:border-gray-200 transition"
                >
                    <ArrowLeft size={20} className="text-gray-600"/>
                </button>
                <div>
                    <h2 className="text-xl font-bold text-gray-800">
                        {getFieldValue(pi.firstName)} {getFieldValue(pi.lastName)}
                    </h2>
                    <p className="text-sm text-gray-500">Driver Profile</p>
                </div>
            </div>

            <div className="flex space-x-6 px-2">
                <button
                    onClick={() => setActiveTab('profile')}
                    className={`pb-2 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                        activeTab === 'profile' 
                        ? 'border-blue-600 text-blue-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <FileText size={16}/> Profile Info
                </button>
                <button
                    onClick={() => setActiveTab('network')}
                    className={`pb-2 text-sm font-semibold transition-colors border-b-2 flex items-center gap-2 ${
                        activeTab === 'network' 
                        ? 'border-purple-600 text-purple-600' 
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                >
                    <Globe size={16}/> Network Insights
                </button>
            </div>
        </div>
    );
}
