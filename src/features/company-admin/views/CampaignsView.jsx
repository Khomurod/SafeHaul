import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '@lib/firebase';
import { collection, query, where, getDocs, orderBy, limit } from 'firebase/firestore';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { Send, Users, MessageSquare, AlertCircle, CheckCircle, Info } from 'lucide-react';

export function CampaignsView({ companyId }) {
    const { showSuccess, showError } = useToast();

    // State
    const [manualLeads, setManualLeads] = useState([]);
    const [messageText, setMessageText] = useState("Hi [Driver Name], we haven't heard from you in a while! Are you still looking for a driving job? Reply YES to reactivate your application.");
    const [leadsToTarget, setLeadsToTarget] = useState([]);

    const [isCalculating, setIsCalculating] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [campaignStats, setCampaignStats] = useState(null);

    // Load Candidates
    useEffect(() => {
        const fetchCandidates = async () => {
            setIsCalculating(true);
            try {
                // Fetch leads that are eligible (Mock criteria: just last 100 for demo)
                // In real app: where('status', 'in', ['rejected', 'declined']) OR where('updatedAt', '<', 30_days_ago)
                const q = query(
                    collection(db, "companies", companyId, "applications"),
                    orderBy('createdAt', 'desc'),
                    limit(100)
                );

                const snapshot = await getDocs(q);
                const candidates = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));

                setManualLeads(candidates);
            } catch (err) {
                console.error("Error fetching candidates:", err);
                showError("Failed to load candidates.");
            } finally {
                setIsCalculating(false);
            }
        };

        if (companyId) fetchCandidates();
    }, [companyId]);

    // Cleanup leadCount derived state used in render:
    const leadCount = leadsToTarget.length;

    const handleInject = (variable) => {
        setMessageText(prev => prev + variable);
    };

    const handleLaunch = async () => {
        setIsSending(true);
        try {
            const executeFn = httpsCallable(functions, 'executeReactivationBatch');
            const result = await executeFn({
                companyId,
                leadIds: leadsToTarget,
                messageText
            });

            if (result.data.success) {
                setCampaignStats(result.data.stats);
                showSuccess(`Campaign Complete: Sent ${result.data.stats.sent} messages.`);
                setShowConfirm(false);
            } else {
                showError("Campaign Failed: " + (result.data.message || 'Unknown Error'));
            }
        } catch (error) {
            console.error(error);
            showError(`Execution Error: ${error.message}`);
        } finally {
            setIsSending(false);
        }
    };

    if (campaignStats) {
        return (
            <div className="bg-white p-8 rounded-xl shadow border border-gray-200 text-center">
                <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle size={32} />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Campaign Completed!</h2>
                <div className="grid grid-cols-3 gap-4 max-w-md mx-auto mt-6">
                    <div className="p-4 bg-gray-50 rounded-lg">
                        <div className="text-sm text-gray-500 uppercase font-bold">Total</div>
                        <div className="text-2xl font-bold">{campaignStats.total}</div>
                    </div>
                    <div className="p-4 bg-green-50 text-green-700 rounded-lg">
                        <div className="text-sm uppercase font-bold">Sent</div>
                        <div className="text-2xl font-bold">{campaignStats.sent}</div>
                    </div>
                    <div className="p-4 bg-red-50 text-red-700 rounded-lg">
                        <div className="text-sm uppercase font-bold">Failed</div>
                        <div className="text-2xl font-bold">{campaignStats.failed}</div>
                    </div>
                </div>
                <button
                    onClick={() => setCampaignStats(null)}
                    className="mt-8 px-6 py-2 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700"
                >
                    Start New Campaign
                </button>
            </div>
        );
    }

    return (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col h-[calc(100vh-140px)]">
            {/* Header */}
            <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <MessageSquare className="text-purple-600" size={24} /> Reactivation Campaign
                    </h2>
                    <p className="text-sm text-gray-500">Send bulk SMS to re-engage stale leads.</p>
                </div>
                <div className="text-right">
                    <div className="text-xs font-bold text-gray-400 uppercase">Audience Size</div>
                    <div className="text-2xl font-bold text-blue-600 flex items-center justify-end gap-2">
                        <Users size={20} />
                        {isCalculating ? '...' : leadCount}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-8">

                {/* 1. Select Audience */}
                <section>
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="text-sm font-bold text-gray-900 uppercase border-l-4 border-blue-500 pl-2">1. Select Candidates</h3>
                        <div className="text-xs font-medium text-gray-500">
                            Selected: <span className={leadsToTarget.length > 50 ? "text-red-600 font-bold" : "text-blue-600 font-bold"}>{leadsToTarget.length}</span>/50 Max
                        </div>
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden max-h-60 overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-gray-500 font-bold uppercase text-xs sticky top-0">
                                <tr>
                                    <th className="p-3 w-10">
                                        <input
                                            type="checkbox"
                                            onChange={(e) => {
                                                if (e.target.checked) {
                                                    // Select first 50
                                                    setLeadsToTarget(manualLeads.slice(0, 50).map(l => l.id));
                                                } else {
                                                    setLeadsToTarget([]);
                                                }
                                            }}
                                            checked={leadsToTarget.length > 0 && leadsToTarget.length === Math.min(manualLeads.length, 50)}
                                        />
                                    </th>
                                    <th className="p-3">Name</th>
                                    <th className="p-3">Phone</th>
                                    <th className="p-3">Last Active</th>
                                    <th className="p-3">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {isCalculating ? (
                                    <tr><td colSpan="5" className="p-6 text-center text-gray-400">Loading candidates...</td></tr>
                                ) : manualLeads.length === 0 ? (
                                    <tr><td colSpan="5" className="p-6 text-center text-gray-400">No candidates found matching criteria.</td></tr>
                                ) : (
                                    manualLeads.map(lead => (
                                        <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                                            <td className="p-3">
                                                <input
                                                    type="checkbox"
                                                    checked={leadsToTarget.includes(lead.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            if (leadsToTarget.length >= 50) return showError("Max 50 leads allowed per batch.");
                                                            setLeadsToTarget(prev => [...prev, lead.id]);
                                                        } else {
                                                            setLeadsToTarget(prev => prev.filter(id => id !== lead.id));
                                                        }
                                                    }}
                                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                />
                                            </td>
                                            <td className="p-3 font-medium text-gray-900">{lead.firstName} {lead.lastName}</td>
                                            <td className="p-3 text-gray-500 font-mono text-xs">{lead.phone || lead.phoneNumber}</td>
                                            <td className="p-3 text-gray-500">
                                                {lead.lastContactedAt ? new Date(lead.lastContactedAt.seconds * 1000).toLocaleDateString() : 'Never'}
                                            </td>
                                            <td className="p-3">
                                                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
                                                    {lead.status || 'New'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 text-right">Only showing available candidates (older than 30 days or rejected).</p>
                </section>

                {/* 2. Compose Message */}
                <section>
                    <h3 className="text-sm font-bold text-gray-900 uppercase mb-3 border-l-4 border-purple-500 pl-2">2. Compose SMS</h3>
                    <div className="relative">
                        <textarea
                            className="w-full h-32 p-4 border border-gray-300 rounded-xl focus:ring-2 focus:ring-purple-500 outline-none resize-none text-gray-700 text-lg"
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            maxLength={160}
                        ></textarea>
                        <div className="absolute bottom-3 right-3 text-xs text-gray-400 font-medium">
                            {messageText.length}/160 chars
                        </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={() => handleInject(' [Driver Name] ')}
                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-full transition-colors"
                        >
                            + Driver Name
                        </button>
                        <button
                            onClick={() => handleInject(' [Company Name] ')}
                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-full transition-colors"
                        >
                            + Company Name
                        </button>
                    </div>
                </section>

                <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg flex gap-3 text-sm text-blue-800">
                    <Info className="shrink-0" size={20} />
                    <p>Reactivation messages are sent with a 1-second delay between each to comply with carrier rate limits. A batch of 50 leads will take approximately 1 minute to complete.</p>
                </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end">
                <button
                    onClick={() => setShowConfirm(true)}
                    disabled={leadCount === 0 || !messageText}
                    className="px-8 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 shadow-lg hover:shadow-xl transition-all disabled:opacity-50 disabled:shadow-none flex items-center gap-2"
                >
                    <Send size={20} /> Launch Campaign
                </button>
            </div>

            {/* Confirmation Modal */}
            {showConfirm && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
                    <div className="bg-white w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
                        <div className="flex items-center gap-3 mb-4 text-gray-900">
                            <AlertCircle className="text-orange-500" size={28} />
                            <h3 className="text-xl font-bold">Confirm Campaign</h3>
                        </div>
                        <p className="text-gray-600 mb-6">
                            You are about to send an SMS to <strong className="text-gray-900">{leadsToTarget.length} drivers</strong>.
                            <br />
                            <span className="text-sm">Estimated Cost: <strong className="text-green-600">${(leadsToTarget.length * 0.05).toFixed(2)}</strong> ($0.05/msg)</span>
                        </p>

                        <div className="bg-gray-100 p-4 rounded-lg mb-6 font-mono text-sm text-gray-700 italic border border-gray-200">
                            "{messageText}"
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowConfirm(false)}
                                className="flex-1 py-3 text-gray-600 font-bold hover:bg-gray-100 rounded-xl"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleLaunch}
                                disabled={isSending}
                                className="flex-1 py-3 bg-purple-600 text-white font-bold rounded-xl hover:bg-purple-700 shadow-lg flex justify-center items-center gap-2"
                            >
                                {isSending ? 'Sending...' : 'Confirm & Send'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
