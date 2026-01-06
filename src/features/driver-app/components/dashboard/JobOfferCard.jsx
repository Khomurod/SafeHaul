import React, { useState } from 'react';
import {
    MapPin, DollarSign, Briefcase, CheckCircle,
    ChevronDown, ChevronUp, Truck, Clock, Loader2
} from 'lucide-react';

export function JobOfferCard({ job, onApply, isApplying, isApplied }) {
    const [expanded, setExpanded] = useState(false);

    // Format Pay Display
    const formatPay = () => {
        if (job.payModel === 'cpm' || job.payModel === 'percentage') {
            const unit = job.payModel === 'cpm' ? 'CPM' : '%';
            return `${job.payMin} - ${job.payMax} ${unit}`;
        }
        if (job.payModel === 'flatRate' || job.payModel === 'hourly') {
            // For flat/hourly, maybe just show the logic or weekly est
            return `$${job.estimatedWeeklyPay?.toLocaleString()}/wk (Est)`;
        }
        return 'Competitive Pay';
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow overflow-hidden group">
            <div className="p-6">
                <div className="flex flex-col md:flex-row gap-6">
                    {/* Logo */}
                    <div className="flex-shrink-0">
                        <div className="w-16 h-16 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden">
                            {job.companyLogo ? (
                                <img src={job.companyLogo} alt={job.companyName} className="w-full h-full object-cover" />
                            ) : (
                                <Briefcase className="text-gray-400" size={32} />
                            )}
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1">
                        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
                            <div>
                                <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                                    {job.title}
                                </h3>
                                <div className="flex items-center gap-2 text-gray-500 mt-1 text-sm font-medium">
                                    <span>{job.companyName}</span>
                                    <span>•</span>
                                    <span className="capitalize">{job.routeType}</span>
                                </div>

                                <div className="flex flex-wrap gap-2 mt-3">
                                    <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs font-bold rounded-md border border-emerald-100 uppercase tracking-wider">
                                        {formatPay()}
                                    </span>
                                    <span className="px-2.5 py-1 bg-blue-50 text-blue-700 text-xs font-bold rounded-md border border-blue-100 uppercase tracking-wider capitalize">
                                        {job.positionType?.replace(/([A-Z])/g, ' $1').trim()}
                                    </span>
                                    {job.freightTypes?.slice(0, 2).map(ft => (
                                        <span key={ft} className="px-2.5 py-1 bg-gray-100 text-gray-600 text-xs font-bold rounded-md border border-gray-200 uppercase tracking-wider">
                                            {ft}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            <div className="flex-shrink-0">
                                <button
                                    onClick={onApply}
                                    disabled={isApplying || isApplied}
                                    className={`px-6 py-2.5 font-bold rounded-lg shadow-sm w-full md:w-auto transition-colors flex items-center justify-center gap-2 ${isApplied
                                            ? 'bg-emerald-100 text-emerald-700 cursor-default'
                                            : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-70'
                                        }`}
                                >
                                    {isApplying ? (
                                        <><Loader2 className="animate-spin" size={18} /> Sending...</>
                                    ) : isApplied ? (
                                        <><CheckCircle size={18} /> Applied</>
                                    ) : (
                                        <>Apply Now</>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Quick Info Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 py-4 border-t border-b border-gray-100">
                    <div>
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">Weekly Avg</span>
                        <span className="text-sm font-bold text-gray-900">${job.estimatedWeeklyPay?.toLocaleString()}</span>
                    </div>
                    <div>
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">Home Time</span>
                        <span className="text-sm font-bold text-gray-900">Weekly</span>
                    </div>
                    <div>
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">Experience</span>
                        <span className="text-sm font-bold text-gray-900 capitalize">{job.minExperience?.replace(/([A-Z])/g, ' $1').trim()}</span>
                    </div>
                    <div>
                        <span className="text-xs text-gray-400 font-bold uppercase tracking-wider block mb-1">Hiring Areas</span>
                        <span className="text-sm font-bold text-gray-900">{job.hiringStates?.length > 0 ? `${job.hiringStates.length} States` : 'Nationwide'}</span>
                    </div>
                </div>

                {/* Expanded Details */}
                {expanded && (
                    <div className="mt-6 animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Benefits & Perks</h4>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                {Object.entries(job.benefits || {}).filter(([_, v]) => v).map(([key, value]) => (
                                    <div key={key} className="flex items-center gap-2">
                                        <CheckCircle size={14} className="text-emerald-500" />
                                        <span className="text-sm text-gray-600 font-medium capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <button
                    onClick={() => setExpanded(!expanded)}
                    className="w-full mt-4 flex items-center justify-center gap-1 text-sm font-bold text-gray-500 hover:text-gray-800 transition-colors"
                >
                    {expanded ? 'Show Less' : 'View Details'}
                    {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
            </div>
        </div>
    );
}