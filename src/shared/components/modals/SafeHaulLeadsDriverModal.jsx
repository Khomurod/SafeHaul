import React, { useState, useEffect } from 'react';
import {
    X, Phone, Mail, MapPin, Truck, Briefcase,
    Clock, Shield, Globe, Info, User, Loader2
} from 'lucide-react';
import { formatExperience, normalizePhone } from '@shared/utils/helpers';
import { db } from '@lib/firebase';
import { doc, getDoc } from 'firebase/firestore';

function TelegramLogo({ className }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
        </svg>
    );
}

export function SafeHaulLeadsDriverModal({ lead, onClose, onCallStart }) {
    const [activeTab, setActiveTab] = useState('overview');
    const [networkData, setNetworkData] = useState(null);
    const [loadingInsights, setLoadingInsights] = useState(false);

    // Handle both fullName (distributed leads) and firstName/lastName patterns
    let firstName, lastName, fullName;

    if (lead.fullName) {
        // Distributed leads have fullName field
        fullName = lead.fullName;
        const nameParts = lead.fullName.trim().split(' ');
        firstName = nameParts[0] || 'Unknown';
        lastName = nameParts.slice(1).join(' ') || 'Driver';
    } else {
        // Legacy pattern or direct applications
        firstName = lead.firstName || 'Unknown';
        lastName = lead.lastName || 'Driver';
        fullName = `${firstName} ${lastName}`;
    }
    const city = lead.city || 'Unknown City';
    const state = lead.state || 'XX';

    const position = lead.positionApplyingTo || 'Unidentified';

    const experienceRaw = lead.experienceLevel || lead.experience || lead['experience-years'];
    const experience = experienceRaw ? (lead.experienceLevel || formatExperience(experienceRaw)) : 'Unidentified';

    let sourceInputLabel = 'None';
    if (lead.infoSource === 'driver') sourceInputLabel = 'Driver Input';
    if (lead.infoSource === 'recruiter') sourceInputLabel = 'User Input';

    let driverTypes = [];
    if (Array.isArray(lead.driverType)) {
        driverTypes = lead.driverType;
    } else if (typeof lead.driverType === 'string' && lead.driverType) {
        driverTypes = lead.driverType.split(',').map(t => t.trim());
    }

    useEffect(() => {
        if (activeTab === 'insights' && !networkData) {
            const fetchLiveInsights = async () => {
                setLoadingInsights(true);
                try {
                    const globalId = lead.originalLeadId || lead.id;

                    const leadRef = doc(db, "leads", globalId);
                    const leadSnap = await getDoc(leadRef);

                    if (leadSnap.exists()) {
                        setNetworkData(leadSnap.data());
                    } else {
                        const driverRef = doc(db, "drivers", globalId);
                        const driverSnap = await getDoc(driverRef);
                        if (driverSnap.exists()) {
                            setNetworkData(driverSnap.data());
                        }
                    }
                } catch (e) {
                    console.error("Error fetching insights:", e);
                } finally {
                    setLoadingInsights(false);
                }
            };
            fetchLiveInsights();
        }
    }, [activeTab, lead, networkData]);

    const sharedHistory = networkData?.sharedHistory || lead.sharedHistory || [];

    const handleCall = () => {
        if (lead.phone) {
            window.location.href = `tel:${lead.phone}`;
            onCallStart();
        } else {
            alert("No phone number on record.");
        }
    };

    const handleEmail = () => {
        if (lead.email && !lead.email.includes('placeholder')) {
            window.location.href = `mailto:${lead.email}`;
            onCallStart();
        } else {
            alert("No valid email address.");
        }
    };

    const handleTelegram = () => {
        if (lead.phone) {
            let cleaned = normalizePhone(lead.phone);
            if (cleaned.length === 10) cleaned = '1' + cleaned;
            const link = `https://t.me/+${cleaned}`;
            window.open(link, '_blank');
            onCallStart();
        } else {
            alert("No phone number for Telegram.");
        }
    };

    return (
        // FIX: Increased z-index from z-50 to z-[60] to prevent header conflicts
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl border border-gray-200 overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">

                <div className="bg-gradient-to-r from-slate-50 to-white border-b border-gray-200 p-6 flex justify-between items-start shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-16 h-16 bg-blue-600 text-white rounded-2xl flex items-center justify-center text-2xl font-bold shadow-blue-200 shadow-lg">
                            {firstName.charAt(0)}
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold text-gray-900">{fullName}</h2>
                            <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                                <span className="flex items-center gap-1 bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                                    <MapPin size={12} /> {city}, {state}
                                </span>
                                <span className="flex items-center gap-1 bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-100 font-medium">
                                    <Shield size={12} /> SafeHaul Lead
                                </span>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                <div className="flex border-b border-gray-200 px-6 shrink-0 bg-white">
                    <button
                        onClick={() => setActiveTab('overview')}
                        className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors ${activeTab === 'overview' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        Driver Overview
                    </button>
                    <button
                        onClick={() => setActiveTab('insights')}
                        className={`py-3 px-4 text-sm font-bold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'insights' ? 'border-purple-600 text-purple-600' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
                    >
                        <Globe size={16} /> Network Insights
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-gray-50">

                    {activeTab === 'overview' && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            <div className="space-y-6">
                                <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 border-b border-gray-100 pb-2">
                                        Qualifications
                                    </h3>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="text-xs text-gray-500 font-medium">Position Applying For</label>
                                            <p className="text-lg font-bold text-gray-900 flex items-center gap-2">
                                                <Briefcase size={18} className="text-blue-500" />
                                                {position}
                                            </p>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <label className="text-xs text-gray-500 font-medium">Experience</label>
                                                <p className="text-base font-semibold text-gray-800 flex items-center gap-2">
                                                    <Clock size={16} className="text-green-500" />
                                                    {experience}
                                                </p>
                                            </div>
                                            <div>
                                                <label className="text-xs text-gray-500 font-medium">Source Input</label>
                                                <div className="flex items-center mt-1">
                                                    <span className={`inline-flex px-2 py-1 text-xs rounded font-medium border ${sourceInputLabel === 'None' ? 'bg-gray-100 text-gray-500 border-gray-200' :
                                                            sourceInputLabel === 'User Input' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                                                'bg-green-50 text-green-700 border-green-200'
                                                        }`}>
                                                        {sourceInputLabel === 'User Input' && <User size={10} className="mr-1 mt-0.5" />}
                                                        {sourceInputLabel}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-xs text-gray-500 font-medium block mb-2">Freight Types</label>
                                            <div className="flex flex-wrap gap-2">
                                                {driverTypes.length > 0 && driverTypes[0].toLowerCase() !== 'unidentified' ? driverTypes.map(t => (
                                                    <span key={t} className="px-3 py-1 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-bold flex items-center gap-1">
                                                        <Truck size={12} /> {t}
                                                    </span>
                                                )) : (
                                                    <span className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 text-gray-500 border border-gray-200 rounded-lg text-xs font-bold">
                                                        <Truck size={12} /> Unidentified
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {lead.otherPreferences && (
                                    <div className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm">
                                        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
                                            Driver Preferences
                                        </h3>
                                        <p className="text-sm text-gray-700 italic bg-gray-50 p-3 rounded-lg border border-gray-100">
                                            "{lead.otherPreferences}"
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col gap-4">
                                <div className="bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl p-6 text-white shadow-lg relative overflow-hidden">
                                    <div className="relative z-10">
                                        <h3 className="text-xl font-bold mb-2">Contact Driver</h3>
                                        <p className="text-blue-100 text-sm mb-6">
                                            Contact details are hidden for privacy. Use the secure actions below to connect.
                                        </p>

                                        <div className="space-y-3">
                                            {lead.phone ? (
                                                <button
                                                    onClick={handleCall}
                                                    className="w-full py-3 px-4 bg-white text-blue-700 font-bold rounded-lg shadow-sm hover:bg-blue-50 transition-all flex items-center justify-center gap-3 group"
                                                >
                                                    <div className="p-1.5 bg-blue-100 rounded-full group-hover:bg-blue-200 transition-colors">
                                                        <Phone size={18} className="fill-blue-600" />
                                                    </div>
                                                    <span>Call Driver</span>
                                                </button>
                                            ) : (
                                                <div className="w-full py-3 px-4 bg-white/10 text-white/50 font-bold rounded-lg border border-white/20 text-center text-sm">
                                                    No Phone Available
                                                </div>
                                            )}

                                            {lead.email && !lead.email.includes('placeholder') ? (
                                                <button
                                                    onClick={handleEmail}
                                                    className="w-full py-3 px-4 bg-indigo-500/30 border border-white/20 text-white font-bold rounded-lg hover:bg-indigo-500/50 transition-all flex items-center justify-center gap-3"
                                                >
                                                    <Mail size={18} />
                                                    <span>Email Driver</span>
                                                </button>
                                            ) : null}

                                            {lead.phone && (
                                                <button
                                                    onClick={handleTelegram}
                                                    className="w-full py-3 px-4 bg-[#24A1DE] text-white font-bold rounded-lg hover:bg-[#2090C7] transition-all flex items-center justify-center gap-3 shadow-sm"
                                                >
                                                    <TelegramLogo className="w-5 h-5 fill-white" />
                                                    <span>Telegram</span>
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl"></div>
                                    <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-purple-500/20 rounded-full blur-2xl"></div>
                                </div>

                                <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-xl flex items-start gap-3">
                                    <Info className="text-yellow-600 shrink-0 mt-0.5" size={18} />
                                    <div className="text-xs text-yellow-800">
                                        <p className="font-bold mb-1">Lead Pool Rules:</p>
                                        <ul className="list-disc pl-3 space-y-1">
                                            <li>Mark as <strong>Interested</strong>: Send invite link.</li>
                                            <li>Mark as <strong>Hired</strong>: Removed from pool for 45 days.</li>
                                            <li>Mark as <strong>Rejected</strong>: Returns to pool in 7 days.</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'insights' && (
                        <div className="space-y-6">
                            <div className="bg-purple-50 p-6 rounded-xl border border-purple-100">
                                <h3 className="text-lg font-bold text-purple-900 mb-2 flex items-center gap-2">
                                    <Globe size={20} /> Network Insights
                                </h3>
                                <p className="text-sm text-purple-700 mb-4">
                                    Anonymized data from other recruiters in the SafeHaul network.
                                </p>

                                {loadingInsights ? (
                                    <div className="py-10 text-center text-purple-600 flex flex-col items-center">
                                        <Loader2 className="animate-spin mb-2" size={24} />
                                        <p className="text-xs">Checking global history...</p>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        {sharedHistory && sharedHistory.length > 0 ? (
                                            sharedHistory.map((history, idx) => (
                                                <div key={idx} className="bg-white p-4 rounded-lg border border-purple-100 shadow-sm flex gap-3">
                                                    <div className="mt-1">
                                                        <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600">
                                                            <Briefcase size={14} />
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <p className="text-sm font-bold text-gray-800">Previous Recruiter Note</p>
                                                        <p className="text-sm text-gray-600 mt-1">{history.text}</p>
                                                        <p className="text-xs text-gray-400 mt-2">
                                                            {history.date?.seconds
                                                                ? new Date(history.date.seconds * 1000).toLocaleDateString()
                                                                : 'Past Activity'}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))
                                        ) : (
                                            <div className="text-center py-10 bg-white rounded-xl border border-dashed border-gray-300">
                                                <Globe size={32} className="mx-auto mb-2 text-gray-300" />
                                                <p className="text-gray-500">No shared history available for this driver.</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}