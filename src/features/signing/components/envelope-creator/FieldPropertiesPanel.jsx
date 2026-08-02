import React from 'react';
import { Lock } from 'lucide-react';
import { FormField, Input, Select, Textarea } from '@/design-system/components';

/** Field types that carry no text content, so they expose no prefill/default/format options. */
const CONTENT_LESS_TYPES = new Set(['signature', 'initial', 'checkbox']);

/**
 * Field properties panel (right sidebar) — extracted verbatim from EnvelopeCreator.jsx.
 *
 * Presentation only. Every value and every `updateActiveField` call — including
 * the paired writes that keep `readOnly` and `prefillPolicy` in sync — is
 * unchanged; this component owns no state and performs no I/O. Field geometry,
 * drag/resize, the PDF workbench, Firebase, Storage and rules are untouched.
 *
 * Accessibility: the two option toggles were icon-only `<button>`s nested inside
 * `<label>`s, so they had no accessible name and put an interactive control
 * inside a label. They are now native checkboxes with visible associated labels
 * — keyboard-operable by construction, and state is conveyed by the control
 * itself rather than icon colour.
 */
export const FieldPropertiesPanel = React.memo(({ activeField, updateActiveField, getIcon }) => {
    if (!activeField) return null;

    const hasTextOptions = !CONTENT_LESS_TYPES.has(activeField.type);

    return (
        <div className="flex h-full flex-col">
            {/* Header */}
            <div className="border-b border-ds-border-subtle bg-ds-surface-subtle p-ds-4">
                <div className="mb-ds-3 flex items-center gap-ds-2">
                    <span aria-hidden="true" className="rounded-ds-md border border-ds-border-subtle bg-ds-surface p-1.5 shadow-ds-xs">
                        {getIcon(activeField.type)}
                    </span>
                    <span className="text-ds-xs font-bold uppercase text-ds-content-secondary">{activeField.type} Field</span>
                </div>
                <FormField label="Field Label">
                    <Input
                        type="text"
                        value={activeField.label || ''}
                        onChange={(e) => updateActiveField('label', e.target.value)}
                        placeholder="Field Label"
                    />
                </FormField>
            </div>

            {/* Toggles */}
            <div className="flex flex-col gap-ds-3 border-b border-ds-border-subtle p-ds-4">
                <h4 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Options</h4>
                <label className="inline-flex min-h-11 cursor-pointer select-none items-center gap-ds-2 text-ds-sm font-medium text-ds-content">
                    <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-ds-action-primary focus-visible:outline-none focus-visible:shadow-ds-focus"
                        checked={Boolean(activeField.required)}
                        onChange={() => updateActiveField('required', !activeField.required)}
                    />
                    <span>Required Field</span>
                </label>
                <label className="inline-flex min-h-11 cursor-pointer select-none items-center gap-ds-2 text-ds-sm font-medium text-ds-content">
                    <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-ds-action-primary focus-visible:outline-none focus-visible:shadow-ds-focus"
                        checked={Boolean(activeField.readOnly)}
                        onChange={() => {
                            const nextReadOnly = !activeField.readOnly;
                            updateActiveField('readOnly', nextReadOnly);
                            updateActiveField('prefillPolicy', nextReadOnly ? 'locked' : 'editable');
                        }}
                    />
                    <Lock size={12} className="text-ds-content-muted" aria-hidden="true" />
                    <span>Read Only</span>
                </label>

                {hasTextOptions && (
                    <FormField label="Prefill Behavior">
                        <Select
                            value={activeField.prefillPolicy || (activeField.readOnly ? 'locked' : 'editable')}
                            onChange={(e) => {
                                const mode = e.target.value;
                                updateActiveField('prefillPolicy', mode);
                                updateActiveField('readOnly', mode === 'locked');
                            }}
                        >
                            <option value="editable">Editable when prefilled</option>
                            <option value="locked">Locked after prefill</option>
                        </Select>
                    </FormField>
                )}
            </div>

            {/* Default Value */}
            {hasTextOptions && (
                <div className="flex flex-col gap-ds-2 border-b border-ds-border-subtle p-ds-4">
                    <h4 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Default Value</h4>
                    <FormField label="Default value">
                        <Textarea
                            value={activeField.defaultValue || ''}
                            onChange={(e) => updateActiveField('defaultValue', e.target.value)}
                            rows={3}
                            placeholder="Enter default value..."
                            className="resize-none"
                        />
                    </FormField>
                    <p className="text-ds-xs leading-relaxed text-ds-content-secondary">
                        Use tokens like <code className="rounded-ds-sm bg-ds-surface-subtle px-1 text-ds-content">{"{{full_name}}"}</code>,{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-1 text-ds-content">{"{{email}}"}</code>,{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-1 text-ds-content">{"{{phone}}"}</code>,{' '}
                        <code className="rounded-ds-sm bg-ds-surface-subtle px-1 text-ds-content">{"{{current_date}}"}</code>.
                    </p>
                </div>
            )}

            {/* Font Size */}
            {hasTextOptions && (
                <div className="flex flex-col gap-ds-2 p-ds-4">
                    <h4 className="text-ds-xs font-bold uppercase tracking-wide text-ds-content-secondary">Formatting</h4>
                    <FormField label="Font Size">
                        <Select
                            value={activeField.fontSize || 'Auto'}
                            onChange={(e) => updateActiveField('fontSize', e.target.value)}
                        >
                            <option value="Auto">Auto (fit to box)</option>
                            <option value="10">10pt</option>
                            <option value="12">12pt</option>
                            <option value="14">14pt</option>
                            <option value="18">18pt</option>
                        </Select>
                    </FormField>
                </div>
            )}
        </div>
    );
});

export default FieldPropertiesPanel;
