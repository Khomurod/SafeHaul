import React, { useMemo, useState } from 'react';
import { Briefcase, AlertTriangle, MapPin, Phone, ChevronDown, ChevronUp } from 'lucide-react';
import { formatPhoneNumber } from '@shared/utils/helpers';

/**
 * EmploymentTimeline - Visual 10-year employment history with gap highlighting
 */
export function EmploymentTimeline({ appData }) {
    const [expandedIndex, setExpandedIndex] = useState(null);

    // Check both possible field names for employment data
    const employers = appData?.employers || appData?.employmentHistory || [];
    const gaps = appData?.unemployment || appData?.employmentGaps || [];

    // Parse dates and sort employers
    const timelineData = useMemo(() => {
        if (employers.length === 0) return [];

        // Helper to parse date strings like "01/2022" or "Jan 2022"
        const parseDate = (dateStr) => {
            if (!dateStr) return null;

            // Try MM/YYYY format
            const slashMatch = dateStr.match(/^(\d{1,2})\/(\d{4})$/);
            if (slashMatch) {
                return new Date(parseInt(slashMatch[2]), parseInt(slashMatch[1]) - 1);
            }

            // Try "Month Year" format
            const monthMatch = dateStr.match(/^([A-Za-z]+)\s*(\d{4})$/);
            if (monthMatch) {
                const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
                const monthIndex = months.findIndex(m => monthMatch[1].toLowerCase().startsWith(m));
                if (monthIndex >= 0) {
                    return new Date(parseInt(monthMatch[2]), monthIndex);
                }
            }

            return null;
        };

        // Parse employer dates
        const parsed = employers.map((emp, index) => {
            // Handle "dates" field which might be "01/2020 - 03/2022" or "from" and "to" fields
            let startDate = null;
            let endDate = null;

            if (emp.dates) {
                const parts = emp.dates.split(/\s*[-–to]+\s*/i);
                if (parts.length >= 2) {
                    startDate = parseDate(parts[0].trim());
                    const endPart = parts[1].trim().toLowerCase();
                    endDate = endPart === 'present' || endPart === 'current'
                        ? new Date()
                        : parseDate(parts[1].trim());
                }
            } else {
                startDate = parseDate(emp.from || emp.startDate);
                const endPart = emp.to || emp.endDate;
                endDate = endPart?.toLowerCase() === 'present' ? new Date() : parseDate(endPart);
            }

            return {
                ...emp,
                index,
                startDate,
                endDate,
                isPresent: !emp.to || emp.to?.toLowerCase() === 'present'
            };
        }).filter(e => e.startDate);

        // Sort by start date descending (most recent first)
        parsed.sort((a, b) => (b.startDate?.getTime() || 0) - (a.startDate?.getTime() || 0));

        return parsed;
    }, [employers]);

    // Calculate timeline bounds
    const { minDate, maxDate, totalMonths } = useMemo(() => {
        if (timelineData.length === 0) return { minDate: null, maxDate: null, totalMonths: 0 };

        const dates = timelineData.flatMap(e => [e.startDate, e.endDate]).filter(Boolean);
        const min = new Date(Math.min(...dates.map(d => d.getTime())));
        const max = new Date(Math.max(...dates.map(d => d.getTime())));

        // Extend to at least 10 years back or data range
        const tenYearsAgo = new Date();
        tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
        const adjustedMin = new Date(Math.min(min.getTime(), tenYearsAgo.getTime()));

        const months = (max.getFullYear() - adjustedMin.getFullYear()) * 12 + (max.getMonth() - adjustedMin.getMonth());

        return { minDate: adjustedMin, maxDate: max, totalMonths: Math.max(months, 1) };
    }, [timelineData]);

    // Color palette for employers
    const colors = [
        'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-teal-500',
        'bg-cyan-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'
    ];

    if (employers.length === 0) {
        return (
            <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl border border-gray-200 p-8 text-center">
                <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-4">
                    <Briefcase className="w-7 h-7 text-gray-400" />
                </div>
                <h4 className="text-gray-700 font-semibold mb-1">No Employment History</h4>
                <p className="text-gray-500 text-sm max-w-xs mx-auto">
                    Employment history will appear here once the applicant provides it in their application.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-800 flex items-center gap-2">
                    <Briefcase size={18} className="text-gray-400" />
                    Employment Timeline
                    <span className="text-sm font-normal text-gray-500">
                        ({employers.length} employer{employers.length !== 1 ? 's' : ''})
                    </span>
                </h3>
            </div>

            {/* Visual Timeline Bar */}
            {minDate && maxDate && (
                <div className="px-5 py-4 border-b border-gray-100">
                    <div className="relative">
                        {/* Year markers */}
                        <div className="flex justify-between text-[10px] text-gray-400 mb-2 px-1">
                            <span>{minDate.getFullYear()}</span>
                            <span>{maxDate.getFullYear()}</span>
                        </div>

                        {/* Timeline bar container */}
                        <div className="h-8 bg-gray-100 rounded-lg relative overflow-hidden">
                            {timelineData.map((emp, i) => {
                                const startOffset = ((emp.startDate.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * 100;
                                const endOffset = ((emp.endDate.getTime() - minDate.getTime()) / (maxDate.getTime() - minDate.getTime())) * 100;
                                const width = Math.max(endOffset - startOffset, 2); // Minimum 2% width

                                return (
                                    <div
                                        key={i}
                                        className={`absolute top-1 bottom-1 ${colors[i % colors.length]} rounded cursor-pointer transition-all hover:opacity-80`}
                                        style={{ left: `${startOffset}%`, width: `${width}%` }}
                                        onClick={() => setExpandedIndex(expandedIndex === emp.index ? null : emp.index)}
                                        title={emp.name}
                                    />
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Employment Gaps Warning */}
            {gaps.length > 0 && (
                <div className="px-5 py-3 bg-yellow-50 border-b border-yellow-100 flex items-center gap-2">
                    <AlertTriangle size={16} className="text-yellow-600 shrink-0" />
                    <span className="text-sm text-yellow-800">
                        <strong>{gaps.length}</strong> employment gap{gaps.length !== 1 ? 's' : ''} reported
                    </span>
                </div>
            )}

            {/* Employer Cards */}
            <div className="divide-y divide-gray-100">
                {timelineData.map((emp, i) => (
                    <div key={i} className="group">
                        {/* Summary Row */}
                        <button
                            onClick={() => setExpandedIndex(expandedIndex === emp.index ? null : emp.index)}
                            className="w-full px-5 py-4 flex items-center gap-4 text-left hover:bg-gray-50 transition-colors"
                        >
                            <div className={`w-3 h-3 rounded-full ${colors[i % colors.length]} shrink-0`} />
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900 truncate">{emp.name}</p>
                                <p className="text-sm text-gray-500">
                                    {emp.dates || `${emp.from} - ${emp.to || 'Present'}`}
                                    {emp.position && ` • ${emp.position}`}
                                </p>
                            </div>
                            <div className="shrink-0 text-gray-400">
                                {expandedIndex === emp.index ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </div>
                        </button>

                        {/* Expanded Details */}
                        {expandedIndex === emp.index && (
                            <div className="px-5 pb-4 pl-12 space-y-2 animate-in slide-in-from-top-2 duration-200">
                                {(emp.city || emp.state) && (
                                    <p className="text-sm text-gray-600 flex items-center gap-2">
                                        <MapPin size={14} className="text-gray-400" />
                                        {[emp.city, emp.state].filter(Boolean).join(', ')}
                                    </p>
                                )}
                                {emp.phone && (
                                    <p className="text-sm text-gray-600 flex items-center gap-2">
                                        <Phone size={14} className="text-gray-400" />
                                        {formatPhoneNumber(emp.phone)}
                                    </p>
                                )}
                                {emp.reason && (
                                    <p className="text-sm text-gray-600">
                                        <span className="font-medium">Reason for leaving:</span> {emp.reason}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Gaps Section */}
            {gaps.length > 0 && (
                <div className="border-t border-gray-200 bg-gray-50 px-5 py-4">
                    <h4 className="text-xs font-bold text-gray-500 uppercase mb-3">Employment Gaps</h4>
                    <div className="space-y-2">
                        {gaps.map((gap, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                                <div className="w-2 h-2 rounded-full bg-yellow-400 mt-1.5 shrink-0" />
                                <div>
                                    <span className="font-medium text-gray-700">
                                        {gap.startDate} - {gap.endDate}:
                                    </span>
                                    <span className="text-gray-600 ml-1">{gap.details}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default EmploymentTimeline;
