import React from 'react';
import { Globe, Phone, Info, ShieldAlert } from 'lucide-react';

export function NetworkInsights({ driver }) {
    return (
        <div className="space-y-6">
            <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                <h3 className="text-lg font-bold text-purple-900 mb-2 flex items-center gap-2">
                    <Globe size={20}/> Network Insights
                </h3>
                <p className="text-sm text-purple-700 mb-4">
                    Shared data from the SafeHaul network to help you make better decisions. 
                    Recruiter identities are anonymized.
                </p>

                <div className="bg-white p-5 rounded-lg border border-purple-100 shadow-sm">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Last Contact Result</h4>
                    
                    {driver.lastNetworkCall ? (
                        <div className="flex items-start gap-4">
                            <div className="p-2 bg-gray-100 rounded-full text-gray-500">
                                <Phone size={20} />
                            </div>
                            <div>
                                <p className="font-bold text-lg text-gray-900">
                                    {driver.lastNetworkCall.outcome}
                                </p>
                                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                    Recorded: {driver.lastNetworkCall.timestamp?.seconds 
                                        ? new Date(driver.lastNetworkCall.timestamp.seconds * 1000).toLocaleDateString() 
                                        : 'Recently'}
                                </p>
                            </div>
                        </div>
                    ) : (
                        <div className="text-center py-6 text-gray-400">
                            <Info size={32} className="mx-auto mb-2 opacity-20"/>
                            <p>No recent network activity recorded.</p>
                        </div>
                    )}
                </div>
            </div>

            <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200 flex items-start gap-3">
                <ShieldAlert className="text-yellow-600 shrink-0 mt-0.5" size={18} />
                <div className="text-sm text-yellow-800">
                    <p className="font-bold">Privacy Note</p>
                    <p>This tab displays anonymized outcomes from other companies in the network. Your internal notes remain private and are never shared here.</p>
                </div>
            </div>
        </div>
    );
}
