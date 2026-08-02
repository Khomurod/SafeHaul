import React, { useId } from 'react';
import {
    Trash2, Plus, X, Shield, Lock, AlertTriangle, ChevronUp, ChevronDown, GripVertical,
} from 'lucide-react';
import {
    Button,
    IconButton,
    FormField,
    Input,
    Select,
} from '@/design-system/components';
import { QUESTION_TYPES, hasOptions } from './QuestionConfig';
import { ToggleSwitch } from './ToggleSwitch';

export function QuestionEditor({
    question,
    index,
    onChange,
    onDelete,
    onMoveUp,
    onMoveDown,
    canMoveUp = false,
    canMoveDown = false,
    dragHandleProps = {},
}) {
    const rawId = useId().replace(/:/g, '');
    const groupLabel = `Question ${index + 1}`;
    const number = index + 1;

    const handleChange = (field, value) => {
        onChange(index, { ...question, [field]: value });
    };

    const handleOptionChange = (optIndex, value) => {
        const newOptions = [...(question.options || [])];
        newOptions[optIndex] = value;
        handleChange('options', newOptions);
    };

    const addOption = () => {
        const newOptions = [...(question.options || []), `Option ${(question.options?.length || 0) + 1}`];
        handleChange('options', newOptions);
    };

    const removeOption = (optIndex) => {
        const newOptions = question.options.filter((_, i) => i !== optIndex);
        handleChange('options', newOptions);
    };

    const handleTypeChange = (e) => {
        const newType = e.target.value;
        const updates = { type: newType };

        if (hasOptions(newType) && (!question.options || question.options.length === 0)) {
            updates.options = ['Option 1'];
        }

        onChange(index, { ...question, ...updates });
    };

    const TypeIcon = QUESTION_TYPES.find(t => t.id === question.type)?.icon;

    return (
        <div
            role="group"
            aria-label={groupLabel}
            className="rounded-ds-xl border border-l-4 border-ds-border border-l-ds-action-primary bg-ds-surface p-ds-5 shadow-ds-xs"
        >
            <div className="mb-ds-4 flex items-start gap-ds-3">
                {/* Reorder controls: keyboard-accessible move up/down + drag handle. */}
                <div className="flex flex-col items-center gap-ds-1 pt-ds-1">
                    <IconButton
                        label={`Move question ${number} up`}
                        size="sm"
                        variant="ghost"
                        disabled={!canMoveUp}
                        onClick={() => onMoveUp?.(index)}
                    >
                        <ChevronUp size={16} aria-hidden="true" />
                    </IconButton>
                    <span className="text-ds-content-muted" {...dragHandleProps} aria-hidden="true">
                        <GripVertical size={16} />
                    </span>
                    <IconButton
                        label={`Move question ${number} down`}
                        size="sm"
                        variant="ghost"
                        disabled={!canMoveDown}
                        onClick={() => onMoveDown?.(index)}
                    >
                        <ChevronDown size={16} aria-hidden="true" />
                    </IconButton>
                </div>

                <div className="grid min-w-0 flex-1 grid-cols-1 gap-ds-4 md:grid-cols-3">
                    <div className="md:col-span-2">
                        <FormField id={`q-${rawId}-label`} label={`Question ${number} title`}>
                            <Input
                                type="text"
                                placeholder="Question Title"
                                value={question.label}
                                onChange={(e) => handleChange('label', e.target.value)}
                            />
                        </FormField>
                    </div>

                    <FormField id={`q-${rawId}-type`} label={`Question ${number} answer type`}>
                        <Select value={question.type} onChange={handleTypeChange}>
                            {QUESTION_TYPES.map(type => (
                                <option key={type.id} value={type.id}>
                                    {type.label}
                                </option>
                            ))}
                        </Select>
                    </FormField>
                </div>

                <div className="pt-ds-1">
                    <IconButton
                        label={`Delete question ${number}`}
                        size="sm"
                        variant="ghost"
                        onClick={() => onDelete(index)}
                    >
                        <Trash2 size={18} aria-hidden="true" />
                    </IconButton>
                </div>
            </div>

            <div className="space-y-ds-4 md:pl-[3.25rem]">
                <FormField id={`q-${rawId}-help`} label={`Question ${number} description (optional)`}>
                    <Input
                        type="text"
                        placeholder="Description (optional)"
                        value={question.helpText || ''}
                        onChange={(e) => handleChange('helpText', e.target.value)}
                    />
                </FormField>

                {hasOptions(question.type) && (
                    <fieldset className="space-y-ds-2 border-l-2 border-ds-border-subtle pl-ds-4">
                        <legend className="text-ds-sm font-semibold text-ds-content">Answer options</legend>
                        {question.options?.map((opt, i) => (
                            <div key={i} className="flex items-center gap-ds-3">
                                {TypeIcon && <TypeIcon size={16} className="shrink-0 text-ds-content-muted" aria-hidden="true" />}
                                <Input
                                    type="text"
                                    aria-label={`Question ${number} option ${i + 1}`}
                                    value={opt}
                                    onChange={(e) => handleOptionChange(i, e.target.value)}
                                    placeholder={`Option ${i + 1}`}
                                />
                                <IconButton
                                    label={`Remove option ${i + 1} from question ${number}`}
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => removeOption(i)}
                                >
                                    <X size={16} aria-hidden="true" />
                                </IconButton>
                            </div>
                        ))}
                        <Button variant="ghost" size="sm" onClick={addOption}>
                            <Plus size={16} aria-hidden="true" /> Add Option
                        </Button>
                    </fieldset>
                )}

                {question.type === 'fileUpload' && (
                    <div className="rounded-ds-lg border-2 border-dashed border-ds-border-subtle bg-ds-surface-subtle p-ds-6 text-center text-ds-sm text-ds-content-muted">
                        <p>Applicants will see a file upload button here.</p>
                    </div>
                )}

                {/* DOT/FMCSA Compliance Section */}
                <div className="space-y-ds-3 border-t border-ds-border-subtle pt-ds-4">
                    <div className="flex items-center gap-ds-2">
                        <Shield size={16} className="text-ds-status-warning-fg" aria-hidden="true" />
                        <span className="text-ds-xs font-semibold uppercase tracking-wide text-ds-content-muted">
                            Compliance Settings
                        </span>
                    </div>

                    <div className="grid grid-cols-1 gap-ds-4 md:grid-cols-2">
                        <label className="flex cursor-pointer items-center gap-ds-3 rounded-ds-lg border border-ds-border p-ds-3">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded accent-ds-status-warning-fg focus-visible:shadow-ds-focus"
                                checked={question.dotRequired || false}
                                onChange={(e) => handleChange('dotRequired', e.target.checked)}
                            />
                            <span className="flex items-center gap-ds-2">
                                <Shield
                                    size={14}
                                    className={question.dotRequired ? 'text-ds-status-warning-fg' : 'text-ds-content-muted'}
                                    aria-hidden="true"
                                />
                                <span className="text-ds-sm font-medium text-ds-content">DOT Required</span>
                            </span>
                        </label>

                        {question.dotRequired && (
                            <FormField id={`q-${rawId}-fmcsa`} label={`Question ${number} FMCSA reference`}>
                                <Input
                                    type="text"
                                    placeholder="FMCSA Reference (e.g., 49 CFR 391.21)"
                                    value={question.fmcsaReference || ''}
                                    onChange={(e) => handleChange('fmcsaReference', e.target.value)}
                                />
                            </FormField>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-ds-4 pt-ds-1">
                        <label className="flex cursor-pointer select-none items-center gap-ds-2">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded accent-ds-action-primary focus-visible:shadow-ds-focus"
                                checked={!(question.canCompanyHide ?? true)}
                                onChange={(e) => handleChange('canCompanyHide', !e.target.checked)}
                            />
                            <Lock size={14} className="text-ds-content-muted" aria-hidden="true" />
                            <span className="text-ds-sm text-ds-content-secondary">Lock (companies can't hide)</span>
                        </label>

                        <label className="flex cursor-pointer select-none items-center gap-ds-2">
                            <input
                                type="checkbox"
                                className="h-4 w-4 rounded accent-ds-action-primary focus-visible:shadow-ds-focus"
                                checked={!(question.canCompanyModify ?? true)}
                                onChange={(e) => handleChange('canCompanyModify', !e.target.checked)}
                            />
                            <AlertTriangle size={14} className="text-ds-content-muted" aria-hidden="true" />
                            <span className="text-ds-sm text-ds-content-secondary">Protect label (read-only)</span>
                        </label>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-ds-3 border-t border-ds-border-subtle pt-ds-4">
                    <span className="text-ds-sm font-medium text-ds-content-secondary" aria-hidden="true">
                        Required
                    </span>
                    <ToggleSwitch
                        checked={question.required || false}
                        label="Required"
                        onChange={(next) => handleChange('required', next)}
                    />
                </div>
            </div>
        </div>
    );
}
