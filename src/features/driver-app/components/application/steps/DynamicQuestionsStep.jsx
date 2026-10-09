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
 * the `handleFileUpload(key, file)` call, and the `dotRequired` DOT marker.
 *
 * DEFECTS FIXED (2026-10-09): a time question needed the phone's own dialog, which
 * can lack Set; it is three lists (`TimeSelectField`, the same `HH:MM`), checked
 * with the page before it moves on. A number box stored "1,000" as nothing; it is
 * text on the number pad now, kept as typed.
 *
 * DEFECT FIXED (2026-10-02): a file question recorded `file?.name` as its answer
 * the moment a file was chosen, without waiting for the upload and discarding the
 * storage path it returned. So the company saw a filename that nothing referenced,
 * and a failed upload still read as answered. The answer is now the uploaded file
 * itself, recorded only once the upload has landed — see `uploadAnswer`.
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

import React, { useRef, useState } from 'react';
import { Shield } from '@design-system/icons';
import DateTripletField from '@shared/components/form/DateTripletField';
import { useToast } from '@shared/components/feedback/ToastProvider';
import { StepNavigation } from './components/StepNavigation';
import TimeSelectField from './components/TimeSelectField';
import { CustomFileQuestion } from './components/CustomFileQuestion';
import {
    Badge,
    Card,
    Checkbox,
    ChoiceGroup,
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
    handleFileUpload, // Optional file upload handler from parent
    embedded = false, // The questions alone, as a Company Admin's editor shows them
}) {
    const { showError } = useToast();
    // Every file question whose upload is still on its way, by question key: the
    // share of the file sent so far, from 0 to 1. Each one's Cancel is in the ref.
    const [uploading, setUploading] = useState({});
    const uploadsRef = useRef({});
    // A file question's failed upload, by key: why, said beside the question, and
    // the file, so Try again sends it without choosing it again.
    const [uploadFailures, setUploadFailures] = useState({});
    const anyUploading = Object.keys(uploading).length > 0;
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
        // Then the page's own checks, as every step runs them: a time half chosen
        // for an optional question would otherwise go on as no answer.
        const form = document.getElementById('driver-form');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
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

    /**
     * Every write merges into the answers as they are when it is applied, never
     * as this render last saw them. An upload lands on its own schedule, and a
     * keystroke between the moment it lands and the render that shows it would
     * otherwise write back the answers without the file in them.
     */
    const handleChange = (key, value) => {
        updateFormData('customAnswers', (answers) => ({ ...(answers || {}), [key]: value }));
    };

    /**
     * A file question's answer is the uploaded file — `{ name, storagePath }`, the
     * shape every other upload on the application has — recorded only once the
     * upload has landed. It is merged into the answers as they are when it lands,
     * not as they were when the file was chosen: an upload takes a moment, and the
     * driver may answer another question meanwhile.
     *
     * While it is on its way the picker is `loading` — disabled, so a second file
     * cannot race the first and land under it — and Continue waits, as the License
     * step's does, so nothing moves on before the file has landed. Its progress
     * shows with Cancel, which gives the picker back at once; a result that lands
     * after a Cancel is not recorded.
     */
    const stopWaiting = (key, upload) => {
        if (uploadsRef.current[key] !== upload) return;
        delete uploadsRef.current[key];
        setUploading(({ [key]: _done, ...rest }) => rest);
    };
    const uploadAnswer = async (key, file) => {
        if (!file || !handleFileUpload) return;
        const upload = new AbortController();
        uploadsRef.current[key] = upload;
        setUploading((current) => ({ ...current, [key]: 0 }));
        setUploadFailures(({ [key]: _retired, ...rest }) => rest);
        try {
            const uploaded = await handleFileUpload(key, file, {
                onProgress: (sent) => {
                    if (!upload.signal.aborted) setUploading((current) => (key in current ? { ...current, [key]: sent } : current));
                },
                signal: upload.signal,
            });
            if (uploaded && !upload.signal.aborted) {
                updateFormData('customAnswers', (answers) => ({ ...(answers || {}), [key]: uploaded }));
            }
        } catch (error) {
            // Nothing is recorded: a filename with no file behind it is what used
            // to make a failed upload read as an answer. The toast that said so is
            // gone in seconds, so the reason stays beside the question.
            if (!upload.signal.aborted && error?.code !== 'cancelled') {
                setUploadFailures((current) => ({
                    ...current,
                    [key]: { file, message: error?.message || 'Upload failed. Please try again.' },
                }));
            }
        } finally {
            stopWaiting(key, upload);
        }
    };
    const cancelUpload = (key) => {
        const upload = uploadsRef.current[key];
        upload?.abort();
        stopWaiting(key, upload);
    };

    const handleCheckboxChange = (key, optValue) => {
        updateFormData('customAnswers', (answers) => {
            const current = (answers || {})[key];
            const currentArray = Array.isArray(current) ? current : [];
            const newValues = currentArray.includes(optValue)
                ? currentArray.filter(v => v !== optValue)
                : [...currentArray, optValue];
            return { ...(answers || {}), [key]: newValues };
        });
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
                    <TimeSelectField
                        label={label}
                        idPrefix={controlId}
                        name={key}
                        value={value}
                        onChange={(_, v) => handleChange(key, v)}
                        required={field.required}
                        helpText={field.helpText}
                    />
                );

            case 'number':
                return (
                    <FormField id={controlId} label={label} description={field.helpText} required={field.required}>
                        <Input
                            type="text"
                            inputMode="decimal"
                            value={value}
                            onChange={(e) => handleChange(key, e.target.value)}
                            placeholder={field.placeholder}
                        />
                    </FormField>
                );

            case 'fileUpload':
                return (
                    <CustomFileQuestion
                        id={`file-${key}`}
                        label={label}
                        description={field.helpText || 'PDF, PNG, JPG accepted'}
                        required={field.required && !value}
                        accept={field.accept || "image/*,application/pdf"}
                        value={value}
                        loading={key in uploading}
                        progress={uploading[key]}
                        failure={uploadFailures[key]}
                        onFile={(file) => uploadAnswer(key, file)}
                        onCancel={() => cancelUpload(key)}
                    />
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
            {!embedded && (
                <div>
                    <h2 className="text-ds-heading-sm font-bold text-ds-content">Additional Questions</h2>
                    <p className="text-ds-sm text-ds-content-muted">Please answer the following questions from the employer.</p>
                </div>
            )}

            {questions.map((field, index) => (
                <Card key={questionKey(field, index)} padding="md" className="space-y-ds-3">
                    {field.dotRequired && (
                        <Badge tone="warning" icon={Shield}>DOT</Badge>
                    )}
                    {renderField(field, index)}
                </Card>
            ))}

            {!embedded && (
                <StepNavigation
                    onBack={() => onNavigate('back')}
                    onContinue={handleContinue}
                    continueLabel={anyUploading ? 'Uploading...' : 'Continue'}
                    continueLoading={anyUploading}
                />
            )}
        </div>
    );
}

export default DynamicQuestionsStep;
