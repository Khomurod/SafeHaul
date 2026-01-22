import React from 'react';
import { CreditCard, Shield, FileCheck, Clock, Award, Truck, Globe } from 'lucide-react';

/**
 * QuickFactsBar - Horizontal bar showing CDL, DQ status, and key info at a glance
 */
export function QuickFactsBar({ appData, dqStatus }) {
    if (!appData) return null;

    // CDL Info formatted - avoid double "Class" prefix
    const cdlClassValue = appData.cdlClass || '';
    const cdlDisplay = [
        cdlClassValue && (cdlClassValue.toLowerCase().startsWith('class') ? cdlClassValue : `Class ${cdlClassValue}`),
        appData.cdlState,
        appData.cdlExpiration && `Exp ${appData.cdlExpiration}`
    ].filter(Boolean).join(' • ') || 'Not provided';

    // Endorsements
    const endorsements = appData.endorsements || 'None';

    // TWIC Status
    const hasTwic = appData['has-twic'] === 'yes';
    const twicExp = appData.twicExpiration;

    // Clearinghouse consent - check multiple possible field names and values
    const hasClearinghouse =
        appData['agree-clearinghouse'] === 'agreed' ||
        appData['agree-clearinghouse'] === 'yes' ||
        appData['clearinghouse-consent'] === 'agreed' ||
        appData['clearinghouse-consent'] === 'yes' ||
        appData.clearinghouseConsent === true;

    // DQ File progress (passed as prop or default)
    const dqProgress = dqStatus || { complete: 0, total: 7 };

    // Source
    const getSourceLabel = () => {
        if (appData.referralSource) return appData.referralSource;
        if (appData.isPlatformLead || appData.sourceType === 'Added by Safehaul') {
            return 'SafeHaul Network';
        }
        return appData.source || appData.sourceType || 'Direct';
    };

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">

                {/* CDL */}
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <CreditCard size={18} className="text-blue-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">CDL</p>
                        <p className="text-sm font-semibold text-gray-900 truncate">{cdlDisplay}</p>
                    </div>
                </div>

                {/* Endorsements */}
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                        <Award size={18} className="text-purple-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Endorsements</p>
                        <p className="text-sm font-semibold text-gray-900 truncate">{endorsements}</p>
                    </div>
                </div>

                {/* TWIC */}
                <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${hasTwic ? 'bg-green-100' : 'bg-gray-100'}`}>
                        <Shield size={18} className={hasTwic ? 'text-green-600' : 'text-gray-400'} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">TWIC</p>
                        <p className={`text-sm font-semibold truncate ${hasTwic ? 'text-green-700' : 'text-gray-500'}`}>
                            {hasTwic ? (twicExp ? `Exp ${twicExp}` : 'Active') : 'Not Held'}
                        </p>
                    </div>
                </div>

                {/* Clearinghouse */}
                <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${hasClearinghouse ? 'bg-green-100' : 'bg-yellow-100'}`}>
                        <FileCheck size={18} className={hasClearinghouse ? 'text-green-600' : 'text-yellow-600'} />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Clearinghouse</p>
                        <p className={`text-sm font-semibold truncate ${hasClearinghouse ? 'text-green-700' : 'text-yellow-700'}`}>
                            {hasClearinghouse ? 'Consented' : 'Pending'}
                        </p>
                    </div>
                </div>

                {/* DQ File Status */}
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
                        <Clock size={18} className="text-indigo-600" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">DQ File</p>
                        <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold text-gray-900">{dqProgress.complete}/{dqProgress.total}</p>
                            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden max-w-[60px]">
                                <div
                                    className="h-full bg-indigo-500 rounded-full transition-all"
                                    style={{ width: `${(dqProgress.complete / dqProgress.total) * 100}%` }}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Source */}
                <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                        <Globe size={18} className="text-gray-500" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Source</p>
                        <p className="text-sm font-semibold text-gray-900 truncate">{getSourceLabel()}</p>
                    </div>
                </div>

            </div>
        </div>
    );
}

export default QuickFactsBar;
