import React from 'react';
import { ArrowRight, Phone, FileText, UserCheck, Clock, Send, CheckCircle, FileSignature } from 'lucide-react';

/**
 * StatusWorkflowGuide - Context-aware next steps based on current status
 */
export function StatusWorkflowGuide({ currentStatus, onAction }) {

    const workflowConfig = {
        'New Application': {
            color: 'indigo',
            icon: FileText,
            title: 'New Application Received',
            steps: [
                { label: 'Review risk flags', action: 'scroll-to-risks' },
                { label: 'Check DQ documents', action: 'go-to-dq' },
                { label: 'Contact applicant', action: 'contact', primary: true }
            ]
        },
        'New Lead': {
            color: 'purple',
            icon: UserCheck,
            title: 'New Lead',
            steps: [
                { label: 'Call to qualify', action: 'call', primary: true },
                { label: 'Send application link', action: 'send-app' },
                { label: 'Add to pipeline', action: 'update-status' }
            ]
        },
        'Contacted': {
            color: 'cyan',
            icon: Phone,
            title: 'Contacted',
            steps: [
                { label: 'Schedule interview', action: 'schedule' },
                { label: 'Request missing docs', action: 'request-docs' },
                { label: 'Move to review', action: 'update-status', primary: true }
            ]
        },
        'Attempted': {
            color: 'orange',
            icon: Clock,
            title: 'Contact Attempted',
            steps: [
                { label: 'Try again', action: 'call', primary: true },
                { label: 'Send SMS/text', action: 'sms' },
                { label: 'Leave voicemail + email', action: 'email' }
            ]
        },
        'In Review': {
            color: 'blue',
            icon: FileText,
            title: 'Under Review',
            steps: [
                { label: 'Verify employment history', action: 'go-to-pev' },
                { label: 'Check driving record', action: 'scroll-to-driving' },
                { label: 'Proceed to background check', action: 'background', primary: true }
            ]
        },
        'Background Check': {
            color: 'purple',
            icon: UserCheck,
            title: 'Background Check In Progress',
            steps: [
                { label: 'Order MVR', action: 'order-mvr' },
                { label: 'Run PSP report', action: 'order-psp' },
                { label: 'Query Clearinghouse', action: 'clearinghouse', primary: true }
            ]
        },
        'Awaiting Documents': {
            color: 'yellow',
            icon: FileText,
            title: 'Waiting for Documents',
            steps: [
                { label: 'Check DQ file status', action: 'go-to-dq', primary: true },
                { label: 'Send reminder', action: 'send-reminder' },
                { label: 'Call to follow up', action: 'call' }
            ]
        },
        'Approved': {
            color: 'green',
            icon: CheckCircle,
            title: 'Approved - Ready for Hire',
            steps: [
                { label: 'Send offer letter', action: 'send-offer', primary: true },
                { label: 'Prepare onboarding', action: 'onboarding' },
                { label: 'Assign to orientation', action: 'orientation' }
            ]
        },
        'Offer Sent': {
            color: 'emerald',
            icon: Send,
            title: 'Offer Sent',
            steps: [
                { label: 'Follow up on offer', action: 'call', primary: true },
                { label: 'Prepare equipment', action: 'equipment' },
                { label: 'Schedule start date', action: 'schedule-start' }
            ]
        },
        'Rejected': {
            color: 'red',
            icon: FileSignature,
            title: 'Application Rejected',
            steps: [
                { label: 'Send adverse action letter', action: 'adverse-action' },
                { label: 'Document reason', action: 'add-note' },
                { label: 'Archive record', action: 'archive' }
            ]
        },
        'Disqualified': {
            color: 'red',
            icon: FileSignature,
            title: 'Disqualified',
            steps: [
                { label: 'Document disqualification reason', action: 'add-note' },
                { label: 'Send notification', action: 'notify' },
                { label: 'Archive record', action: 'archive' }
            ]
        }
    };

    const config = workflowConfig[currentStatus];

    if (!config) return null;

    const colorClasses = {
        indigo: { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', icon: 'text-indigo-500', btn: 'bg-indigo-600 hover:bg-indigo-700' },
        purple: { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700', icon: 'text-purple-500', btn: 'bg-purple-600 hover:bg-purple-700' },
        cyan: { bg: 'bg-cyan-50', border: 'border-cyan-200', text: 'text-cyan-700', icon: 'text-cyan-500', btn: 'bg-cyan-600 hover:bg-cyan-700' },
        orange: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', icon: 'text-orange-500', btn: 'bg-orange-600 hover:bg-orange-700' },
        blue: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', icon: 'text-blue-500', btn: 'bg-blue-600 hover:bg-blue-700' },
        yellow: { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: 'text-yellow-500', btn: 'bg-yellow-600 hover:bg-yellow-700' },
        green: { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-500', btn: 'bg-green-600 hover:bg-green-700' },
        emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'text-emerald-500', btn: 'bg-emerald-600 hover:bg-emerald-700' },
        red: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-500', btn: 'bg-red-600 hover:bg-red-700' }
    };

    const colors = colorClasses[config.color] || colorClasses.blue;
    const Icon = config.icon;

    return (
        <div className={`rounded-xl p-5 ${colors.bg} border-2 ${colors.border} shadow-sm animate-in fade-in slide-in-from-top-2 duration-300`}>
            {/* Header */}
            <div className="flex items-center gap-2 mb-4">
                <div className={`w-8 h-8 rounded-lg ${colors.bg} flex items-center justify-center border ${colors.border}`}>
                    <Icon size={18} className={colors.icon} />
                </div>
                <span className={`text-sm font-bold uppercase tracking-wide ${colors.text}`}>
                    Next Steps
                </span>
            </div>

            {/* Steps */}
            <div className="flex flex-wrap gap-2">
                {config.steps.map((step, i) => (
                    <button
                        key={i}
                        onClick={() => onAction && onAction(step.action)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${step.primary
                            ? `${colors.btn} text-white shadow-sm hover:shadow`
                            : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300'
                            }`}
                    >
                        {step.label}
                        {step.primary && <ArrowRight size={14} />}
                    </button>
                ))}
            </div>
        </div>
    );
}

export default StatusWorkflowGuide;
