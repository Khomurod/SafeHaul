import React from 'react';
import { Button, FieldMessage, FileInput, Notice } from '@/design-system/components';
import { UploadProgress } from '../../UploadProgress';

/**
 * A company's own "file upload" question: the picker, the file that landed, and
 * a failed upload's reason with Try again. `DynamicQuestionsStep` owns the
 * answers and the uploads in flight; this owns how one question shows them.
 *
 * `FileInput variant="dropzone"`, never a hand-built picker: `FileInput` renders
 * one label, so the input's accessible name is the question text alone — two
 * `<label for>` elements on one input concatenate the question and the drop-zone
 * copy.
 *
 * While the file is on its way the picker is busy, and the bytes sent so far
 * show with Cancel, as on the License page: a stalled upload is not a minute of
 * waiting with no way out. A failure stays beside the question (the toast that
 * said so is gone in seconds), and Try again sends the same file without choosing
 * it again. The picker's value is cleared as the file is taken, so choosing the
 * same file again is a change.
 *
 * `error` is the page's message about the question, such as a required file not
 * given when Continue was pressed: said under the picker, announced, and
 * describing it.
 */
export function CustomFileQuestion({
    id,
    label,
    description,
    required,
    accept,
    value,
    loading,
    progress = 0,
    failure,
    error,
    onFile,
    onCancel,
}) {
    const errorId = `${id}-answer-error`;
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
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    onFile(file);
                }}
            />
            {error && <FieldMessage id={errorId} tone="error">{error}</FieldMessage>}
            {loading && (
                <UploadProgress label={label} percent={progress * 100} onCancel={onCancel} announce={false} />
            )}
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
