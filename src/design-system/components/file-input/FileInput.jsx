import React, { forwardRef, useId } from 'react';
import { Upload } from 'lucide-react';
import './FileInput.css';

/**
 * The approved file-picker contract.
 *
 * Four places were feature-owned for want of one — `DQFileTab`,
 * `BulkUploadLayout`, the public application's upload and the PEV result
 * upload — and between them they had three different ways of opening a picker,
 * two of which were a `<div onClick>` driving a `display: none` input. That
 * shape is unreachable by keyboard and announces nothing.
 *
 * ## The one structural rule
 *
 * A **real `<input type="file">`**, visually hidden but still focusable, with a
 * `<label>` styled as the visible control. Not `display: none`, which removes
 * the input from the tab order and takes the picker with it. Not a `<button>`
 * that calls `.click()` on a hidden input, which works with a mouse and leaves
 * the accessible name on the wrong element.
 *
 * With a real input and a real label: Tab reaches it, Space and Enter open the
 * picker, the label is its accessible name, and the browser's own
 * file-type validation and drag-and-drop target come for free.
 *
 * ## What this is not
 *
 * It is a *picker*, not an uploader. Progress, retry, preview, size limits and
 * the upload itself stay with the feature — the public application's
 * `UploadField` composes exactly this and owns all of that around it.
 */
export const FileInput = forwardRef(function FileInput({
  label,
  description,
  accept,
  multiple = false,
  disabled = false,
  onChange,
  id,
  buttonLabel = 'Choose file',
  className = '',
  ...props
}, ref) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('FileInput requires a non-empty label naming what is being uploaded.');
  }

  const generatedId = useId().replace(/:/g, '');
  const inputId = id || `ds-file-input-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;

  return (
    <div className={`ds-file-input ${className}`.trim()}>
      <span className="ds-file-input__label" id={`${inputId}-label`}>{label}</span>
      {description && (
        <span className="ds-file-input__description" id={descriptionId}>{description}</span>
      )}
      {/*
        The label is the visible control and the input's accessible name.
        `aria-describedby` carries the accepted types, so a screen-reader user
        hears the constraint before opening the picker rather than discovering
        it from a rejection afterwards.
      */}
      <label className="ds-file-input__control" htmlFor={inputId} data-disabled={disabled || undefined}>
        <Upload aria-hidden="true" />
        <span>{buttonLabel}</span>
        <input
          {...props}
          ref={ref}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={onChange}
          aria-describedby={descriptionId}
          className="ds-file-input__native"
        />
      </label>
    </div>
  );
});
