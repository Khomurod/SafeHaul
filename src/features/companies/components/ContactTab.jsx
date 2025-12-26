import React, { useState } from 'react';
import { Mail, MessageSquare, Send, Loader2, AlertCircle, CheckCircle, ExternalLink } from 'lucide-react';
import { logActivity } from '@shared/utils/activityLogger';
import { functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback';

export function ContactTab({ companyId, recordId, collectionName, email, phone }) {
    const { showSuccess, showError } = useToast();
    const [activeMethod, setActiveMethod] = useState('email');
    const [message, setMessage] = useState('');
    const [subject, setSubject] = useState('');
    const [sending, setSending] = useState(false);
    const [success, setSuccess] = useState(false);

    const getTelegramLink = (rawPhone) => {
        if (!rawPhone) return '';
        let digits = rawPhone.replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        return `https://t.me/+${digits}`;
    };

    const handleSend = async (e) => {
        e.preventDefault();
        setSending(true);

        try {
            if (activeMethod === 'telegram') {
                const link = getTelegramLink(phone);
                if (!link) {
                    showError("Invalid phone number for Telegram.");
                    setSending(false);
                    return;
                }
                
                window.open(link, '_blank');

                await logActivity(
                    companyId, 
                    collectionName, 
                    recordId, 
                    'Telegram Opened', 
                    `Opened Telegram chat for ${phone}`,
                    'communication'
                );
                setSuccess(true); 

            } else if (activeMethod === 'email') {
                if (!email) {
                    showError("No email address available for this driver.");
                    setSending(false);
                    return;
                }

                const sendEmailFn = httpsCallable(functions, 'sendAutomatedEmail');
                
                await sendEmailFn({
                    companyId,
                    recipientEmail: email,
                    triggerType: 'manual_email', 
                    placeholders: {
                        subject: subject,
                        body: message,
                        driverfirstname: "Driver",
                        driverfullname: "Driver"
                    }
                });

                await logActivity(
                    companyId, 
                    collectionName, 
                    recordId, 
                    'Email Sent', 
                    `Subject: ${subject}\nTo: ${email}`,
                    'communication'
                );
                
                showSuccess("Email sent successfully.");
                setSuccess(true);

            } else {
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                await logActivity(
                    companyId, 
                    collectionName, 
                    recordId, 
                    'SMS Sent', 
                    `To: ${phone}\nMessage: ${message}`,
                    'communication'
                );
                setSuccess(true);
            }

            setMessage('');
            setSubject('');
            setTimeout(() => setSuccess(false), 3000);

        } catch (error) {
            console.error("Send failed:", error);
            showError(`Failed to send: ${error.message}`);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="space-y-6 h-full flex flex-col">
            <div className="flex bg-gray-100 p-1 rounded-lg shrink-0 overflow-x-auto">
                <button 
                    onClick={() => setActiveMethod('email')}
                    className={`flex-1 py-2 px-2 text-sm font-bold rounded-md flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeMethod === 'email' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Mail size={16} /> Email
                </button>
                <button 
                    onClick={() => setActiveMethod('sms')}
                    className={`flex-1 py-2 px-2 text-sm font-bold rounded-md flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeMethod === 'sms' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <MessageSquare size={16} /> SMS
                </button>
                <button 
                    onClick={() => setActiveMethod('telegram')}
                    className={`flex-1 py-2 px-2 text-sm font-bold rounded-md flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeMethod === 'telegram' ? 'bg-white text-blue-500 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Send size={16} className="rotate-[-45deg] mb-1" /> Telegram
                </button>
            </div>

            <div className="flex-1 flex flex-col">
                {success ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-in zoom-in">
                        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                            <CheckCircle size={32} />
                        </div>
                        <h3 className="text-xl font-bold text-gray-800">
                            {activeMethod === 'telegram' ? 'Telegram Opened' : 'Sent Successfully'}
                        </h3>
                        <p className="text-gray-500 mt-2">The activity has been logged to History.</p>
                        <button onClick={() => setSuccess(false)} className="mt-6 text-blue-600 font-semibold hover:underline">Send another</button>
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="flex flex-col h-full gap-4">
                        
                        {activeMethod === 'email' && (
                            <>
                                <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg text-sm text-blue-800">
                                    <span className="font-bold">To:</span> {email || 'No email provided'}
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Subject</label>
                                    <input 
                                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="Regarding your application..."
                                        value={subject}
                                        onChange={e => setSubject(e.target.value)}
                                        required
                                        disabled={!email}
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Message</label>
                                    <textarea 
                                        className="w-full h-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                                        placeholder="Type your email message here..."
                                        value={message}
                                        onChange={e => setMessage(e.target.value)}
                                        required
                                        disabled={!email}
                                    ></textarea>
                                </div>
                            </>
                        )}

                        {activeMethod === 'sms' && (
                            <>
                                <div className="bg-purple-50 border border-purple-100 p-3 rounded-lg text-sm text-purple-800">
                                    <span className="font-bold">To:</span> {phone || 'No phone provided'}
                                    <div className="mt-1 text-xs opacity-75 flex items-center gap-1">
                                        <AlertCircle size={10} /> SMS functionality Coming Soon
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Message</label>
                                    <textarea 
                                        className="w-full h-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                                        placeholder="Type your SMS message here..."
                                        value={message}
                                        onChange={e => setMessage(e.target.value)}
                                        required
                                        disabled={true} 
                                    ></textarea>
                                </div>
                            </>
                        )}

                        {activeMethod === 'telegram' && (
                            <div className="flex-1 flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-200 rounded-xl bg-blue-50/30">
                                <div className="w-16 h-16 bg-blue-100 text-blue-500 rounded-full flex items-center justify-center mb-4">
                                    <Send size={32} className="rotate-[-45deg] mr-1 mt-1" />
                                </div>
                                <h3 className="text-lg font-bold text-gray-800 mb-2">Send via Telegram</h3>
                                
                                {phone ? (
                                    <>
                                        <p className="text-center text-gray-600 text-sm mb-6 max-w-xs">
                                            This will open a chat with <strong>{phone}</strong> in your Telegram app.
                                        </p>
                                        <div className="bg-white p-3 rounded-lg border border-gray-200 text-sm font-mono text-gray-700 mb-6">
                                            {getTelegramLink(phone)}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-red-500 font-medium">No phone number available for this driver.</p>
                                )}
                            </div>
                        )}

                        <div className="flex justify-end">
                            <button 
                                type="submit"
                                disabled={
                                    sending || 
                                    (activeMethod === 'sms') || 
                                    (!email && activeMethod === 'email') || 
                                    (!phone && activeMethod === 'telegram')
                                }
                                className={`px-6 py-3 text-white font-bold rounded-xl shadow-md disabled:opacity-50 flex items-center gap-2 transition-all
                                    ${activeMethod === 'telegram' ? 'bg-[#24A1DE] hover:bg-[#1A8LB5]' : 'bg-blue-600 hover:bg-blue-700'}
                                `}
                            >
                                {sending ? <Loader2 className="animate-spin" size={18} /> : (activeMethod === 'telegram' ? <ExternalLink size={18}/> : <Send size={18} />)}
                                {activeMethod === 'telegram' ? 'Open Telegram' : `Send ${activeMethod === 'email' ? 'Email' : 'SMS'}`}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
