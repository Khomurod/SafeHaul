import React, { useState, useMemo } from 'react';
import { Mail, MessageSquare, Send, Loader2, AlertCircle, CheckCircle, ExternalLink, Copy, BookOpen } from 'lucide-react';
import { logActivity } from '@shared/utils/activityLogger';
import { functions } from '@lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { useToast } from '@shared/components/feedback';

const TelegramLogo = ({ className }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
    >
        <path stroke="none" d="M0 0h24v24H0z" fill="none" />
        <path d="M15 10l-4 4l6 6l4 -16l-18 7l4 2l2 6l3 -4" />
    </svg>
);

const QUICK_TEMPLATES = {
    email: [
        { id: 'intro', label: 'Intro Request', subject: 'Regarding your application - {{company}}', body: 'Hi {{firstName}},\n\nI reviewed your application for the driver position. Are you available for a quick 5-min call today?\n\nBest,\nRecruiter' },
        { id: 'followup', label: 'Follow Up', subject: 'Checking in - {{company}}', body: 'Hi {{firstName}},\n\nI haven\'t heard back from you regarding my previous email. Is this something you are still interested in?\n\nThanks!' },
        { id: 'missing_docs', label: 'Missing Documents', subject: 'Action Required: Missing Info', body: 'Hi {{firstName}},\n\nWe are missing some documents to finalize your file. Please log back in to upload your CDL and Med Card.\n\nThanks,\nSafeHaul HR' }
    ],
    sms: [
        { id: 'call_now', label: 'Can you talk?', body: 'Hi {{firstName}}, this is recruiter from {{company}}. Can you talk for 5 mins regarding your app?' },
        { id: 'no_answer_sms', label: 'No Answer MSG', body: 'Hi {{firstName}}, tried calling you but missed you. Give me a call back at {{recruiterPhone}} when you can!' },
        { id: 'app_link', label: 'Finish Application', body: 'Hi {{firstName}}, please finish your driver application at app.safehaul.io to proceed to the next step!' }
    ]
};

