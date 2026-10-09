import React from 'react';
import { Button, FileInput, Notice } from '@/design-system/components';

/**
 * A company's own "file upload" question: the picker, the file that landed, and
 * a failed upload's reason with Try again. `DynamicQuestionsStep` owns the
 * answers and the uploads in flight; this owns how one question shows them.
 *
 * `FileInput variant="dropzone"`. This was a hand-built version of the same thing
 * under a comment saying the design system had no file-input contract, which
 * stopped being true on 2026-08-21 — and it had a real defect the primitive
 * cannot have: TWO `<label for>` elements pointed at the one input, so its
 * accessible name was the question text AND the drop-zone copy concatenated.
 * `FileInput` renders one label.
 *
 * A failure stays beside the question (the toast that said so is gone in
 * seconds), and Try again sends the same file without choosing it again. The
 * picker's value is cleared as the file is taken, so choosing the same file again
 * is a change.
 */
export function CustomFileQuestion({
    id,
    label,
    description,
    required,
    accept,
    value,
    loading,
    failure,
    onFile,
}) {
    return (
        <div className="grid gap-ds-2">
            <FileInput
                id={id}
                label={label}
                variant="dropzone"
                buttonLabel="Click to upload file"
                description={description}
                required={required}
                accept={accept}
                loading={loading}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    onFile(file);
                }}
            />
            {failure && (
                <Notice
                    announce="assertive"
                    tone="danger"
                    size="sm"
                    actions={<Button variant="secondary" size="sm" onClick={() => onFile(failure.file)}>Try again</Button>}
                >
                    {failure.message}
                </Notice>
            )}
            {value && (
                <span role="status" className="text-center text-ds-xs font-medium text-ds-status-success-fg">
                    ✓ Selected: {typeof value === 'string' ? value : value.name}
                </span>
            )}
        </div>
    );
}

export default CustomFileQuestion;
