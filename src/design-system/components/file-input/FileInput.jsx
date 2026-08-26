import React, { forwardRef, useCallback, useEffect, useId, useRef } from 'react';
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
 * file-type validation come for free; dropped files are handled explicitly.
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
 *   As a `<label>` the whole panel is the click target, and `onDrop` below makes
 *   it a real drop target. An earlier version of this line claimed the label gave
 *   the second one "without a single event handler" — it does not, a label
 *   forwards clicks and not drops, and the panels ignored dropped files until
 *   2026-08-25. See `handleDrop`.
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
   * `loading` disables the input, and disabling the element that currently has
   * focus drops focus to `<body>` — so an upload started from the keyboard ended
   * with the user at the top of the document once it finished. The two pickers
   * this component replaced each had their own focus-return effect for exactly
   * this; deleting them without putting the behaviour here is what a review of
   * 2026-08-25 caught.
   *
   * It belongs in the primitive rather than at each call site: `loading` is this
   * component's prop, so this is this component's consequence.
   *
   * The flag is set on `change`, which is the only moment the input is
   * *certainly* focused — the change event comes from it. Restoring is then
   * conditional on nothing meaningful holding focus: never steal it back from
   * wherever the user moved while the upload was in flight.
   */
  const inputRef = useRef(null);
  const restoreFocusOnIdle = useRef(false);

  const mergeRef = useCallback((node) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const handleChange = useCallback((event) => {
    restoreFocusOnIdle.current = true;
    onChange?.(event);
  }, [onChange]);

  /*
   * Dropped files, routed through the real input.
   *
   * This used to claim the `<label>` made the panel "the browser's own
   * drag-and-drop target ... without a single event handler". That was wrong, and
   * a review of this branch caught it: a `<label>` forwards *activation* to the
   * control it labels — a click — and a drop is not activation. The input itself
   * is a drop target, but it is clipped to 1x1, so a drop on the panel landed on
   * the label or one of its spans and nothing happened. Four upload panels wore a
   * dashed dropzone border and silently ignored what was dropped on them.
   *
   * The fix assigns the dropped `FileList` to the input and dispatches `change`
   * from it, rather than calling `onChange` with a hand-made object. That matters
   * for consumers: every one of them reads `event.target.files`, and this way the
   * event they get is a real `change` from the real input with real files on it,
   * so nothing at any call site had to change. Both halves were measured in
   * Chromium before being relied on — `input.files` is assignable from a
   * script-built `DataTransfer`, and a dispatched bubbling `change` reaches
   * listeners with the files already in place.
   *
   * `dragover` must preventDefault or the browser refuses the drop; that is the
   * whole reason the handler pair exists rather than just `onDrop`.
   *
   * ## Both handlers cancel the event FIRST, disabled or not
   *
   * The first version of this returned early when `inert || loading`, before
   * calling `preventDefault`. That handed the drop back to the browser, whose
   * default action for a dropped file is to navigate to it — so dropping a second
   * file onto a panel that was mid-upload could replace the page and discard a
   * half-filled form. On the public driver application that is somebody's work
   * gone, which makes it the most expensive thing a disabled control could do.
   *
   * Found in review on 2026-08-25. The rule is: cancelling the browser's default
   * is what a drop target owes the page whether or not it can accept the file.
   * Only the assignment and the `change` dispatch are conditional.
   */
  const handleDragOver = useCallback((event) => {
    // Unconditional: see above. A panel that looks like a drop target must not
    // let the browser navigate away from the form, even while it is busy.
    event.preventDefault();
  }, []);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    if (inert || loading) return;
    const dropped = event.dataTransfer?.files;
    if (!dropped || dropped.length === 0) return;
    const node = inputRef.current;
    if (!node) return;
    node.files = multiple || dropped.length === 1
      ? dropped
      : (() => {
        // A single-file field takes the first of several, the same as the
        // native picker does when `multiple` is absent.
        const one = new DataTransfer();
        one.items.add(dropped[0]);
        return one.files;
      })();
    node.dispatchEvent(new Event('change', { bubbles: true }));
  }, [inert, loading, multiple]);

  useEffect(() => {
    if (loading || !restoreFocusOnIdle.current) return;
    restoreFocusOnIdle.current = false;
    const node = inputRef.current;
    if (!node || node.disabled) return;
    /*
     * `<body>` is where a browser puts focus after disabling the focused
     * element, but not every engine agrees: Safari can leave `activeElement`
     * null transiently, and a test DOM may report the documentElement. Treating
     * all three as "nothing focused" is what makes this a restore rather than a
     * focus steal.
     */
    const active = document.activeElement;
    const nothingFocused = !active
      || active === document.body
      || active === document.documentElement;
    if (nothingFocused) node.focus();
  }, [loading]);

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
        onDragOver={handleDragOver}
        onDrop={handleDrop}
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
          ref={mergeRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={inert}
          onChange={handleChange}
          aria-labelledby={labelId}
          aria-describedby={describedBy}
          aria-busy={loading || undefined}
          className="ds-file-input__native"
        />
      </label>
    </div>
  );
});
