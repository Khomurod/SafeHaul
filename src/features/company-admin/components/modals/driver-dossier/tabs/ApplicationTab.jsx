import React, { useState } from 'react';
import {
    User,
    MapPin,
    Calendar,
    CreditCard,
    Truck,
    AlertTriangle,
    CheckCircle,
    Clock,
    Briefcase,
    Eye,
    EyeOff,
    FileText
} from 'lucide-react';
import { formatDate } from '@shared/utils/helpers';
import { APPLICATION_SCHEMA } from '@/config/applicationSchema';
import { SchemaSection } from '@shared/components/schema/SchemaRenderer';

export function ApplicationTab({ appData }) {
    const [viewMode, setViewMode] = useState('summary'); // 'summary' | 'full'

    if (!appData) return null;

    return (
        <div className="space-y-6">
            {/* Toggle Header */}
            <div className="flex items-center justify-between bg-gray-50 p-1 rounded-lg border border-gray-200 w-fit">
                <button
                    onClick={() => setViewMode('summary')}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'summary'
                        ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    Summary View
                </button>
                <button
                    onClick={() => setViewMode('full')}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${viewMode === 'full'
                        ? 'bg-white text-blue-600 shadow-sm border border-gray-200'
                        : 'text-gray-500 hover:text-gray-700'
                        }`}
                >
                    <div className="flex items-center gap-2">
                        <FileText size={14} />
                        Full Application
                    </div>
                </button>
            </div>

            {viewMode === 'summary' ? (
                /* Summary View (Cards) */
                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 animate-in fade-in duration-300">

                    {/* 1. Identity Card (Col Span 6) */}
                    <div className="md:col-span-6">
                        <IdentityCard appData={appData} />
                    </div>

                    {/* 2. License Card (Col Span 6) */}
                    <div className="md:col-span-6">
                        <LicenseCard appData={appData} />
                    </div>

                    {/* 3. Stats / Summary (Col Span 12) */}
                    <div className="md:col-span-12">
                        <SafetyCard appData={appData} />
                    </div>

                    {/* 4. Experience Timeline (Col Span 12) */}
                    <div className="md:col-span-12">
                        <ExperienceTimeline appData={appData} />
                    </div>
                </div>
            ) : (
                /* Full Application View (Schema Renderer) */
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 animate-in fade-in duration-300">
                    <div className="max-w-4xl mx-auto space-y-8">
                        {APPLICATION_SCHEMA.sections.map(section => (
                            <div key={section.id} className="border-b border-gray-100 pb-8 last:border-0 last:pb-0">
                                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
                                    {section.title}
                                </h3>
                                <SchemaSection
                                    sectionId={section.id}
                                    data={appData}
                                    mode="display"
                                    isEditing={false} // Read Only
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// --- Sub-Components ---

function IdentityCard({ appData }) {
    const [showSSN, setShowSSN] = useState(false);
    const ssn = appData.ssn || 'Unknown';
    const maskedSSN = ssn.length > 4 ? `***-**-${ssn.slice(-4)}` : '***-**-****';

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 h-full">
            <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <User size={20} />
                </div>
                <h3 className="font-bold text-gray-800">Personal Information</h3>
            </div>

            <div className="space-y-4">
                <InfoRow
                    label="Full Name"
                    value={`${appData.firstName || ''} ${appData.lastName || ''}`}
                />
                <InfoRow
                    label="Date of Birth"
                    value={appData.dob ? formatDate(appData.dob) : '--'}
                    icon={Calendar}
                />
                <InfoRow
                    label="Address"
                    value={[appData.address, appData.city, appData.state, appData.zip].filter(Boolean).join(', ') || '--'}
                    icon={MapPin}
                />
                <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <span className="text-xs font-semibold text-gray-400 uppercase">SSN</span>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 font-mono">
                            {showSSN ? ssn : maskedSSN}
                        </span>
                        <button
                            onClick={() => setShowSSN(!showSSN)}
                            className="text-gray-400 hover:text-gray-600"
                        >
                            {showSSN ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function LicenseCard({ appData }) {
    const expDate = appData.cdlExpirationDate ? new Date(appData.cdlExpirationDate) : null;
    const today = new Date();
    const daysUntilExp = expDate ? Math.ceil((expDate - today) / (1000 * 60 * 60 * 24)) : null;

    let badge = null;
    if (daysUntilExp !== null) {
        if (daysUntilExp < 0) {
            badge = <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded">EXPIRED</span>;
        } else if (daysUntilExp < 30) {
            badge = <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded">EXPIRING SOON</span>;
        } else {
            badge = <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded">VALID</span>;
        }
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 h-full">
            <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
                    <CreditCard size={20} />
                </div>
                <h3 className="font-bold text-gray-800">License Information</h3>
            </div>

            <div className="space-y-4">
                <InfoRow
                    label="CDL Number"
                    value={appData.cdlNumber || '--'}
                />
                <InfoRow
                    label="State of Issue"
                    value={appData.cdlState || '--'}
                />
                <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <span className="text-xs font-semibold text-gray-400 uppercase">Class</span>
                    <span className="text-sm font-bold text-gray-900 px-2 py-0.5 bg-gray-100 rounded">
                        {appData.cdlClass || appData.cdlType || 'A'}
                    </span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                    <span className="text-xs font-semibold text-gray-400 uppercase">Expiration</span>
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                            {appData.cdlExpirationDate ? formatDate(appData.cdlExpirationDate) : '--'}
                        </span>
                        {badge}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SafetyCard({ appData }) {
    const violations = appData.violations || [];
    const accidents = appData.accidents || [];
    const hasIncidents = violations.length > 0 || accidents.length > 0;

    if (!hasIncidents) {
        return (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-4">
                <div className="p-2 bg-green-100 text-green-700 rounded-full">
                    <CheckCircle size={24} />
                </div>
                <div>
                    <h4 className="font-bold text-green-800">Clean Record</h4>
                    <p className="text-sm text-green-600">No violations or accidents reported on this application.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
                <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
                    <AlertTriangle size={20} />
                </div>
                <h3 className="font-bold text-gray-800">Safety Record</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {violations.length > 0 && (
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-400 uppercase border-b border-gray-100 pb-1">Violations ({violations.length})</h4>
                        {violations.map((v, i) => (
                            <div key={i} className="flex flex-col text-sm">
                                <span className="font-semibold text-gray-800">{v.type || v.description || 'Violation'}</span>
                                <span className="text-gray-500 text-xs">{v.date ? formatDate(v.date) : 'No Date'}</span>
                            </div>
                        ))}
                    </div>
                )}
                {accidents.length > 0 && (
                    <div className="space-y-3">
                        <h4 className="text-xs font-bold text-gray-400 uppercase border-b border-gray-100 pb-1">Accidents ({accidents.length})</h4>
                        {accidents.map((a, i) => (
                            <div key={i} className="flex flex-col text-sm">
                                <span className="font-semibold text-gray-800">{a.type || a.description || 'Accident'}</span>
                                <span className="text-gray-500 text-xs">{a.date ? formatDate(a.date) : 'No Date'}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function ExperienceTimeline({ appData }) {
    const history = appData.employers || appData.employmentHistory || [];

    if (history.length === 0) return null;

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
            <div className="flex items-center gap-2 mb-6">
                <div className="p-2 bg-gray-100 text-gray-600 rounded-lg">
                    <Truck size={20} />
                </div>
                <h3 className="font-bold text-gray-800">Employment History</h3>
            </div>

            <div className="relative pl-4 border-l-2 border-gray-200 space-y-8">
                {history.map((job, idx) => (
                    <div key={idx} className="relative">
                        {/* Dot */}
                        <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-blue-500 ring-4 ring-white" />

                        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1">
                            <div>
                                <h4 className="font-bold text-gray-900">{job.companyName || 'Unknown Employer'}</h4>
                                <p className="text-sm text-gray-600">{job.position || 'Driver'}</p>
                            </div>
                            <div className="text-sm font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded">
                                {job.startDate ? formatDate(job.startDate) : '??'} - {job.endDate ? formatDate(job.endDate) : 'Present'}
                            </div>
                        </div>
                        {job.reasonForLeaving && (
                            <p className="mt-2 text-sm text-gray-500 italic">"Reason: {job.reasonForLeaving}"</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function InfoRow({ label, value, icon: Icon }) {
    return (
        <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
            <span className="text-xs font-semibold text-gray-400 uppercase flex items-center gap-1">
                {label}
            </span>
            <span className="text-sm font-medium text-gray-900 text-right truncate max-w-[60%]">
                {value}
            </span>
        </div>
    );
}
