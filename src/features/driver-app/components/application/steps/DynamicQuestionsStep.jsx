/**
 * DynamicQuestionsStep
 *
 * Renders custom questions from the merged schema.
 * Inserted as Step 8 (between General and Review) when company has custom questions.
 *
 * Supports all 9 configured field types: shortAnswer, paragraph, multipleChoice,
 * checkboxes, dropdown, date, time, fileUpload, linearScale.
 *
 * Presentation migrated to the approved `Card` / `FormField` / `Input` /
 * `Textarea` / `Select` / `Checkbox` / `Radio` / `ChoiceGroup` / `Badge`
 * primitives (2026-07-27).
 *
 * Unchanged: the `questionKey(field, index)` resolution order
 * (`field.id || field.key || custom-question-<i>`), the
 * `formData.customAnswers[key]` read with the flat `formData[key]` fallback, the
 * `customAnswers` object write, the checkbox array toggle, the per-type
 * `isEmptyAnswer` rule, the required-question gate and its exact
 * "Please answer required question: …" toast, the `linearScale` numeric coercion,
 * the `handleFileUpload(key, file)` call plus the `file?.name || ''` answer, and
 * the `dotRequired` DOT marker.
 *
 * DEFECTS FIXED (2026-07-27):
 * - Every control was unlabelled. The question text sat in a `<label>` that
 *   closed *before* the control was rendered, so no input, textarea, select,
 *   radio group or scale had an accessible name at all — the whole step was
 *   unusable with a screen reader. Each control now gets its question as a real
 *   label (or a `ChoiceGroup` legend for multi-option types).
 * - "Back" had no `type`, so inside `#driver-form` it defaulted to `submit` and
 *   triggered native validation instead of navigating back.
 * - The linear scale's endpoint captions and value numbers were the only cue for
 *   what each radio meant; each option now carries a real label naming its value
 *   and, at the ends, the endpoint wording.
 */

import React from 'react';
import { Shield, UploadCloud } from 'lucide-react';
import DateTripletField from '@shared/components/form/DateTripletField';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { StepNavigation } from './components/StepNavigation';
import {
    Badge,
    Card,
    Checkbox,
    ChoiceGroup,
    FieldMessage,
    FormField,
    Input,
    Radio,
    Select,
    Textarea,
} from '@/design-system/components';

