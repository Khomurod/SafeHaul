import React, { useState, useEffect } from 'react';
import { doc, updateDoc } from "firebase/firestore";
import { db } from '@lib/firebase';
import { Save, Loader2, AlertTriangle, MessageSquare, Zap } from 'lucide-react';
import { useToast } from '@shared/components/feedback';

export function EmailSettingsTab({ currentCompanyProfile }) {
    const { showSuccess, showError } = useToast();
    const [emailSettings, setEmailSettings] = useState({
        provider: 'gmail',
        email: '',
        appPassword: '', 
        signature: '',
        templates: {
            no_answer: {
                enabled: false,
                subject: '',
                body: ''
            }
        }
    });
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (currentCompanyProfile?.emailSettings) {
            setEmailSettings(prev => ({
                ...prev,
                ...currentCompanyProfile.emailSettings,
                templates: {
                    ...prev.templates,
                    ...(currentCompanyProfile.emailSettings.templates || {})
                }
            }));
        }
    }, [currentCompanyProfile]);

    const handleSaveEmailSettings = async () => {
        setLoading(true);
        try {
            const companyRef = doc(db, "companies", currentCompanyProfile.id);
            await updateDoc(companyRef, { emailSettings });
            showSuccess('Email settings updated successfully.');
        } catch (error) {
            console.error("Error saving email settings:", error);
            showError("Failed to save email settings.");
        } finally {
            setLoading(false);
        }
    };

    const handleTemplateChange = (trigger, field, value) => {
        setEmailSettings(prev => ({
            ...prev,
            templates: {
                ...prev.templates,
                [trigger]: {
                    ...prev.templates[trigger],
                    [field]: value
                }
            }
        }));
    };

    return (
        <div className="space-y-8 max-w-3xl animate-in fade-in">
            <div className="border-b border-gray-200 pb-4 mb-6">
                <h2 className="text-xl font-bold text-gray-900">Email Integration</h2>
                <p className="text-sm text-gray-500 mt-1">Configure your email to send messages directly from the dashboard.</p>
            </div>
      
            <div className="bg-blue-50 border border-blue-100 p-4 rounded-lg flex gap-3 items-start mb-6">
                <AlertTriangle className="text-blue-600 shrink-0 mt-1" size={20} />
                <div className="text-sm text-blue-800">
                    <p className="font-bold">For Gmail Users:</p>
                    <p>You must use an <strong>App Password</strong>. Go to Google Account &gt; Security &gt; 2-Step Verification &gt; App Passwords to generate one.</p>
                </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
                 <h3 className="font-bold text-gray-800 border-b pb-2 mb-4">SMTP Credentials</h3>
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                    <input 
                        type="email" 
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                        value={emailSettings.email || ''} 
                        onChange={e => setEmailSettings({...emailSettings, email: e.target.value})} 
                        placeholder="recruiting@company.com" 
                    />
                 </div>
        
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">App Password (SMTP)</label>
                    <input 
                        type="password" 
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" 
                        value={emailSettings.appPassword || ''} 
                        onChange={e => setEmailSettings({...emailSettings, appPassword: e.target.value})} 
                        placeholder="xxxx xxxx xxxx xxxx" 
                    />
                 </div>
     
                 <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Signature</label>
                    <textarea 
                        className="w-full p-3 border border-gray-300 rounded-lg h-24 focus:ring-2 focus:ring-blue-500 outline-none" 
                        value={emailSettings.signature || ''} 
                        onChange={e => setEmailSettings({...emailSettings, signature: e.target.value})} 
                        placeholder="Best regards,&#10;Recruiting Team" 
                    />
                 </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-4">
                <h3 className="font-bold text-gray-800 border-b pb-2 mb-4 flex items-center gap-2">
                    <Zap size={20} className="text-yellow-500" fill="currentColor" /> Automated Templates
                </h3>
                
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <MessageSquare size={18} className="text-gray-600"/>
                            <span className="font-semibold text-gray-800">Trigger: "No Answer" or "Voicemail"</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                                type="checkbox" 
                                className="sr-only peer"
                                checked={emailSettings.templates?.no_answer?.enabled || false}
                                onChange={(e) => handleTemplateChange('no_answer', 'enabled', e.target.checked)}
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            <span className="ml-3 text-sm font-medium text-gray-900">Enable</span>
                        </label>
                    </div>

                    {emailSettings.templates?.no_answer?.enabled && (
                        <div className="space-y-3 animate-in fade-in">
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Subject Line</label>
                                <input 
                                    className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Sorry we missed you!"
                                    value={emailSettings.templates?.no_answer?.subject || ''}
                                    onChange={(e) => handleTemplateChange('no_answer', 'subject', e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Email Body</label>
                                <textarea 
                                    className="w-full p-2 border border-gray-300 rounded h-32 focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Hi {driverfirstname}, I tried calling you..."
                                    value={emailSettings.templates?.no_answer?.body || ''}
                                    onChange={(e) => handleTemplateChange('no_answer', 'body', e.target.value)}
                                />
                                <p className="text-xs text-gray-500 mt-1">
                                    Available placeholders: <code className="bg-gray-100 px-1 rounded">{'{driverfullname}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{driverfirstname}'}</code>, <code className="bg-gray-100 px-1 rounded">{'{recruitername}'}</code>
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="pt-4 flex justify-end">
                <button 
                onClick={handleSaveEmailSettings} 
                disabled={loading} 
                className="px-6 py-3 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 shadow-md"
                >
                    {loading ? <Loader2 className="animate-spin"/> : <Save size={18}/>} Save Settings
                </button>
            </div>
        </div>
    );
}
