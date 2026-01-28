import React from 'react';
import { MessageSquare, Mail, Zap, Info } from 'lucide-react';
import { DeviceMockup } from './DeviceMockup';

export function ContentComposer({ messageConfig, onChange }) {

    const handleChange = (key, value) => {
        onChange({ ...messageConfig, [key]: value });
    };

    const insertVariable = (variable) => {
        const field = messageConfig.method === 'email' && activeField === 'subject' ? 'subject' : 'message';
        const current = messageConfig[field] || '';
        handleChange(field, current + ` ${variable} `);
    };

    // Track which field is active for variable insertion
    const [activeField, setActiveField] = React.useState('message');

    const VARIABLES = [
        { label: 'Driver Name', value: '[Driver Name]' },
        { label: 'My Company', value: '[Company Name]' },
        { label: 'Recruiter Name', value: '[Recruiter Name]' },
    ];

    return (
        <div className="max-w-4xl mx-auto">
            <div className="mb-8">
                <h2 className="text-2xl font-black text-slate-900 mb-2">Content Strategy</h2>
                <p className="text-slate-500">Craft a compelling message. Personalize it with variables.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left: Composer */}
                <div className="lg:col-span-2 space-y-6">

                    {/* Channel Selector */}
                    <div className="bg-white p-1 rounded-xl border border-slate-200 inline-flex">
                        <button
                            onClick={() => handleChange('method', 'sms')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${messageConfig.method === 'sms' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                        >
                            <MessageSquare size={16} /> SMS
                        </button>
                        <button
                            onClick={() => handleChange('method', 'email')}
                            className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${messageConfig.method === 'email' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}
                        >
                            <Mail size={16} /> Email
                        </button>
                    </div>

                    {/* Editor */}
                    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative">

                        {messageConfig.method === 'email' && (
                            <div className="mb-4">
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Subject Line</label>
                                <input
                                    type="text"
                                    value={messageConfig.subject || ''}
                                    onChange={(e) => handleChange('subject', e.target.value)}
                                    onFocus={() => setActiveField('subject')}
                                    placeholder="e.g. Unique Opportunity for [Driver Name]"
                                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-100"
                                />
                            </div>
                        )}

                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Message Body</label>
                        <textarea
                            value={messageConfig.message || ''}
                            onChange={(e) => handleChange('message', e.target.value)}
                            onFocus={() => setActiveField('message')}
                            placeholder={messageConfig.method === 'sms' ? "Hey [Driver Name], we have a new lane open..." : "Dear [Driver Name]..."}
                            className="w-full h-64 p-4 bg-slate-50 border border-slate-200 rounded-xl font-medium outline-none focus:ring-2 focus:ring-blue-100 resize-none text-base leading-relaxed"
                        />

                        {/* Formatting Toolbar */}
                        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                            <div className="flex gap-2">
                                {VARIABLES.map(v => (
                                    <button
                                        key={v.value}
                                        onClick={() => insertVariable(v.value)}
                                        className="px-2 py-1 bg-slate-200 hover:bg-slate-300 rounded text-xs font-bold text-slate-600 transition-colors"
                                    >
                                        + {v.label}
                                    </button>
                                ))}
                            </div>
                            <div className="text-xs font-bold text-slate-400">
                                {messageConfig.message?.length || 0} chars
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right: Preview & Tips */}
                <div className="lg:col-span-1 space-y-8">
                    {/* Device Preview */}
                    <div className="bg-slate-100 p-8 rounded-[3rem] border border-slate-200 shadow-inner">
                        <DeviceMockup type={messageConfig.method}>
                            <div className="p-6">
                                <div className="flex items-center gap-3 mb-6">
                                    <div className="w-10 h-10 rounded-full bg-slate-200"></div>
                                    <div className="flex-1">
                                        <div className="h-2 w-20 bg-slate-200 rounded mb-2"></div>
                                        <div className="h-1.5 w-32 bg-slate-100 rounded"></div>
                                    </div>
                                </div>
                                <div className="bg-blue-600 text-white p-4 rounded-2xl rounded-tl-none text-sm font-medium shadow-md leading-relaxed">
                                    {messageConfig.message || 'Type something to see a preview...'}
                                </div>
                            </div>
                        </DeviceMockup>
                    </div>

                    <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                        <h3 className="flex items-center gap-2 font-bold text-blue-900 mb-4">
                            <Zap size={18} className="text-blue-500" /> Pro Tips
                        </h3>
                        <ul className="space-y-3">
                            <li className="flex gap-3 text-sm text-blue-800">
                                <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
                                <span>Keep SMS under 160 characters to avoid splitting.</span>
                            </li>
                            <li className="flex gap-3 text-sm text-blue-800">
                                <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
                                <span>Use <strong>[Driver Name]</strong> to increase engagement by 35%.</span>
                            </li>
                            <li className="flex gap-3 text-sm text-blue-800">
                                <Info size={16} className="text-blue-400 shrink-0 mt-0.5" />
                                <span>End with a clear question to prompt a reply.</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