export function DynamicQuestionsStep({
    questions = [],
    formData = {},
    updateFormData,
    onNavigate,
    handleFileUpload // Optional file upload handler from parent
}) {
    const { showError } = useToast();
    const ty = new Date().getFullYear();

    const questionKey = (field, index) =>
        field.id || field.key || `custom-question-${index}`;

    const getAnswer = (field, index) => {
        const key = questionKey(field, index);
        if (formData.customAnswers && formData.customAnswers[key] !== undefined) {
            return formData.customAnswers[key];
        }
        return formData[key];
    };

    const isEmptyAnswer = (field, value) => {
        if (field.type === 'checkboxes') {
            return !Array.isArray(value) || value.length === 0;
        }
        if (field.type === 'fileUpload') {
            return !value || (typeof value === 'string' && !value.trim());
        }
        return value === undefined || value === null || value === '';
    };

    const handleContinue = () => {
        for (let i = 0; i < questions.length; i++) {
            const field = questions[i];
            if (!field.required) continue;
            const value = getAnswer(field, i);
            if (isEmptyAnswer(field, value)) {
                showError(`Please answer required question: ${field.label || 'Additional question'}`);
                return;
            }
        }
        onNavigate('next');
    };
    if (!questions || questions.length === 0) {
        return (
            <p className="py-ds-12 text-center text-ds-content-muted">
                No additional questions for this company.
            </p>
        );
    }

    const handleChange = (key, value) => {
        const currentAnswers = formData.customAnswers || {};
        updateFormData('customAnswers', { ...currentAnswers, [key]: value });
    };

    const handleCheckboxChange = (key, optValue) => {
        const currentAnswers = formData.customAnswers || {};
        const current = currentAnswers[key] || [];
        const currentArray = Array.isArray(current) ? current : [];
        const isChecked = currentArray.includes(optValue);
        const newValues = isChecked
            ? currentArray.filter(v => v !== optValue)
            : [...currentArray, optValue];
        handleChange(key, newValues);
    };

    const optionParts = (opt) => ({
        value: typeof opt === 'string' ? opt : opt.value,
        label: typeof opt === 'string' ? opt : opt.label,
    });

    /**
     * Multi-option and single-control types need different labelling: a group
     * needs one legend and per-option labels, a single control needs one label
     * bound to it. `renderField` therefore returns the whole labelled field.
     */
    const renderField = (field, index) => {
        const key = questionKey(field, index);
        const value = getAnswer(field, index) || '';
        const controlId = `custom-q-${key}`;
        const label = field.label || 'Additional question';

        switch (field.type) {
            case 'paragraph':
            case 'textarea':
                return (
                    <FormField id={controlId} label={label} description={field.helpText} required={field.required}>
                        <Textarea
                            rows={4}
                            value={value}
                            onChange={(e) => handleChange(key, e.target.value)}
                            placeholder={field.placeholder || 'Enter your response...'}
                        />
                    </FormField>
                );

            case 'multipleChoice':
            case 'radio':
                return (
                    <ChoiceGroup legend={label} description={field.helpText} required={field.required}>
                        {(field.options || []).map((opt, i) => {
                            const { value: optValue, label: optLabel } = optionParts(opt);
                            return (
                                <Radio
                                    key={i}
                                    id={`${controlId}-option-${i}`}
                                    name={key}
                                    value={optValue}
                                    label={optLabel}
                                    checked={value === optValue}
                                    onChange={() => handleChange(key, optValue)}
                                    required={field.required}
                                    requiredMark={false}
                                />
                            );
                        })}
                    </ChoiceGroup>
                );

            case 'checkboxes': {
                const checkedValues = Array.isArray(value) ? value : [];
                return (
                    <ChoiceGroup legend={label} description={field.helpText} required={field.required}>
                        {(field.options || []).map((opt, i) => {
                            const { value: optValue, label: optLabel } = optionParts(opt);
                            return (
                                <Checkbox
                                    key={i}
                                    id={`${controlId}-option-${i}`}
                                    value={optValue}
                                    label={optLabel}
                                    checked={checkedValues.includes(optValue)}
                                    onChange={() => handleCheckboxChange(key, optValue)}
                                />
                            );
                        })}
                    </ChoiceGroup>
                );
            }

            case 'dropdown':
            case 'select':
                return (
                    <FormField id={controlId} label={label} description={field.helpText} required={field.required}>
                        <Select value={value} onChange={(e) => handleChange(key, e.target.value)}>
                            <option value="">Select an option...</option>
                            {(field.options || []).map((opt, i) => {
                                const { value: optValue, label: optLabel } = optionParts(opt);
                                return <option key={i} value={optValue}>{optLabel}</option>;
                            })}
                        </Select>
                    </FormField>
                );

            case 'date':
                return (
                    <DateTripletField
                        label={label}
                        idPrefix={controlId}
                        name={key}
                        value={value}
                        onChange={(_, v) => handleChange(key, v)}
                        required={field.required}
                        maxToday={false}
                        minYear={ty - 100}
                        maxYear={ty + 25}
                        helpText={field.helpText || 'Month / Day / Year.'}
                    />
                );

            case 'time':
                return (
                    <FormField id={controlId} label={label} description={field.helpText} required={field.required}>
                        <Input
                            type="time"
                            value={value}
                            onChange={(e) => handleChange(key, e.target.value)}
                        />
                    </FormField>
                );

            case 'number':
                return (
                    <FormField id={controlId} label={label} description={field.helpText} required={field.required}>
                        <Input
                            type="number"
                            value={value}
                            onChange={(e) => handleChange(key, e.target.value)}
                            placeholder={field.placeholder}
                        />
                    </FormField>
                );

            case 'fileUpload':
                return (
                    <div className="grid gap-ds-2">
                        <label htmlFor={`file-${key}`} className="ds-label">
                            <span>{label}</span>
                            {field.required && (
                                <>
                                    <span className="ds-label__required-mark" aria-hidden="true">*</span>
                                    <span className="ds-visually-hidden"> required</span>
                                </>
                            )}
                        </label>
                        {field.helpText && <FieldMessage tone="help">{field.helpText}</FieldMessage>}
                        {/* DOCUMENTED EXCEPTION — label-wrapped file input.
                            The design system has no approved file-input contract yet
                            (Phase 4 records it as open). A native `<input type=file>`
                            triggered by its own `<label>` is keyboard-reachable and
                            correctly named, so no local button is introduced. */}
                        <input
                            type="file"
                            id={`file-${key}`}
                            className="ds-visually-hidden"
                            required={field.required && !value}
                            accept={field.accept || "image/*,application/pdf"}
                            onChange={(e) => {
                                const file = e.target.files[0];
                                if (file && handleFileUpload) {
                                    handleFileUpload(key, file);
                                }
                                handleChange(key, file?.name || '');
                            }}
                        />
                        <label
                            htmlFor={`file-${key}`}
                            className="flex cursor-pointer flex-col items-center rounded-ds-md border-2 border-dashed border-ds-border bg-ds-surface-subtle p-ds-6 text-center hover:border-ds-focus"
                        >
                            <UploadCloud size={28} className="mb-ds-2 text-ds-action-primary" aria-hidden="true" />
                            <span className="text-ds-sm font-medium text-ds-content-link">Click to upload file</span>
                            <span className="mt-ds-1 text-ds-xs text-ds-content-secondary">PDF, PNG, JPG accepted</span>
                            {value && (
                                <span role="status" className="mt-ds-2 text-ds-xs font-medium text-ds-status-success-fg">
                                    ✓ Selected: {typeof value === 'string' ? value : value.name}
                                </span>
                            )}
                        </label>
                    </div>
                );

            case 'linearScale': {
                const min = field.min || 1;
                const max = field.max || 5;
                const minLabel = field.minLabel || 'Poor';
                const maxLabel = field.maxLabel || 'Excellent';
                const scaleValues = Array.from({ length: max - min + 1 }, (_, i) => min + i);
                return (
                    <ChoiceGroup
                        legend={label}
                        description={field.helpText || `${min} = ${minLabel}, ${max} = ${maxLabel}`}
                        required={field.required}
                        orientation="horizontal"
                    >
                        {scaleValues.map((val) => (
                            <Radio
                                key={val}
                                id={`${controlId}-scale-${val}`}
                                name={key}
                                value={val}
                                label={
                                    val === min ? `${val} — ${minLabel}`
                                        : val === max ? `${val} — ${maxLabel}`
                                            : String(val)
                                }
                                checked={Number(value) === val}
                                onChange={(e) => handleChange(key, Number(e.target.value))}
                                required={field.required}
                                requiredMark={false}
                            />
                        ))}
                    </ChoiceGroup>
                );
            }

            default: // shortAnswer, text
                return (
                    <FormField id={controlId} label={label} description={field.helpText} required={field.required}>
                        <Input
                            type="text"
                            value={value}
                            onChange={(e) => handleChange(key, e.target.value)}
                            placeholder={field.placeholder || 'Enter your response...'}
                        />
                    </FormField>
                );
        }
    };

    return (
        <div className="space-y-ds-6">
            <div>
                <h2 className="text-ds-heading-sm font-bold text-ds-content">Additional Questions</h2>
                <p className="text-ds-sm text-ds-content-muted">Please answer the following questions from the employer.</p>
            </div>

            {questions.map((field, index) => (
                <Card key={questionKey(field, index)} padding="md" className="space-y-ds-3">
                    {field.dotRequired && (
                        <Badge tone="warning" icon={Shield}>DOT</Badge>
                    )}
                    {renderField(field, index)}
                </Card>
            ))}

            {/* Navigation */}
            <StepNavigation
                onBack={() => onNavigate('back')}
                onContinue={handleContinue}
            />
        </div>
    );
}

export default DynamicQuestionsStep;
