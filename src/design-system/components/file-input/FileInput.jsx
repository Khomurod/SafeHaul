import React, { forwardRef, useId } from 'react';
import { Loader2, Upload } from 'lucide-react';
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
 *
 * ## Two shapes, `loading` and `labelHidden` (2026-08-25)
 *
 * Four days after this component shipped it had two consumers, and nine raw
 * `<input type="file">` controls were still in the tree, every one of them
 * carrying a comment that said "the design system has no approved file-input
 * contract yet". Migrating them is what showed why: the contract existed but the
 * API covered one of the product's three real shapes.
 *
 * - `variant="dropzone"` is the full-width dashed panel that four uploads use.
 *   As a `<label>` it is better than what it replaces in two ways nobody has to
 *   remember: the whole panel is the click target *and* the browser's own
 *   drag-and-drop target, without a single event handler.
 * - `loading` is what the avatar and company-logo pickers needed. Both used
 *   `Button loading` plus a hidden input, because an upload picker is exactly the
 *   control that has to say it is busy.
 * - `labelHidden` is for a picker whose field is already named on screen — a
 *   photo preview beside it — matching `Checkbox`'s prop of the same name. The
 *   name stays in the accessibility tree either way.
 */
const VARIANTS = new Set(['button', 'dropzone']);

export const FileInput = forwardRef(function FileInput({
  label,
  labelHidden = false,
  description,
  accept,
  multiple = false,
  disabled = false,
  loading = false,
  variant = 'button',
  onChange,
  id,
  buttonLabel = 'Choose file',
  className = '',
  'aria-describedby': callerDescribedBy,
  ...props
}, ref) {
  if (typeof label !== 'string' || label.trim() === '') {
    throw new TypeError('FileInput requires a non-empty label naming what is being uploaded.');
  }
  if (!VARIANTS.has(variant)) {
    throw new TypeError(`Unsupported FileInput variant: ${variant}`);
  }

  const generatedId = useId().replace(/:/g, '');
  const inputId = id || `ds-file-input-${generatedId}`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  /*
   * A caller's `aria-describedby` is ADDED to ours, not replaced by it.
   *
   * This used to be `aria-describedby={descriptionId}` after a `{...props}`
   * spread, so a caller passing its own help-text id had it silently dropped —
   * found by migrating the profile-photo picker, whose "Accepts image files under
   * 2 MB" message stopped being announced. Silently discarding an accessibility
   * attribute a caller asked for is the worst kind of override, because
   * everything still looks right.
   */
  const describedBy = [descriptionId, callerDescribedBy].filter(Boolean).join(' ') || undefined;

  const labelId = `${inputId}-label`;
  // `loading` implies the picker cannot be used, exactly as it does on `Button`.
  // Leaving it enabled would let a second file be chosen while the first is
  // still uploading, which is the defect the two hand-built pickers avoided by
  // disabling their trigger.
  const inert = disabled || loading;

  /*
   * The dropzone puts the description INSIDE the panel, because that is where
   * the accepted types belong when the panel is the whole control. The button
   * variant puts it above, next to the field label, like every other field's
   * help text. Either way the same element is the input's `aria-describedby`.
   */
  const showDescriptionAbove = Boolean(description) && variant !== 'dropzone';

  return (
    <div className={`ds-file-input ${className}`.trim()} data-variant={variant}>
      <span
        className={labelHidden ? 'ds-visually-hidden' : 'ds-file-input__label'}
        id={labelId}
      >
        {label}
      </span>
      {showDescriptionAbove && (
        <span className="ds-file-input__description" id={descriptionId}>{description}</span>
      )}
      {/*
        `aria-labelledby` points at the field label, not at the button text.
        Without it the `<label>` wrapping the input would supply the name, and
        the input would announce as "Choose a file" — the affordance rather than
        the field. Every other control in the system announces as its field, and
        a test looking for the field by its label would not find this one.
        (Found by migrating a real upload control onto it, whose tests did
        exactly that.)

        `aria-describedby` carries the accepted types, so a screen-reader user
        hears the constraint before opening the picker rather than discovering it
        from a rejection afterwards.
      */}
      <label
        className="ds-file-input__control"
        htmlFor={inputId}
        data-disabled={inert || undefined}
        data-loading={loading || undefined}
      >
        {loading
          ? <Loader2 className="ds-file-input__spinner" aria-hidden="true" />
          : <Upload aria-hidden="true" />}
        <span className="ds-file-input__button-label">{buttonLabel}</span>
        {variant === 'dropzone' && description && (
          <span className="ds-file-input__description" id={descriptionId}>{description}</span>
        )}
        <input
          {...props}
          ref={ref}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={inert}
          onChange={onChange}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-busy={loading || undefined}
          className="ds-file-input__native"
        />
      </label>
    </div>
  );
});
