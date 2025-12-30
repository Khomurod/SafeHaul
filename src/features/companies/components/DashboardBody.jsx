// src/features/companies/components/DashboardBody.jsx

import React from 'react';
import { 
  Phone, MapPin, User, Calendar, Briefcase, Zap, PhoneOutgoing,
  CheckCircle2, MessageSquare, XCircle, Clock, ThumbsDown, Ban, Lock,
  CheckSquare, Square
} from 'lucide-react';
// FIXED IMPORT PATH BELOW
import { getFieldValue, formatPhoneNumber } from '@shared/utils/helpers';

const getStatusBadgeStyles = (status) => {
    const s = (status || '').toLowerCase();
    if (s.includes('hired') || s.includes('accepted') || s.includes('approved')) return 'bg-green-100 text-green-800 border-green-200';
    if (s.includes('rejected') || s.includes('disqualified') || s.includes('declined')) return 'bg-red-100 text-red-800 border-red-200';
    if (s.includes('offer') || s.includes('background')) return 'bg-purple-100 text-purple-800 border-purple-200';
    if (s.includes('contacted') || s.includes('attempted') || s.includes('review')) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (s.includes('new') || s.includes('lead')) return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-gray-100 text-gray-700 border-gray-200';
};

const getOutcomeConfig = (outcome) => {
    const o = (outcome || '').toLowerCase();

    if (o.includes('connected') || o.includes('spoke') || o.includes('interested')) {
        return { style: 'bg-green-50 text-green-700 border-green-200', icon: CheckCircle2 };
    }
    if (o.includes('callback')) {
        return { style: 'bg-blue-50 text-blue-700 border-blue-200', icon: Clock };
    }
    if (o.includes('voicemail')) {
        return { style: 'bg-yellow-50 text-yellow-700 border-yellow-200', icon: MessageSquare };
    }
    if (o.includes('no answer')) {
        return { style: 'bg-red-50 text-red-700 border-red-200', icon: XCircle };
    }
    if (o.includes('not interested')) {
        return { style: 'bg-gray-100 text-gray-600 border-gray-200', icon: ThumbsDown };
    }
    if (o.includes('not qualified') || o.includes('wrong')) {
        return { style: 'bg-orange-50 text-orange-700 border-orange-200', icon: Ban };
    }
    if (o.includes('hired') || o.includes('employed')) {
        return { style: 'bg-purple-50 text-purple-700 border-purple-200', icon: Briefcase };
    }
    return { style: 'bg-gray-50 text-gray-500 border-gray-100', icon: PhoneOutgoing };
};

