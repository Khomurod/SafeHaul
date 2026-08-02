import React, { useRef, useState } from 'react';
import { MessageSquare, Mail, Zap, Info, Plus } from 'lucide-react';
import { DeviceMockup } from './DeviceMockup';
import { Card, FormField, Input, Textarea, Button } from '@/design-system/components';

export function ContentComposer({ messageConfig, onChange }) {
    const messageRef = useRef(null);
    const subjectRef = useRef(null);
    // Track which field is active for variable insertion.
    const [activeField, setActiveField] = useState('message');

    const handleChange = (key, value) => {
        onChange({ ...messageConfig, [key]: value });
    };

    const insertVariable = (variable) => {
        const field = messageConfig.method === 'email' && activeField === 'subject' ? 'subject' : 'message';
        const el = field === 'subject' ? subjectRef.current : messageRef.current;
        const current = messageConfig[field] || '';

        if (el && typeof el.selectionStart === 'number') {
            const start = el.selectionStart;
            const end = el.selectionEnd ?? start;
            const insertion = ` ${variable} `;
            const next = `${current.slice(0, start)}${insertion}${current.slice(end)}`;
            handleChange(field, next);
            const caret = start + insertion.length;
            requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(caret, caret);
            });
            return;
        }

        handleChange(field, current + ` ${variable} `);
    };

    const VARIABLES = [
        { label: 'Driver Name', value: '[Driver Name]' },
        { label: 'My Company', value: '[Company Name]' },
        { label: 'Recruiter Name', value: '[Recruiter Name]' },
    ];

    const isEmail = messageConfig.method === 'email';

    return (
        <div className="mx-auto max-w-4xl">
            <div className="mb-ds-8">
                <h2 className="mb-ds-2 text-ds-heading-lg font-bold text-ds-content">Content Strategy</h2>
                <p className="text-ds-body text-ds-content-secondary">Craft a compelling message. Personalize it with variables.</p>
            </div>

            <div className="grid grid-cols-1 gap-ds-8 lg:grid-cols-3">
                {/* Left: Composer */}
                <div className="flex flex-col gap-ds-6 lg:col-span-2">

                    {/* Channel selector */}
                    <div
                        role="group"
                        aria-label="Message channel"
                        className="inline-flex gap-ds-1 self-start rounded-ds-lg border border-ds-border-subtle bg-ds-surface p-ds-1"
                    >
                        <Button
                            variant={messageConfig.method === 'sms' ? 'primary' : 'ghost'}
                            size="sm"
                            aria-pressed={messageConfig.method === 'sms'}
                            onClick={() => handleChange('method', 'sms')}
                        >
                            <MessageSquare size={16} aria-hidden="true" /> SMS
                        </Button>
                        <Button
                            variant={isEmail ? 'primary' : 'ghost'}
                            size="sm"
                            aria-pressed={isEmail}
                            onClick={() => handleChange('method', 'email')}
                        >
                            <Mail size={16} aria-hidden="true" /> Email
                        </Button>
                    </div>

                    {/* Editor */}
                    <Card className="flex flex-col gap-ds-4">
                        {isEmail && (
                            <FormField label="Subject Line">
                                <Input
                                    ref={subjectRef}
                                    type="text"
                                    value={messageConfig.subject || ''}
                                    onChange={(e) => handleChange('subject', e.target.value)}
                                    onFocus={() => setActiveField('subject')}
                                    placeholder="e.g. Unique Opportunity for [Driver Name]"
                                />
                            </FormField>
                        )}

                        <FormField label="Message Body">
                            <Textarea
                                ref={messageRef}
                                value={messageConfig.message || ''}
                                onChange={(e) => handleChange('message', e.target.value)}
                                onFocus={() => setActiveField('message')}
                                placeholder={messageConfig.method === 'sms' ? "Hey [Driver Name], we have a new lane open..." : "Dear [Driver Name]..."}
                                className="h-64 resize-none leading-relaxed"
                            />
                        </FormField>

                        {/* Variable toolbar — normal flow, wraps, never overlaps the field */}
                        <div className="flex flex-col gap-ds-2">
                            <div className="flex flex-wrap items-center justify-between gap-ds-3">
                                <div className="flex flex-wrap items-center gap-ds-2">
                                    {VARIABLES.map(v => (
                                        <Button
                                            key={v.value}
                                            variant="secondary"
                                            size="sm"
                                            aria-label={`Insert ${v.label} placeholder`}
                                            onClick={() => insertVariable(v.value)}
                                        >
                                            <Plus size={14} aria-hidden="true" /> {v.label}
                                        </Button>
                                    ))}
                                </div>
                                <p aria-live="polite" className="text-ds-xs font-bold text-ds-content-muted">
                                    <span className="sr-only">Message length: </span>{messageConfig.message?.length || 0} chars
                                </p>
                            </div>
                            <p className="text-ds-xs text-ds-content-muted">
                                Variables insert at your cursor in the active field.
                            </p>
                        </div>
                    </Card>
                </div>

                {/* Right: Preview & Tips */}
                <div className="flex flex-col gap-ds-8 lg:col-span-1">
                    {/* Device Preview */}
                    <div className="rounded-ds-xl border border-ds-border-subtle bg-ds-surface-subtle p-ds-6">
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

                    <div className="rounded-ds-xl border border-ds-status-info-border bg-ds-status-info-bg p-ds-6">
                        <h3 className="mb-ds-4 flex items-center gap-ds-2 font-bold text-ds-status-info-fg">
                            <Zap size={18} aria-hidden="true" /> Pro Tips
                        </h3>
                        <ul className="flex flex-col gap-ds-3">
                            <li className="flex gap-ds-3 text-ds-sm text-ds-status-info-fg">
                                <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                <span>Keep SMS under 160 characters to avoid splitting.</span>
                            </li>
                            <li className="flex gap-ds-3 text-ds-sm text-ds-status-info-fg">
                                <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                <span>Use <strong>[Driver Name]</strong> to increase engagement by 35%.</span>
                            </li>
                            <li className="flex gap-ds-3 text-ds-sm text-ds-status-info-fg">
                                <Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                                <span>End with a clear question to prompt a reply.</span>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
