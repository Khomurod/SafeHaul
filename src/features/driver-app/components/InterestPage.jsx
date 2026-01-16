import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@lib/firebase';
import { Loader2, CheckCircle, XCircle, Building2, UserCheck } from 'lucide-react';
import { useToast } from '@shared/components/feedback/ToastProvider';

export function InterestPage() {
    const { slug } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { showSuccess, showError } = useToast();

    // URL Params
    const leadId = searchParams.get('leadId');
    const recruiterCode = searchParams.get('r');

    // State
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [company, setCompany] = useState(null);
    const [driverName, setDriverName] = useState('');
    const [error, setError] = useState('');

    // 1. Load Data
    useEffect(() => {
        async function loadContext() {
            try {
                // A. Find Company
                let companyData = null;
                const q = query(collection(db, "companies"), where("appSlug", "==", slug));
                const compSnap = await getDocs(q);

                if (!compSnap.empty) {
                    companyData = { id: compSnap.docs[0].id, ...compSnap.docs[0].data() };
                } else {
                    // Fallback to ID
                    const docSnap = await getDoc(doc(db, "companies", slug));
                    if (docSnap.exists()) companyData = { id: docSnap.id, ...docSnap.data() };
                }

                if (!companyData) throw new Error("Company not found.");
                setCompany(companyData);

                // B. Find Driver Name (Optional UX enhancement)
                if (leadId) {
                    const leadSnap = await getDoc(doc(db, "leads", leadId));
                    if (leadSnap.exists()) {
                        setDriverName(leadSnap.data().firstName || 'Driver');
                    }
                }

            } catch (err) {
                console.error("Load error:", err);
                setError(err.message || "Invalid link.");
            } finally {
                setLoading(false);
            }
        }
        loadContext();
    }, [slug, leadId]);

    // 2. Handle "Yes, I'm Interested"
    const handleConfirmInterest = async () => {
        setProcessing(true);
        try {
            const confirmFn = httpsCallable(functions, 'confirmDriverInterest');

            await confirmFn({
                leadId: leadId,
                companyIdOrSlug: company.id,
                recruiterId: recruiterCode // Backend will map this to a user ID if needed
            });

            showSuccess("Interest confirmed! Redirecting to application...");

            // Redirect to Full Application after 1.5s
            setTimeout(() => {
                navigate(`/apply/${slug}?r=${recruiterCode}&prefill=${leadId}`);
            }, 1500);

        } catch (err) {
            console.error("Interest Error:", err);
            showError("Could not confirm interest. Please try again.");
            setProcessing(false);
        }
    };

    // 3. Handle "Not Interested"
    const handleDecline = () => {
        // Optional: Call backend to mark as 'Not Interested'
        alert("Thank you. We have noted your response.");
        // Redirect to safe page
        window.location.href = "https://google.com";
    };

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin text-blue-600" /></div>;

    if (error) return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="bg-white p-8 rounded-xl shadow text-center max-w-md">
                <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold text-gray-900">Link Expired or Invalid</h2>
                <p className="text-gray-500 mt-2">{error}</p>
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white flex flex-col items-center justify-center p-4">
            <div className="bg-white max-w-md w-full rounded-2xl shadow-xl overflow-hidden border border-gray-100">
                {/* Header */}
                <div className="bg-blue-600 p-6 text-center">
                    {company.logoUrl ? (
                        <img src={company.logoUrl} alt={company.companyName} className="h-12 mx-auto bg-white p-1 rounded" />
                    ) : (
                        <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto text-white">
                            <Building2 size={32} />
                        </div>
                    )}
                    <h1 className="text-white font-bold text-xl mt-4">Opportunity at {company.companyName}</h1>
                </div>

                {/* Content */}
                <div className="p-8 text-center">
                    <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-700 px-4 py-2 rounded-full text-sm font-medium mb-6">
                        <UserCheck size={16} />
                        {driverName ? `Hi, ${driverName}!` : 'Hello!'}
                    </div>

                    <h2 className="text-2xl font-bold text-gray-900 mb-3">Are you interested?</h2>
                    <p className="text-gray-600 mb-8">
                        Our recruiting team has identified you as a great match for our open lanes. 
                        Click below to confirm your interest and start your secure application.
                    </p>

                    <div className="space-y-3">
                        <button 
                            onClick={handleConfirmInterest}
                            disabled={processing}
                            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-lg shadow-lg shadow-blue-200 transition-all flex items-center justify-center gap-2"
                        >
                            {processing ? <Loader2 className="animate-spin" /> : <CheckCircle />}
                            Yes, I'm Interested
                        </button>

                        <button 
                            onClick={handleDecline}
                            className="w-full py-4 bg-white border border-gray-200 text-gray-500 font-medium rounded-xl hover:bg-gray-50 transition-all"
                        >
                            No, not right now
                        </button>
                    </div>

                    <p className="text-xs text-gray-400 mt-6">
                        By clicking Yes, you agree to share your contact profile with {company.companyName}.
                    </p>
                </div>
            </div>
        </div>
    );
}