import React from 'react';
import {
    Plus, Type, CheckSquare, Calendar, PenTool, Mail,
    User, Building2, Fingerprint
} from 'lucide-react';

/**
 * Field palette definitions for the envelope/template creator.
 * Extracted verbatim from EnvelopeCreator.jsx.
 */

// --- FIELD TEMPLATES ---
export const FIELD_TEMPLATES = {
    // Category 1: Standard Fields
    signature: { type: 'signature', required: true, label: 'Signature', readOnly: false, prefillPolicy: 'editable', defaultValue: '', fontSize: 'Auto' },
    initial: { type: 'initial', required: true, label: 'Initial', readOnly: false, prefillPolicy: 'editable', defaultValue: '', fontSize: 'Auto' },
    date_signed: { type: 'date', required: true, readOnly: true, prefillPolicy: 'locked', bindingKey: 'current_date', defaultValue: '{{current_date}}', label: 'Date Signed', fontSize: 'Auto' },
    // Category 2: Signer Info (Auto-mapped)
    name: { type: 'text', required: true, readOnly: false, prefillPolicy: 'editable', bindingKey: 'full_name', defaultValue: '{{full_name}}', label: 'Name', fontSize: 'Auto' },
    email_field: { type: 'text', required: true, readOnly: false, prefillPolicy: 'editable', bindingKey: 'email', defaultValue: '{{email}}', label: 'Email', fontSize: 'Auto' },
    company: { type: 'text', required: false, readOnly: false, prefillPolicy: 'editable', bindingKey: 'company_name', defaultValue: '{{company_name}}', label: 'Company', fontSize: 'Auto' },
    // Category 3: Data Fields
    text: { type: 'text', required: false, readOnly: false, prefillPolicy: 'editable', label: 'Text', defaultValue: '', fontSize: 'Auto' },
    checkbox: { type: 'checkbox', required: false, label: 'Checkbox', readOnly: false, prefillPolicy: 'editable', defaultValue: '', fontSize: 'Auto' },
};

/**
 * Which design-system tone each field type reads as.
 *
 * The mapping is domain knowledge and stays here — only this feature knows that
 * a signature is a different kind of thing from a date. What that tone LOOKS
 * like is the design system's, and used to be four hand-written class lists in
 * this file; `Button`'s `tone` prop carries it now.
 *
 * Only adjacent hues were merged when these moved onto semantic tokens
 * (yellow+orange → warning, indigo+purple → accent), so the four visual groups —
 * signature-style, date, signer info and data fields — stay distinct.
 */

export const FIELD_CATEGORIES = [
    {
        title: 'Standard Fields',
        items: [
            { templateId: 'signature', label: 'Signature', icon: PenTool, tone: 'warning' },
            { templateId: 'initial', label: 'Initial', icon: Fingerprint, tone: 'warning' },
            { templateId: 'date_signed', label: 'Date Signed', icon: Calendar, tone: 'success' },
        ]
    },
    {
        title: 'Signer Info',
        items: [
            { templateId: 'name', label: 'Name', icon: User, tone: 'info' },
            { templateId: 'email_field', label: 'Email', icon: Mail, tone: 'info' },
            { templateId: 'company', label: 'Company', icon: Building2, tone: 'info' },
        ]
    },
    {
        title: 'Data Fields',
        items: [
            { templateId: 'text', label: 'Text', icon: Type, tone: 'accent' },
            { templateId: 'checkbox', label: 'Checkbox', icon: CheckSquare, tone: 'accent' },
        ]
    }
];

/** Icon for a field type — extracted from the getIcon useCallback (stable identity). */
export const getFieldIcon = (type) => {
    switch (type) {
        case 'signature': return <PenTool size={14} />;
        case 'initial': return <Fingerprint size={14} />;
        case 'text': return <Type size={14} />;
        case 'checkbox': return <CheckSquare size={14} />;
        case 'date': return <Calendar size={14} />;
        default: return <Plus size={14} />;
    }
};
