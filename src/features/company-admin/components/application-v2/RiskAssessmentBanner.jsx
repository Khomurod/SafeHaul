import React, { useMemo } from 'react';
import { AlertTriangle, ShieldAlert, CheckCircle2, XCircle, AlertCircle, Skull, Pill, Car, FileWarning } from 'lucide-react';

/**
 * RiskAssessmentBanner - Color-coded risk flags at a glance
 * 
 * Shows critical (red), warning (yellow), and clean (green) indicators
 * based on application safety-sensitive data
 */
export function RiskAssessmentBanner({ appData }) {

    const riskAssessment = useMemo(() => {
        if (!appData) return { critical: [], warnings: [], clean: [] };

        const critical = [];
        const warnings = [];
        const clean = [];

        // --- CRITICAL FLAGS (Red) ---
        if (appData['has-felony'] === 'yes') {
            critical.push({
                label: 'Felony Reported',
                detail: appData.felonyExplanation || 'No details provided',
                icon: Skull
            });
        }

        if (appData['drug-test-positive'] === 'yes') {
            critical.push({
                label: 'Drug/Alcohol Positive',
                detail: appData['drug-test-explanation'] || 'Positive test or refusal on record',
                icon: Pill
            });
        }

        if (appData['revoked-licenses'] === 'yes') {
            critical.push({
                label: 'License Revoked/Suspended',
                detail: 'History of license revocation',
                icon: FileWarning
            });
        }

        // --- WARNING FLAGS (Yellow) ---
        const accidentCount = appData.accidents?.length || 0;
        const preventableCount = appData.accidents?.filter(a => a.preventable === 'yes').length || 0;
        if (accidentCount > 0) {
            warnings.push({
                label: `${accidentCount} Accident${accidentCount > 1 ? 's' : ''}`,
                detail: preventableCount > 0 ? `${preventableCount} marked preventable` : 'Review details',
                icon: Car
            });
        }

        const violationCount = appData.violations?.length || 0;
        if (violationCount > 0) {
            warnings.push({
                label: `${violationCount} Violation${violationCount > 1 ? 's' : ''}`,
                detail: 'Review driving record',
                icon: AlertCircle
            });
        }

        const gapCount = appData.unemployment?.length || 0;
        if (gapCount > 0) {
            warnings.push({
                label: 'Employment Gaps',
                detail: `${gapCount} gap${gapCount > 1 ? 's' : ''} reported`,
                icon: AlertTriangle
            });
        }

        if (appData['driving-convictions'] === 'yes') {
            warnings.push({
                label: 'Driving While Suspended',
                detail: 'Convicted of driving while suspended',
                icon: XCircle
            });
        }

        // --- CLEAN FLAGS (Green) ---
        if (appData['has-felony'] !== 'yes') {
            clean.push({ label: 'No Felony', icon: CheckCircle2 });
        }
        if (appData['drug-test-positive'] !== 'yes') {
            clean.push({ label: 'Clean Drug History', icon: CheckCircle2 });
        }
        if (accidentCount === 0) {
            clean.push({ label: 'No Accidents', icon: CheckCircle2 });
        }
        if (violationCount === 0) {
            clean.push({ label: 'Clean Violations', icon: CheckCircle2 });
        }

        return { critical, warnings, clean };
    }, [appData]);

    const hasCritical = riskAssessment.critical.length > 0;
    const hasWarnings = riskAssessment.warnings.length > 0;
    const isClean = !hasCritical && !hasWarnings;

    // Don't render if completely clean - just show a simple badge
    if (isClean && riskAssessment.clean.length === 0) return null;

    return (
        <div className={`rounded-xl p-4 ${hasCritical
                ? 'bg-gradient-to-r from-red-50 to-orange-50 border border-red-200'
                : hasWarnings
                    ? 'bg-gradient-to-r from-yellow-50 to-amber-50 border border-yellow-200'
                    : 'bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200'
            }`}>

            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
                {hasCritical ? (
                    <>
                        <ShieldAlert size={18} className="text-red-600" />
                        <span className="text-sm font-bold text-red-700 uppercase tracking-wide">Risk Assessment</span>
                    </>
                ) : hasWarnings ? (
                    <>
                        <AlertTriangle size={18} className="text-yellow-600" />
                        <span className="text-sm font-bold text-yellow-700 uppercase tracking-wide">Review Recommended</span>
                    </>
                ) : (
                    <>
                        <CheckCircle2 size={18} className="text-green-600" />
                        <span className="text-sm font-bold text-green-700 uppercase tracking-wide">Clean Record</span>
                    </>
                )}
            </div>

            {/* Flags Grid */}
            <div className="flex flex-wrap gap-2">
                {/* Critical Flags */}
                {riskAssessment.critical.map((flag, i) => (
                    <div
                        key={`critical-${i}`}
                        className="group relative flex items-center gap-2 px-3 py-2 bg-red-100 border border-red-300 rounded-lg cursor-help"
                        title={flag.detail}
                    >
                        <flag.icon size={16} className="text-red-600 shrink-0" />
                        <span className="text-sm font-semibold text-red-800">{flag.label}</span>

                        {/* Tooltip */}
                        <div className="absolute bottom-full left-0 mb-2 w-64 p-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                            {flag.detail}
                            <div className="absolute top-full left-4 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900" />
                        </div>
                    </div>
                ))}

                {/* Warning Flags */}
                {riskAssessment.warnings.map((flag, i) => (
                    <div
                        key={`warning-${i}`}
                        className="group relative flex items-center gap-2 px-3 py-2 bg-yellow-100 border border-yellow-300 rounded-lg cursor-help"
                        title={flag.detail}
                    >
                        <flag.icon size={16} className="text-yellow-700 shrink-0" />
                        <span className="text-sm font-semibold text-yellow-800">{flag.label}</span>

                        {/* Tooltip */}
                        <div className="absolute bottom-full left-0 mb-2 w-48 p-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50 shadow-lg">
                            {flag.detail}
                            <div className="absolute top-full left-4 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-gray-900" />
                        </div>
                    </div>
                ))}

                {/* Clean Flags (only show if no critical/warnings) */}
                {isClean && riskAssessment.clean.slice(0, 4).map((flag, i) => (
                    <div
                        key={`clean-${i}`}
                        className="flex items-center gap-2 px-3 py-2 bg-green-100 border border-green-300 rounded-lg"
                    >
                        <flag.icon size={16} className="text-green-600 shrink-0" />
                        <span className="text-sm font-medium text-green-800">{flag.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default RiskAssessmentBanner;
