import React, { useState } from 'react';
import { Rocket, Loader2, AlertTriangle, CheckCircle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@lib/firebase';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function LaunchPad({ companyId, campaign, onLaunchSuccess }) {
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();
    const [isLaunching, setIsLaunching] = useState(false);
    const handleLaunch = async () => {
        if (!companyId) return showError("Company ID missing");

        setIsLaunching(true);
        try {
            const initBulkSession = httpsCallable(functions, 'initBulkSession');

            const payload = {
                companyId,
                name: campaign.name,
                filters: campaign.filters,
                messageConfig: campaign.messageConfig,
                scheduledFor: null // User requested removal of scheduling ("action and shot")
            };

            const result = await initBulkSession(payload);

            if (result.data.success) {
                showSuccess(`Campaign launched! Targeting ${result.data.targetCount} drivers. Session: ${result.data.sessionId?.slice(0, 8)}...`);
                if (onLaunchSuccess) onLaunchSuccess();
            } else {
                showError(result.data.message || "Launch failed");
            }
        } catch (err) {
            console.error("Launch Error:", err);
            // Extract user-friendly message from Firebase error
            const friendlyMsg = err.message?.includes('bulk-actions-queue')
                ? "Campaign infrastructure not ready. Please contact support."
                : (err.message || "Failed to launch campaign");
            showError(friendlyMsg);
        } finally {
            setIsLaunching(false);
        }
    };


    // Validation
    const errors = [];
    if (!campaign.matchCount || campaign.matchCount === 0) errors.push("No audience selected");
    if (!campaign.messageConfig?.message) errors.push("Message content is empty");

    const isValid = errors.length === 0;

    return (
        <div className="max-w-2xl mx-auto text-center pt-12">
            <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl">
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Rocket size={40} className="text-blue-600" />
                </div>

                <h2 className="text-3xl font-black text-slate-900 mb-2">Ready for Liftoff?</h2>
                <p className="text-slate-500 mb-8 max-w-md mx-auto">
                    You are about to message <strong>{campaign.matchCount || 0}</strong> recipients via <strong>{campaign.messageConfig?.method === 'email' ? 'Email' : 'SMS'}</strong>.
                </p>

                {errors.length > 0 ? (
                    <div className="bg-red-50 p-6 rounded-2xl mb-8 text-left">
                        <h3 className="flex items-center gap-2 font-bold text-red-700 mb-3">
                            <AlertTriangle size={18} /> Pre-Flight Checks Failed
                        </h3>
                        <ul className="space-y-2">
                            {errors.map((err, i) => (
                                <li key={i} className="text-sm text-red-600 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-red-400"></div> {err}
                                </li>
                            ))}
                        </ul>
                    </div>
                ) : (
                    <div className="bg-emerald-50 p-6 rounded-2xl mb-8 flex items-center justify-center gap-2 text-emerald-800 font-bold">
                        <CheckCircle size={20} /> All Systems Go
                    </div>
                )}

                <div className="flex gap-4">
                    <button
                        disabled={!isValid || isLaunching}
                        onClick={handleLaunch}
                        className="flex-1 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-xl font-black text-lg shadow-lg shadow-blue-200 flex items-center justify-center gap-3 transition-all"
                    >
                        {isLaunching ? <Loader2 size={24} className="animate-spin" /> : <Rocket size={24} />}
                        Launch Immediately
                    </button>
                </div>
            </div>
        </div>
    );
}
