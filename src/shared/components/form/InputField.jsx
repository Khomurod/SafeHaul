import React from 'react';
import { FieldMessage, Input, Label } from '@/design-system/components';

/**
 * Compatibility adapter over the approved `Label` / `Input` / `FieldMessage`
 * primitives.
 *
 * It is not built on `FormField` because two behaviours here are outside that
 * primitive's string-label contract and must be preserved exactly:
 *
 * 1. `label` may carry the inline file-status suffix ("(Uploaded: cdl.pdf)")
 *    for `type="file"` call sites.
 * 2. `type="file"` must never receive a `value` prop, so re-uploading the same
 *    file keeps working.
 *
 * Frozen contracts: the `(name, value)` `onChange`/`onBlur` shape (the File
 * object or `null` for file inputs), the `${id || name}-error` error id, the
 * `role="alert"` error announcement, and `aria-required` / `aria-invalid` /
 * `aria-describedby` wiring — all covered by `src/tests/InputField.test.jsx`,
 * `src/tests/a11y/primitives.a11y.test.jsx` and the field-validation
 * integration tests.
 */
const InputField = ({ label, id, name, type = 'text', value, onChange, onBlur, required = false, placeholder, className = "", error }) => {
    const isFile = type === 'file';
    // C2: associate the error message with the input for assistive tech.
    const errorId = error ? `${id || name}-error` : undefined;

    const handleChange = (e) => {
        if (isFile) {
            // Special handling for files: always send the File object or null/undefined
            // Note: The onChange prop for file inputs should now be the handleFileUpload function from useFormLogic
            onChange(name, e.target.files[0] || null);
        } else {
            onChange(name, e.target.value);
        }
    };

    // C5 foundation: optional on-blur passthrough (same (name, value) shape as onChange)
    // so callers can validate a field once the user leaves it. No-op when not provided,
    // so existing call sites are unaffected.
    const handleBlur = onBlur
        ? (e) => onBlur(name, isFile ? (e.target.files?.[0] || null) : e.target.value)
        : undefined;

    // Determine the current file status for display
    let fileStatusText = '';
    let isFileUploaded = false;
    if (isFile && value) {
        if (value instanceof File) {
            fileStatusText = `Selected: ${value.name}`;
            // Or could show 'Ready for upload'
        } else if (value.name) {
            // Assume it's the { url, name } object from a loaded draft or successful upload
            fileStatusText = `Uploaded: ${value.name}`;
            isFileUploaded = true;
        }
    }

    // The design system has no approved file-input contract yet (Phase 4 records
    // it as open), so the native file-picker button styling stays local here.
    const fileClasses = 'file:mr-ds-4 file:py-ds-2 file:px-ds-4 file:rounded-ds-md file:border-0 file:text-ds-sm file:font-semibold file:bg-ds-status-info-bg file:text-ds-status-info-fg';

    // For file inputs, we don't pass the 'value' prop to prevent React issues and allow re-uploads.
    const fileInputProps = isFile ? {
        // Important: leave value undefined for type="file"
    } : {
        value: value || ""
    };

    return (
        <div className="grid gap-ds-2 min-w-0">
            <Label htmlFor={id} required={required}>
                {label}
                {isFile && fileStatusText && (
                    <span className={`font-normal text-ds-xs ${isFileUploaded ? 'text-ds-status-success-fg' : 'text-ds-status-info-fg'}`}>
                        ({fileStatusText})
                    </span>
                )}
            </Label>
            <Input
                type={type}
                id={id}
                name={name}
                onChange={handleChange}
                onBlur={handleBlur}
                required={required}
                placeholder={placeholder}
                // C2: WCAG 2.1 AA — programmatically expose required/invalid state and the
                // associated error message so screen readers announce them.
                aria-required={required || undefined}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                className={`${className} ${isFile ? fileClasses : ''}`.trim()}
                {...fileInputProps}
            />
            {error && (
                <FieldMessage id={errorId} tone="error">
                    {error}
                </FieldMessage>
            )}
        </div>
    );
};

export default InputField;
