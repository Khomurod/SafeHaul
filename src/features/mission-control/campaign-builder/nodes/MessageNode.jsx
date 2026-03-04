import React, { useState, useEffect, memo } from 'react';
import { motion } from 'framer-motion';
import { Handle, Position } from 'reactflow';
import { MessageSquare, Mail, Phone, ChevronDown, Save, Folder, User, AlertCircle } from 'lucide-react';
import { collection, getDocs, addDoc, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebase/config';

const MESSAGE_PLACEHOLDERS = [
    { key: '[Driver Name]', label: 'Driver Name', desc: 'First name of the driver' },
    { key: '[Company Name]', label: 'Company', desc: 'Your company name' },
    { key: '[Recruiter Name]', label: 'Recruiter', desc: 'Assigned recruiter name' },
];

const MAX_SMS_LENGTH = 160;
const MAX_SMS_SEGMENTS = 3;

/**
 * MessageNode - ReactFlow node for composing campaign messages
 */
const MessageNode = memo(({ data, selected }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [method, setMethod] = useState('sms'); // sms | email
    const [message, setMessage] = useState('');
    const [subject, setSubject] = useState('');
    const [templates, setTemplates] = useState([]);
    const [showTemplates, setShowTemplates] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    // Fetch templates
    useEffect(() => {
        const fetchTemplates = async () => {
            if (!data.companyId) return;
            try {
                const templatesRef = collection(db, 'companies', data.companyId, 'message_templates');
                const q = query(templatesRef, orderBy('createdAt', 'desc'), limit(10));
                const snapshot = await getDocs(q);
                setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            } catch (err) {
                console.error('Error fetching templates:', err);
            }
        };
        fetchTemplates();
    }, [data.companyId]);

    // Update parent data when message changes
    useEffect(() => {
        if (data.onUpdate) {
            data.onUpdate({ method, message, subject });
        }
    }, [method, message, subject]);

    const insertPlaceholder = (placeholder) => {
        setMessage(prev => prev + placeholder);
    };

    const loadTemplate = (template) => {
        setMessage(template.message || template.text || '');
        if (template.subject) setSubject(template.subject);
        if (template.method) setMethod(template.method);
        setShowTemplates(false);
    };

    const saveTemplate = async () => {
        if (!templateName.trim() || !message.trim()) return;
        setIsSaving(true);
        try {
            await addDoc(collection(db, 'companies', data.companyId, 'message_templates'), {
                name: templateName,
                method,
                message,
                subject,
                createdAt: serverTimestamp(),
            });
            setTemplateName('');
            // Refresh templates
            const templatesRef = collection(db, 'companies', data.companyId, 'message_templates');
            const q = query(templatesRef, orderBy('createdAt', 'desc'), limit(10));
            const snapshot = await getDocs(q);
            setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (err) {
            console.error('Error saving template:', err);
        } finally {
            setIsSaving(false);
        }
    };

    const smsSegments = Math.ceil(message.length / MAX_SMS_LENGTH);
    const isOverLimit = method === 'sms' && smsSegments > MAX_SMS_SEGMENTS;

    return (
        <div
            className={`
        min-w-[360px] rounded-2xl overflow-hidden
        bg-gradient-to-br from-purple-600/20 to-purple-500/10
        border-2 ${selected ? 'border-purple-400' : 'border-purple-500/30'}
        shadow-xl shadow-purple-500/10
        transition-all duration-200
      `}
        >
            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Left}
                className="!w-4 !h-4 !bg-purple-500 !border-2 !border-purple-300"
            />

            {/* Header */}
            <div className="p-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/30 flex items-center justify-center">
                        <MessageSquare className="w-5 h-5 text-purple-300" />
                    </div>
                    <div className="flex-1">
                        <div className="text-white font-bold">Compose Message</div>
                        <div className="text-purple-300 text-sm">
                            {method === 'sms' ? '📱 SMS' : '📧 Email'}
                            {message.length > 0 && ` • ${message.length} chars`}
                        </div>
                    </div>
                    <motion.button
                        className="p-2 rounded-lg hover:bg-white/10"
                        onClick={() => setIsExpanded(!isExpanded)}
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                    >
                        <ChevronDown className="w-5 h-5 text-slate-400" />
                    </motion.button>
                </div>
            </div>

            {/* Expanded Content */}
            {isExpanded && (
                <motion.div
                    className="p-4 space-y-4 nodrag"
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                >
                    {/* Method Toggle */}
                    <div className="flex gap-2">
                        <button
                            onClick={() => setMethod('sms')}
                            className={`
                flex-1 py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2
                ${method === 'sms'
                                    ? 'bg-purple-500/30 text-white border border-purple-400/50'
                                    : 'bg-white/5 text-slate-400 border border-transparent'
                                }
              `}
                        >
                            <Phone className="w-4 h-4" /> SMS
                        </button>
                        <button
                            onClick={() => setMethod('email')}
                            className={`
                flex-1 py-2.5 rounded-xl font-medium text-sm flex items-center justify-center gap-2
                ${method === 'email'
                                    ? 'bg-purple-500/30 text-white border border-purple-400/50'
                                    : 'bg-white/5 text-slate-400 border border-transparent'
                                }
              `}
                        >
                            <Mail className="w-4 h-4" /> Email
                        </button>
                    </div>

                    {/* Email Subject */}
                    {method === 'email' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                                Subject Line
                            </label>
                            <input
                                type="text"
                                value={subject}
                                onChange={(e) => setSubject(e.target.value)}
                                placeholder="Enter email subject..."
                                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-white text-sm"
                            />
                        </div>
                    )}

                    {/* Message Area */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                                Message
                            </label>
                            <button
                                onClick={() => setShowTemplates(!showTemplates)}
                                className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                            >
                                <Folder className="w-3 h-3" /> Templates
                            </button>
                        </div>

                        {/* Templates Dropdown */}
                        {showTemplates && templates.length > 0 && (
                            <div className="mb-3 bg-white/5 rounded-xl p-2 max-h-40 overflow-y-auto">
                                {templates.map(t => (
                                    <button
                                        key={t.id}
                                        onClick={() => loadTemplate(t)}
                                        className="w-full text-left p-2 rounded-lg hover:bg-white/10 text-sm text-white"
                                    >
                                        {t.name}
                                    </button>
                                ))}
                            </div>
                        )}

                        <textarea
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="Type your message here..."
                            rows={4}
                            className={`
                w-full bg-white/5 border rounded-xl p-3 text-white text-sm resize-none
                ${isOverLimit ? 'border-red-500' : 'border-white/10'}
              `}
                        />

                        {/* Character Count */}
                        {method === 'sms' && (
                            <div className={`flex items-center justify-between mt-2 text-xs ${isOverLimit ? 'text-red-400' : 'text-slate-400'}`}>
                                <span>
                                    {message.length} / {MAX_SMS_LENGTH * MAX_SMS_SEGMENTS} chars
                                </span>
                                <span>
                                    {smsSegments} segment{smsSegments !== 1 ? 's' : ''}
                                </span>
                            </div>
                        )}

                        {isOverLimit && (
                            <div className="flex items-center gap-2 mt-2 text-red-400 text-xs">
                                <AlertCircle className="w-3 h-3" />
                                Message too long. Consider shortening or using email.
                            </div>
                        )}
                    </div>

                    {/* Placeholders */}
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 block">
                            Insert Variable
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {MESSAGE_PLACEHOLDERS.map(p => (
                                <button
                                    key={p.key}
                                    onClick={() => insertPlaceholder(p.key)}
                                    className="px-3 py-1.5 rounded-full bg-white/5 text-slate-300 text-xs hover:bg-white/10"
                                >
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Save Template */}
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            placeholder="Template name..."
                            className="flex-1 bg-white/5 border border-white/10 rounded-xl p-2 text-white text-sm"
                        />
                        <button
                            onClick={saveTemplate}
                            disabled={isSaving || !templateName.trim()}
                            className="px-4 py-2 rounded-xl bg-purple-500/30 text-purple-300 text-sm font-medium disabled:opacity-50"
                        >
                            <Save className="w-4 h-4" />
                        </button>
                    </div>
                </motion.div>
            )}

            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Right}
                className="!w-4 !h-4 !bg-purple-500 !border-2 !border-purple-300"
            />
        </div>
    );
});

MessageNode.displayName = 'MessageNode';

export default MessageNode;
