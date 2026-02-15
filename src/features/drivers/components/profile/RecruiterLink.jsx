import React, { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '@lib/firebase';
import { Link as LinkIcon, CheckCircle, Copy } from 'lucide-react';

export function RecruiterLink({ currentCompanyProfile }) {
    const [recruiterCode, setRecruiterCode] = useState(null);
    const [linkCopied, setLinkCopied] = useState(false);

    // FIX: Robust base URL resolution
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

    const getRecruiterLink = () => {
        const cleanBase = appBaseUrl.replace(/\/$/, "");
        const slug = currentCompanyProfile?.appSlug || 'apply';
        const code = recruiterCode || 'general';
        return `${cleanBase}/apply/${slug}?r=${code}`;
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(getRecruiterLink());
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
    };

    return (
        <div className="bg-gradient-to-r from-indigo-50 to-blue-50 border border-blue-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-start gap-3">
                <div className="p-2 bg-white rounded-lg border border-blue-100 shadow-sm text-blue-600">
                    <LinkIcon size={20} />
                </div>
                <div className="flex-1">
                    <h4 className="font-bold text-blue-900">Your Exclusive Application Link</h4>
                    <p className="text-sm text-blue-700 mt-1 mb-3">
                        If this lead is interested, send them this link. They will be automatically assigned to <strong>YOU</strong> in 
                        your dashboard when they apply.
                    </p>

                    <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-blue-200">
                        <code className="flex-1 text-xs font-mono text-gray-600 truncate px-2">
                            {getRecruiterLink()}
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