export function ContactTab({ companyId, recordId, collectionName, email, phone, applicantData }) {
    const { showSuccess, showError } = useToast();
    const [activeMethod, setActiveMethod] = useState('email');
    const [message, setMessage] = useState('');
    const [subject, setSubject] = useState('');
    const [sending, setSending] = useState(false);
    const [success, setSuccess] = useState(false);
    const [showTemplates, setShowTemplates] = useState(false);

    const getTelegramLink = (rawPhone) => {
        if (!rawPhone) return '';
        let digits = rawPhone.replace(/\D/g, '');
        if (digits.length === 10) digits = '1' + digits;
        return `https://t.me/+${digits}`;
    };

    const applyTemplate = (template) => {
        const companyName = "SafeHaul Partner"; // Hardcoded for now or fetch from profile
        const firstName = applicantData?.firstName || "Driver";
        const recruiterPhone = "the portal";

        let processedBody = template.body
            .replace(/{{firstName}}/g, firstName)
            .replace(/{{company}}/g, companyName)
            .replace(/{{recruiterPhone}}/g, recruiterPhone);

        setMessage(processedBody);

        if (template.subject) {
            let processedSubject = template.subject
                .replace(/{{company}}/g, companyName)
                .replace(/{{firstName}}/g, firstName);
            setSubject(processedSubject);
        }

        setShowTemplates(false);
        showSuccess("Template applied!");
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(message);
        showSuccess("Copied to clipboard!");
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
                        driverfirstname: applicantData?.firstName || "Driver",
                        driverfullname: `${applicantData?.firstName || ""} ${applicantData?.lastName || ""}`.trim() || "Driver"
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
                // SMS (Real Outbound)
                const sendSmsFn = httpsCallable(functions, 'sendSMS');

                await sendSmsFn({
                    companyId,
                    recipientPhone: phone,
                    messageBody: message
                });

                await logActivity(
                    companyId,
                    collectionName,
                    recordId,
                    'SMS Sent',
                    `To: ${phone}\nMessage: ${message}`,
                    'communication'
                );
                showSuccess("SMS sent successfully.");
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
        <div className="space-y-6 h-full flex flex-col bg-white">
            <div className="flex bg-gray-100 p-1.5 rounded-xl shrink-0 overflow-x-auto shadow-inner">
                <button
                    onClick={() => { setActiveMethod('email'); setShowTemplates(false); }}
                    className={`flex-1 py-1.5 px-3 text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeMethod === 'email' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Mail size={14} /> EMAIL
                </button>
                <button
                    onClick={() => { setActiveMethod('sms'); setShowTemplates(false); }}
                    className={`flex-1 py-1.5 px-3 text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeMethod === 'sms' ? 'bg-white text-purple-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <MessageSquare size={14} /> SMS
                </button>
                <button
                    onClick={() => { setActiveMethod('telegram'); setShowTemplates(false); }}
                    className={`flex-1 py-1.5 px-3 text-[11px] font-bold rounded-lg flex items-center justify-center gap-2 transition-all whitespace-nowrap ${activeMethod === 'telegram' ? 'bg-white text-[#24A1DE] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <TelegramLogo className="w-3.5 h-3.5" /> TELEGRAM
                </button>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
                {success ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 animate-in zoom-in duration-300">
                        <div className="w-20 h-20 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6 shadow-sm border border-green-100">
                            <CheckCircle size={40} />
                        </div>
                        <h3 className="text-xl font-black text-slate-800">
                            {activeMethod === 'telegram' ? 'Redirected to Telegram' : 'Message Transmitted'}
                        </h3>
                        <p className="text-sm font-medium text-slate-500 mt-2">The action has been recorded in the audit trail.</p>
                        <button onClick={() => setSuccess(false)} className="mt-8 px-6 py-2 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 transition shadow-lg">Send another</button>
                    </div>
                ) : (
                    <form onSubmit={handleSend} className="flex flex-col h-full gap-4 relative">

                        {/* Status/Recipient Bar */}
                        <div className={`p-4 rounded-xl border flex items-center justify-between transition-colors shadow-sm ${activeMethod === 'email' ? 'bg-blue-50 border-blue-100' :
                            activeMethod === 'sms' ? 'bg-purple-50 border-purple-100' : 'bg-slate-50 border-slate-100'
                            }`}>
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold uppercase text-slate-500 tracking-wider mb-0.5">Recipient</span>
                                <span className={`text-sm font-semibold ${activeMethod === 'email' ? 'text-blue-700' : activeMethod === 'sms' ? 'text-purple-700' : 'text-slate-700'}`}>
                                    {activeMethod === 'email' ? (email || 'No email provided') : (phone || 'No phone provided')}
                                </span>
                            </div>

                            {(activeMethod === 'email' || activeMethod === 'sms') && (
                                <button
                                    type="button"
                                    onClick={() => setShowTemplates(!showTemplates)}
                                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${showTemplates ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-100 hover:border-slate-200'
                                        }`}
                                >
                                    <BookOpen size={14} /> Templates
                                </button>
                            )}
                        </div>

                        {/* Templates Menu */}
                        {showTemplates && (
                            <div className="absolute top-20 right-0 left-0 bg-white border border-slate-200 rounded-2xl shadow-2xl z-20 overflow-hidden animate-in slide-in-from-top-4 duration-200">
                                <div className="p-3 bg-slate-900 flex justify-between items-center text-white font-sans">
                                    <span className="text-[11px] font-bold uppercase tracking-wider">Select Template</span>
                                    <X size={16} className="cursor-pointer opacity-50 hover:opacity-100" onClick={() => setShowTemplates(false)} />
                                </div>
                                <div className="p-2 space-y-1 max-h-[300px] overflow-y-auto">
                                    {QUICK_TEMPLATES[activeMethod].map(t => (
                                        <button
                                            key={t.id}
                                            type="button"
                                            onClick={() => applyTemplate(t)}
                                            className="w-full text-left p-4 hover:bg-slate-50 rounded-xl transition-colors border-b border-gray-50 last:border-0 group"
                                        >
                                            <p className="font-bold text-sm text-slate-800 group-hover:text-blue-600 transition-colors">{t.label}</p>
                                            <p className="text-xs text-slate-500 truncate mt-1">{t.subject || t.body}</p>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeMethod === 'email' && (
                            <div className="flex-1 flex flex-col gap-4 animate-in fade-in slide-in-from-right-2">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Subject Line</label>
                                    <input
                                        className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-900 focus:ring-4 focus:ring-blue-100 outline-none transition-all"
                                        placeholder="Regarding your application..."
                                        value={subject}
                                        onChange={e => setSubject(e.target.value)}
                                        required
                                        disabled={!email}
                                    />
                                </div>
                                <div className="flex-1 flex flex-col min-h-0">
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Message Body</label>
                                    <textarea
                                        className="w-full flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium text-slate-700 focus:ring-4 focus:ring-blue-100 outline-none resize-none leading-relaxed"
                                        placeholder="Type your email message here..."
                                        value={message}
                                        onChange={e => setMessage(e.target.value)}
                                        required
                                        disabled={!email}
                                    ></textarea>
                                </div>
                            </div>
                        )}

                        {activeMethod === 'sms' && (
                            <div className="flex-1 flex flex-col gap-4 animate-in fade-in slide-in-from-right-2">
                                <div className="flex-1 flex flex-col min-h-0">
                                    <div className="flex justify-between items-center mb-1.5 px-1">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Text Message Content</label>
                                        <button
                                            type="button"
                                            onClick={handleCopy}
                                            className="text-[10px] font-bold text-purple-600 uppercase tracking-widest hover:underline flex items-center gap-1"
                                        >
                                            <Copy size={12} /> Copy to Clipboard
                                        </button>
                                    </div>
                                    <textarea
                                        className="w-full flex-1 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-semibold text-slate-700 focus:ring-4 focus:ring-purple-100 outline-none resize-none"
                                        placeholder="Type your SMS message here..."
                                        value={message}
                                        onChange={e => setMessage(e.target.value)}
                                        required
                                        disabled={!phone}
                                    ></textarea>
                                    <div className="mt-2 text-[10px] text-slate-400 flex items-center gap-2 px-1">
                                        <AlertCircle size={12} className="text-purple-400" />
                                        <span>SMS via SafeHaul Proxy. Standard carrier rates may apply to recipient.</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {activeMethod === 'telegram' && (
                            <div className="flex-1 flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-200 rounded-3xl bg-blue-50/20 animate-in fade-in slide-in-from-right-2">
                                <div className="w-20 h-20 bg-[#24A1DE] text-white rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-blue-200 rotate-3 group-hover:rotate-0 transition-transform">
                                    <TelegramLogo className="w-10 h-10" />
                                </div>
                                <h3 className="text-xl font-black text-slate-800 mb-2 font-sans tracking-tight">Direct Telegram Connect</h3>

                                {phone ? (
                                    <>
                                        <p className="text-center text-slate-500 text-sm mb-8 max-w-sm font-medium">
                                            Redirect to Telegram to chat with <span className="text-slate-900 font-bold">{phone}</span> using our secure gateway link.
                                        </p>
                                        <div className="bg-white p-4 rounded-xl border-2 border-slate-100 text-xs font-black text-blue-600 font-mono mb-8 select-all">
                                            {getTelegramLink(phone)}
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center gap-2 p-3 bg-red-50 text-red-600 rounded-xl border border-red-100 text-sm font-bold">
                                        <AlertCircle size={18} />
                                        No phone number available.
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="pt-4 flex justify-between items-center border-t border-gray-100">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">SafeHaul Communications Hub</span>
                            <button
                                type="submit"
                                disabled={
                                    sending ||
                                    (!email && activeMethod === 'email') ||
                                    (!phone && (activeMethod === 'telegram' || activeMethod === 'sms')) ||
                                    (activeMethod !== 'telegram' && !message)
                                }
                                className={`px-10 py-3.5 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-3 disabled:opacity-50 disabled:grayscale disabled:scale-100
                                    ${activeMethod === 'telegram' ? 'bg-[#24A1DE] hover:bg-[#1A8BA5] shadow-blue-100' :
                                        activeMethod === 'sms' ? 'bg-purple-600 hover:bg-purple-700 shadow-purple-100' :
                                            'bg-blue-600 hover:bg-blue-700 shadow-blue-100'}
                                `}
                            >
                                {sending ? <Loader2 className="animate-spin" size={18} /> : (activeMethod === 'telegram' ? <ExternalLink size={18} /> : <Send size={18} />)}
                                {activeMethod === 'telegram' ? 'OPEN GATEWAY' : `Transmit ${activeMethod.charAt(0).toUpperCase() + activeMethod.slice(1)}`}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}

