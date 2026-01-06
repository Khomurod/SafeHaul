// src/features/settings/components/PersonalProfileTab.jsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc, setDoc } from "firebase/firestore";
import { db } from '@lib/firebase';
import { Save, Loader2, Link as LinkIcon, Copy, CheckCircle } from 'lucide-react';
import { useToast } from '@shared/components/feedback';

export function PersonalProfileTab({ currentUser, currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [personalData, setPersonalData] = useState({ name: '' });
    const [recruitingCode, setRecruitingCode] = useState(null);
    const [loading, setLoading] = useState(false);
    const [linkLoading, setLinkLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    // FIX: Use Env var if present, otherwise fallback to current origin (robust for MVP)
    const appBaseUrl = import.meta.env.VITE_DRIVER_APP_URL || window.location.origin;

    useEffect(() => {
        const fetchUserAndCode = async () => {
            if (currentUser?.uid) {
                try {
                    const userDocRef = doc(db, "users", currentUser.uid);
                    const userDoc = await getDoc(userDocRef);

                    if (userDoc.exists()) {
                        const data = userDoc.data();
                        setPersonalData({ name: data.name || '' });

                        if (data.recruitingCode) {
                            setRecruitingCode(data.recruitingCode);
                            setLinkLoading(false);
                        } else {
                            await generateShortCode(currentUser.uid);
                        }
                    }
                } catch (e) {
                    console.error("Error fetching profile:", e);
                    setLinkLoading(false);
                }
            }
        };
        fetchUserAndCode();
    }, [currentUser]);

    const generateShortCode = async (uid) => {
        setLinkLoading(true);
        try {
            const code = Math.random().toString(36).substring(2, 8).toUpperCase();

            // 1. Save mapping
            await setDoc(doc(db, "recruiter_links", code), {
                userId: uid,
                companyId: currentCompanyProfile.id,
                createdAt: new Date()
            });

            // 2. Save code to user profile
            await updateDoc(doc(db, "users", uid), {
                recruitingCode: code
            });

            setRecruitingCode(code);
        } catch (err) {
            console.error("Error generating link:", err);
            showError("Could not generate tracking link.");
        } finally {
            setLinkLoading(false);
        }
    };

    const handleSavePersonal = async () => {
        setLoading(true);
        try {
            const userRef = doc(db, "users", currentUser.uid);
            await updateDoc(userRef, { name: personalData.name });
            showSuccess('Personal profile updated successfully.');
        } catch (error) {
            console.error("User save failed", error);
            showError("Failed to update profile.");
        } finally {
            setLoading(false);
        }
    };

    // Construct the link
    const companySlug = currentCompanyProfile?.appSlug || 'general';
    // Clean trailing slash just in case
    const cleanBaseUrl = appBaseUrl.replace(/\/$/, "");

    const uniqueLink = recruitingCode 
        ? `${cleanBaseUrl}/apply/${companySlug}?r=${recruitingCode}`
        : `${cleanBaseUrl}/apply/${companySlug}?recruiter=${currentUser?.uid}`;

    const handleCopyLink = () => {
        if (!uniqueLink) return;
        navigator.clipboard.writeText(uniqueLink);
        setCopied(true);
        showSuccess("Short link copied!");
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-8 max-w-4xl animate-in fade-in">
            <div className="border-b border-gray-200 pb-4 mb-6">
                <h2 className="text-xl font-bold text-gray-900">Personal Profile</h2>
                <p className="text-sm text-gray-500 mt-1">Update your personal details and access your recruiting tools.</p>
            </div>

            <div className="border rounded-xl p-6 shadow-sm bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-100">
                <div className="flex items-start gap-4">
                    <div className="p-3 rounded-lg shadow-sm bg-white text-blue-600">
                        <LinkIcon size={24} />
                    </div>
                    <div className="flex-1">
                        <h3 className="text-lg font-bold mb-1 text-blue-900">
                            Your Short Recruiting Link
                        </h3>

                        <p className="text-sm text-blue-700 mb-4">
                            Share this link. Drivers who apply will be <strong>automatically assigned to you</strong>.
                        </p>

                        {linkLoading ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Loader2 className="animate-spin" size={16} /> Generating unique code...
                            </div>
                        ) : (
                            <div className="flex items-center gap-2 bg-white p-2 rounded-lg border border-blue-200">
                                <code className="flex-1 text-xs sm:text-sm font-mono text-gray-600 truncate px-2">
                                    {uniqueLink}
                                </code>

                                <button 
                                    onClick={handleCopyLink}
                                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-md transition-all flex items-center gap-2"
                                >
                                    {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
                                    {copied ? "Copied" : "Copy"}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-8 space-y-6 shadow-sm">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                    <input 
                        type="text" 
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                        value={personalData.name} 
                        onChange={(e) => setPersonalData({...personalData, name: e.target.value})} 
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Email</label>
                    <input 
                        type="text" 
                        className="w-full p-3 border border-gray-200 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                        value={currentUser?.email || ''} 
                        readOnly 
                    />
                    <p className="text-xs text-gray-400 mt-1">Email cannot be changed directly.</p>
                </div>

                <div className="flex justify-end pt-4">
                    <button 
                        onClick={handleSavePersonal} 
                        disabled={loading} 
                        className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-md transition-all"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : <Save size={18} />} Update Profile
                    </button>
                </div>
            </div>
        </div>
    );
}