import React from 'react';
import { Phone, Mail, MessageCircle, MapPin, Calendar, Briefcase, Clock } from 'lucide-react';
import { formatPhoneNumber, normalizePhone } from '@shared/utils/helpers';

/**
 * CandidateHero - Top header showing candidate info, quick stats, and contact actions
 */
export function CandidateHero({
    appData,
    currentStatus,
    handleStatusUpdate,
    canEdit,
    onPhoneClick
}) {
    if (!appData) return null;

    const fullName = `${appData.firstName || ''} ${appData.lastName || ''}`.trim() || 'Unknown';
    const initials = `${appData.firstName?.[0] || ''}${appData.lastName?.[0] || ''}`.toUpperCase() || '?';

    // Calculate experience display
    const experience = appData['experience-years'] || appData.experience || 'N/A';

    // Format position and driver types
    const position = appData.positionApplyingTo || 'Driver';
    const driverTypes = Array.isArray(appData.driverType)
        ? appData.driverType.slice(0, 2).join(', ') + (appData.driverType.length > 2 ? '...' : '')
        : appData.driverType || '';

    // Location
    const location = [appData.city, appData.state].filter(Boolean).join(', ') || 'Location not specified';

    // Applied date - robust parsing
    const parseAppDate = (val) => {
        if (!val) return null;
        try {
            if (val.toDate) return val.toDate();
            if (val.seconds) return new Date(val.seconds * 1000);
            const d = new Date(val);
            return isNaN(d.getTime()) ? null : d;
        } catch { return null; }
    };
    const parsedDate = parseAppDate(appData.createdAt) || parseAppDate(appData.submittedAt);
    const appliedDate = parsedDate
        ? parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : 'Date unavailable';

    // Telegram helper
    const getTelegramLink = (phone) => {
        if (!phone) return '#';
        let cleaned = normalizePhone(phone);
        if (cleaned.length === 10) cleaned = '1' + cleaned;
        return `https://t.me/+${cleaned}`;
    };

    // Status color
    const getStatusColor = (status) => {
        const colors = {
            'Approved': 'bg-green-500',
            'Rejected': 'bg-red-500',
            'Disqualified': 'bg-red-400',
            'Background Check': 'bg-purple-500',
            'In Review': 'bg-blue-500',
            'Contacted': 'bg-cyan-500',
            'Attempted': 'bg-orange-400',
            'New Application': 'bg-indigo-500',
            'New Lead': 'bg-indigo-400',
            'Awaiting Documents': 'bg-yellow-500',
            'Offer Sent': 'bg-emerald-500'
        };
        return colors[status] || 'bg-gray-500';
    };

    const STATUS_OPTIONS = [
        'New Application', 'New Lead', 'Contacted', 'Attempted',
        'In Review', 'Background Check', 'Awaiting Documents',
        'Approved', 'Rejected', 'Disqualified', 'Offer Sent'
    ];

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Main Content */}
            <div className="p-6">
                <div className="flex items-start gap-5">

                    {/* Avatar */}
                    <div className="shrink-0">
                        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                            <span className="text-2xl font-bold text-white">{initials}</span>
                        </div>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-gray-900 truncate">{fullName}</h2>
                                <div className="flex flex-wrap items-center gap-2 mt-1">
                                    <span className="text-gray-600 font-medium">{position}</span>
                                    {driverTypes && (
                                        <>
                                            <span className="text-gray-300">•</span>
                                            <span className="text-gray-500">{driverTypes}</span>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Quick Contact Actions */}
                            <div className="flex items-center gap-2 shrink-0">
                                {appData.phone && (
                                    <>
                                        <button
                                            onClick={(e) => {
                                                window.location.href = `tel:${appData.phone}`;
                                                if (onPhoneClick) onPhoneClick(e, appData);
                                            }}
                                            className="w-10 h-10 flex items-center justify-center rounded-full bg-green-100 text-green-600 hover:bg-green-200 transition-all shadow-sm hover:scale-105"
                                            title={`Call ${formatPhoneNumber(appData.phone)}`}
                                        >
                                            <Phone size={18} />
                                        </button>
                                        <a
                                            href={getTelegramLink(appData.phone)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="w-10 h-10 flex items-center justify-center rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200 transition-all shadow-sm hover:scale-105"
                                            title="Open Telegram"
                                        >
                                            <MessageCircle size={18} />
                                        </a>
                                    </>
                                )}
                                {appData.email && (
                                    <a
                                        href={`mailto:${appData.email}`}
                                        className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all shadow-sm hover:scale-105"
                                        title={`Email ${appData.email}`}
                                    >
                                        <Mail size={18} />
                                    </a>
                                )}
                            </div>
                        </div>

                        {/* Meta Row */}
                        <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-gray-500">
                            <span className="flex items-center gap-1.5">
                                <MapPin size={14} className="text-gray-400" />
                                {location}
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Briefcase size={14} className="text-gray-400" />
                                {experience} {(experience === '1' || experience === 1) ? 'year' : 'years'} exp.
                            </span>
                            <span className="flex items-center gap-1.5">
                                <Calendar size={14} className="text-gray-400" />
                                Applied {appliedDate}
                            </span>
                        </div>

                        {/* Job Applied For (if available) */}
                        {appData.jobTitle && (
                            <div className="mt-3">
                                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-xs font-semibold border border-blue-100">
                                    <Briefcase size={12} />
                                    Applied for: {appData.jobTitle}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Status Bar */}
            <div className="px-6 py-3 bg-gradient-to-r from-gray-50 to-gray-100 border-t border-gray-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(currentStatus)} shadow-sm ring-2 ring-white`} />
                    <span className="font-semibold text-gray-800">{currentStatus}</span>
                </div>

                {canEdit && (
                    <div className="relative">
                        <select
                            className="appearance-none px-4 py-2 pr-8 text-sm font-semibold border-2 border-gray-200 rounded-xl bg-white hover:border-blue-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer transition-all shadow-sm"
                            value={currentStatus}
                            onChange={(e) => handleStatusUpdate(e.target.value)}
                        >
                            {STATUS_OPTIONS.map(status => (
                                <option key={status} value={status}>{status}</option>
                            ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                            <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default CandidateHero;
