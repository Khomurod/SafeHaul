import React, { useState, useEffect } from 'react';
import { respondToOffer } from '../../services/driverService';
import { initializeSignatureCanvas, clearCanvas, isCanvasEmpty, getSignatureDataUrl } from '@lib/signature';
import { X, CheckCircle, XCircle, DollarSign, Calendar, Gift, FileSignature, Loader2, PenTool } from 'lucide-react';
import confetti from 'canvas-confetti';

export function DriverOfferModal({ application, onClose, onUpdate }) {
    const [loading, setLoading] = useState(false);
    const [signing, setSigning] = useState(false);

    // FIX: Use originalId (the real Firestore ID) for updates
    const { offerDetails, companyName, companyId, id, originalId } = application;
    const appId = originalId || id;

    useEffect(() => {
        if (signing) {
            setTimeout(initializeSignatureCanvas, 100);
        }
    }, [signing]);

    if (!offerDetails) return null;

    const handleDecline = async () => {
        if (!window.confirm("Are you sure you want to DECLINE this offer?")) return;
        setLoading(true);
        try {
            await respondToOffer(companyId, appId, 'Offer Declined');
            onUpdate();
            setTimeout(onClose, 500);
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleAccept = async () => {
        if (isCanvasEmpty()) {
            alert("Please sign the offer to accept.");
            return;
        }

        if (!window.confirm("Are you sure you want to ACCEPT this offer with your signature?")) return;

        setLoading(true);
        try {
            const sigData = getSignatureDataUrl();
            // 1. Update DB using the correct ID and Signature
            await respondToOffer(companyId, appId, 'Offer Accepted', sigData);

            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });

            onUpdate(); // Refresh parent dashboard
            setTimeout(onClose, 1000);
        } catch (error) {
            console.error("Error responding:", error);
            alert("Failed to update status.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">

                {/* Header */}
                <div className="bg-blue-600 p-6 text-white text-center relative">
                    <button onClick={onClose} className="absolute top-4 right-4 p-1 hover:bg-white/20 rounded-full transition"><X size={20} /></button>
                    <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3 backdrop-blur-md">
                        <FileSignature size={32} className="text-white" />
                    </div>
                    <h2 className="text-2xl font-bold">{signing ? "Sign & Accept" : "Job Offer Received!"}</h2>
                    <p className="text-blue-100 text-sm mt-1">{companyName} wants to hire you.</p>
                </div>

                {/* Content Switcher */}
                {!signing ? (
                    <>
                        <div className="p-6 space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-green-50 border border-green-100 rounded-xl text-center">
                                    <p className="text-xs font-bold text-green-600 uppercase mb-1">Pay Rate</p>
                                    <div className="flex items-center justify-center gap-1 text-gray-900 font-bold text-xl">
                                        <DollarSign size={20} className="text-green-600" />
                                        {offerDetails.payRate} <span className="text-xs font-normal text-gray-500 self-end mb-1">{offerDetails.payType}</span>
                                    </div>
                                </div>

                                <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl text-center">
                                    <p className="text-xs font-bold text-blue-600 uppercase mb-1">Start Date</p>
                                    <div className="flex items-center justify-center gap-2 text-gray-900 font-bold text-lg mt-1">
                                        <Calendar size={18} className="text-blue-600" />
                                        {offerDetails.startDate}
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h4 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Gift size={16} className="text-purple-500" /> Benefits & Perks
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                    {offerDetails.benefits && offerDetails.benefits.length > 0 ? (
                                        offerDetails.benefits.map((ben, i) => (
                                            <span key={i} className="px-3 py-1 bg-gray-100 text-gray-700 text-xs font-medium rounded-full border border-gray-200">
                                                {ben}
                                            </span>
                                        ))
                                    ) : (
                                        <p className="text-sm text-gray-500 italic">No specific benefits listed.</p>
                                    )}
                                </div>
                            </div>

                            <div className="text-center text-xs text-gray-400 pt-2">
                                Offer generated on {new Date(offerDetails.sentAt).toLocaleDateString()}
                            </div>
                        </div>

                        {/* Actions */}
                        <div className="p-6 bg-gray-50 border-t border-gray-200 grid grid-cols-2 gap-4">
                            <button
                                onClick={handleDecline}
                                disabled={loading}
                                className="py-3 px-4 bg-white border-2 border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-100 hover:text-gray-800 hover:border-gray-300 transition flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="animate-spin" /> : <XCircle size={20} />}
                                Decline
                            </button>
                            <button
                                onClick={() => setSigning(true)}
                                disabled={loading}
                                className="py-3 px-4 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2"
                            >
                                <PenTool size={20} />
                                Sign & Accept
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col">
                        <div className="p-6 flex-1 flex flex-col items-center">
                            <p className="text-sm text-gray-600 mb-4 text-center">
                                Please sign below to officially accept this offer.
                            </p>

                            <div className="w-full relative border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 overflow-hidden touch-none">
                                <canvas
                                    id="signature-canvas"
                                    className="w-full h-48 cursor-crosshair touch-none"
                                ></canvas>

                                <button
                                    onClick={clearCanvas}
                                    className="absolute bottom-2 right-2 text-xs bg-white border border-gray-200 px-2 py-1 rounded text-red-500 hover:bg-red-50 transition"
                                >
                                    Clear
                                </button>
                            </div>

                            <p className="text-xs text-gray-400 mt-4 text-center px-4">
                                By clicking "Complete Acceptance", I agree that this signature is legally binding and equivalent to my handwritten signature.
                            </p>
                        </div>

                        <div className="p-6 bg-gray-50 border-t border-gray-200 flex gap-3">
                            <button
                                onClick={() => setSigning(false)}
                                className="flex-1 py-3 px-4 bg-white border border-gray-300 text-gray-700 font-bold rounded-xl hover:bg-gray-50 transition"
                            >
                                Back
                            </button>
                            <button
                                onClick={handleAccept}
                                disabled={loading}
                                className="flex-[2] py-3 px-4 bg-green-600 text-white font-bold rounded-xl hover:bg-green-700 shadow-lg transition flex items-center justify-center gap-2"
                            >
                                {loading ? <Loader2 className="animate-spin" /> : <CheckCircle size={20} />}
                                Complete Acceptance
                            </button>
                        </div>
                    </div>
                )}

            </div>
        </div>
    );
}