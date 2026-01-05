import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@lib/firebase';
import { Link as LinkIcon, CheckCircle, Copy, Zap } from 'lucide-react';

export function RecruiterLink({ currentCompanyProfile, leadId }) { // Accept leadId
    const [recruiterCode, setRecruiterCode] = useState(null);
    const [linkCopied, setLinkCopied] = useState(false);

    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    useEffect(() => {
        const fetchCode = async () => {
            if (!auth.currentUser) return;
            try {
                const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
                if (userDoc.exists()) {
                    setRecruiterCode(userDoc.data().recruitingCode || auth.currentUser.uid);
                }
            } catch (e) {
                console.error("Error fetching recruiter code", e);
            }
        };
        fetchCode();
    }, []);

    // GENERATE "INTEREST" LINK
    const getLink = () => {
        const cleanBase = appBaseUrl.replace(/\/$/, "");
        const slug = currentCompanyProfile?.appSlug || 'apply';
        const code = recruiterCode || 'general';

        // If we know the Lead ID, use the Interest Page
        if (leadId) {
            return `${cleanBase}/interest/${slug}?r=${code}&leadId=${leadId}`;
        }

        // Fallback to standard application
        return `${cleanBase}/apply/${slug}?r=${code}`;
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(getLink());
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    };

    return (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg border border-blue-100 shadow-sm text-blue-600">
                    <Zap size={20} className="fill-blue-600" />
                </div>
                <div className="flex-1">
                    <h4 className="font-bold text-blue-900">
                        {leadId ? "Send Interest Invite" : "Application Link"}
                    </h4>
                    <p className="text-sm text-blue-700 mt-1 mb-3">
                        {leadId 
                            ? "Send this link to the driver. When they click 'Yes', they will be instantly locked to your dashboard." 
                            : "Standard application link for this company."}
                    </p>

                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-blue-200">
                        <code className="flex-1 text-xs font-mono text-gray-600 truncate px-2">
                            {getLink()}
                        </code>
                        <button 
                            onClick={handleCopyLink}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-md transition-all flex items-center gap-1.5"
                        >
                            {linkCopied ? <CheckCircle size={14} /> : <Copy size={14} />}
                            {linkCopied ? "Copied" : "Copy"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}