export function DashboardBody({ 
    data, 
    selectedId, 
    onSelect, 
    onPhoneClick, 
    totalCount, 
    loading, 
    visibleColumns = ['name', 'status', 'lastCall', 'qualifications', 'assignee', 'date'],
    // Props for Selection
    selectedRowIds = [],
    onToggleRow,
    showCheckboxes = false
}) {

    if (loading) {
        return (
            <tbody className="divide-y divide-gray-100 bg-white">
                {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="animate-pulse">
                        {showCheckboxes && (
                            <td className="px-6 py-4 w-12">
                                <div className="w-4 h-4 bg-gray-200 rounded"></div>
                            </td>
                        )}
                        {visibleColumns.includes('name') && (
                            <td className="px-6 py-4">
                                <div className="flex gap-3">
                                    <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                                    <div className="space-y-2">
                                        <div className="h-4 bg-gray-200 rounded w-32"></div>
                                        <div className="h-3 bg-gray-200 rounded w-24"></div>
                                    </div>
                                </div>
                            </td>
                        )}
                        {visibleColumns.map((col, idx) => {
                            if (col === 'name') return null; // handled above
                            return (
                                <td key={idx} className="px-6 py-4">
                                    <div className="h-4 bg-gray-200 rounded w-full"></div>
                                </td>
                            );
                        })}
                    </tr>
                ))}
            </tbody>
        );
    }

    if (totalCount === 0) {
        return (
            <tbody className="divide-y divide-gray-100 bg-white">
              <tr>
                  <td colSpan={visibleColumns.length + (showCheckboxes ? 1 : 0)} className="p-12 text-center text-gray-400">
                      <div className="flex flex-col items-center gap-2">
                          <Zap size={32} className="opacity-20"/>
                          <p>No records found.</p>
                      </div>
                  </td>
              </tr>
            </tbody>
        );
    }

    return (
        <tbody className="divide-y divide-gray-100 bg-white">
          {data.map(item => {
            const name = `${getFieldValue(item['firstName'])} ${getFieldValue(item['lastName'])}`;
            const isSelected = selectedId === item.id;
            const isChecked = selectedRowIds.includes(item.id);

            let types = 'Unspecified';
            if (Array.isArray(item.driverType) && item.driverType.length > 0) {
                types = item.driverType.join(', ');
            } else if (typeof item.driverType === 'string' && item.driverType) {
                types = item.driverType;
            }
            const position = item.positionApplyingTo || 'Driver';

            const dateVal = item.isPlatformLead ? item.distributedAt : (item.submittedAt || item.createdAt);
            const displayDate = dateVal ? new Date(dateVal.seconds * 1000).toLocaleDateString() : '--';

            const isSafeHaul = item.isPlatformLead === true;

            const callConfig = getOutcomeConfig(item.lastCallOutcome);
            const OutcomeIcon = callConfig.icon;

            return (
              <tr 
                key={item.id} 
                onClick={() => onSelect(item)} 
                className={`cursor-pointer transition-colors group border-l-4 ${
                    isSelected 
                    ? 'bg-blue-50/60 border-l-blue-600' 
                    : isChecked 
                        ? 'bg-blue-50/30 border-l-transparent'
                        : 'hover:bg-gray-50 border-l-transparent'
                }`}
              >
                {/* CHECKBOX COLUMN */}
                {showCheckboxes && (
                    <td 
                        className="px-6 py-4 w-12 align-middle"
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleRow(item.id);
                        }}
                    >
                        {isChecked ? 
                            <CheckSquare size={20} className="text-blue-600" /> : 
                            <Square size={20} className="text-gray-300 hover:text-gray-500" />
                        }
                    </td>
                )}

                {/* NAME & CONTACT */}
                {visibleColumns.includes('name') && (
                    <td className="px-6 py-4 align-middle overflow-hidden text-left">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border shrink-0 transition-colors ${
                                isSelected 
                                ? 'bg-blue-600 text-white border-blue-600' 
                                : 'bg-gray-100 text-gray-600 border-gray-200 group-hover:bg-white'
                            }`}>
                                {name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <p className="text-sm font-bold text-gray-900 group-hover:text-blue-700 transition-colors truncate">{name}</p>
                                    {isSafeHaul && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700 uppercase"><Zap size={10} className="mr-0.5 fill-purple-700" /> Lead</span>}
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                    <button 
                                        onClick={(e) => onPhoneClick(e, item)} 
                                        className={`text-xs rounded px-2 py-1 flex items-center gap-1 transition-all border ${
                                            isSafeHaul 
                                            ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100' 
                                            : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-green-50 hover:text-green-700 hover:border-green-200'
                                        }`}
                                        title="Call Driver"
                                    >
                                         {isSafeHaul ? <Lock size={10} /> : <Phone size={12} />} 
                                         {isSafeHaul ? 'Click to contact' : formatPhoneNumber(getFieldValue(item.phone))}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </td>
                )}

                {/* STATUS */}
                {visibleColumns.includes('status') && (
                    <td className="px-6 py-4 align-middle text-center">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide border ${getStatusBadgeStyles(item.status)}`}>
                            {item.status || 'New'}
                        </span>
                    </td>
                )}

                {/* LAST CALL */}
                {visibleColumns.includes('lastCall') && (
                    <td className="px-6 py-4 align-middle text-center">
                        {item.lastCallOutcome ? (
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${callConfig.style}`}>
                                <OutcomeIcon size={12} strokeWidth={2.5} />
                                {item.lastCallOutcome}
                            </span>
                        ) : (
                            <span className="text-xs text-gray-400 italic flex items-center justify-center gap-1 opacity-60">
                                <PhoneOutgoing size={14} /> No Calls
                            </span>
                        )}
                    </td>
                )}

                {/* QUALIFICATIONS */}
                {visibleColumns.includes('qualifications') && (
                    <td className="px-6 py-4 align-middle overflow-hidden text-left">
                        <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1 text-xs font-bold text-gray-700">
                                <Briefcase size={12} className="text-gray-400"/> {position}
                            </div>
                            <p className="text-[10px] text-gray-500 max-w-[150px] truncate" title={types}>
                                {types}
                            </p>
                            <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                                {item.experience || item['experience-years'] ? (
                                    <span className="bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">
                                        {item.experience || item['experience-years']} Exp
                                    </span>
                                ) : null}
                                {item.state && (
                                    <span className="flex items-center gap-0.5">
                                        <MapPin size={10}/> {item.state}
                                    </span>
                                )}
                            </div>
                        </div>
                    </td>
                )}

                {/* ASSIGNEE */}
                {visibleColumns.includes('assignee') && (
                    <td className="px-6 py-4 align-middle text-left">
                        {item.assignedToName ? (
                            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-700 bg-white px-2 py-1 rounded-full border border-gray-200 w-fit shadow-sm">
                                <div className="w-4 h-4 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-[8px] font-bold">
                                    {item.assignedToName.charAt(0)}
                                </div>
                                {item.assignedToName}
                            </span>
                        ) : (
                            <span className="text-xs text-gray-400 italic flex items-center gap-1">
                                <User size={12}/> Unassigned
                            </span>
                        )}
                    </td>
                )}

                {/* DATE */}
                {visibleColumns.includes('date') && (
                    <td className="px-6 py-4 align-middle text-right">
                        <span className="flex items-center justify-end gap-1 text-sm text-gray-600 font-mono">
                            <Calendar size={12} className="text-gray-400"/> {displayDate}
                        </span>
                    </td>
                )}
              </tr>
            );
          })}
        </tbody>
    );
}