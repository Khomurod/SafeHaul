import React, { forwardRef, useCallback, useEffect, useId, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { resolveDroppedFiles } from './dropAcceptance';
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
 *
 * ## `loading` says so out loud, too (2026-08-26)
 *
 * Both pickers this replaced also carried a `<p role="status">` region reading
 * "Uploading company logo…", and the migration dropped it on the reasoning that
 * `aria-busy` plus the button text now carried the state. Neither is announced:
 * `aria-busy` is on an input that `loading` has just disabled and taken focus
 * from, and the button text is ordinary content, not a live region. The upload
 * went silent for a screen-reader user. Restored here rather than at each call
 * site — one region per picker, in the component whose prop `loading` is. See
 * `loadingStatus`.
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
  loadingStatus,
  variant = 'button',
  onChange,
  onReject,
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
   * What the last drop refused, or null.
   *
   * State rather than a prop: this is the component's own consequence, exactly
   * as the focus restore below is. `accept` and `multiple` are its props, the
   * drop handler is its handler, and no call site can see the files that were
   * turned away — `onChange` only ever carries the ones that survived.
   */
  const [rejection, setRejection] = useState(null);
  /*
   * `onReject` transfers ownership of the message.
   *
   * A call site that passes it has said "I will show this", and it has to,
   * because it is the one that removes the picker. If this component also
   * rendered its own copy the two would overlap — both on screen at once while
   * the picker is still mounted, both announced — and "sometimes one, sometimes
   * two" is a worse contract than either. So exactly one of them owns it, and
   * the presence of the callback is what decides which.
   */
  const ownsRejectionMessage = typeof onReject !== 'function';
  const shownRejection = ownsRejectionMessage ? rejection : null;

  /*
   * Three sources, one description.
   *
   * A caller's `aria-describedby` is ADDED to ours, not replaced by it. This
   * used to be `aria-describedby={descriptionId}` after a `{...props}` spread,
   * so a caller passing its own help-text id had it silently dropped — found by
   * migrating the profile-photo picker, whose "Accepts image files under 2 MB"
   * message stopped being announced. Silently discarding an accessibility
   * attribute a caller asked for is the worst kind of override, because
   * everything still looks right.
   *
   * The rejection joins them while it stands, matching `FormField`: an error is
   * part of what describes the control, so someone who tabs to the picker
   * afterwards hears why their file did not take. It leaves again the moment a
   * new selection clears it, so the description never keeps a stale complaint.
   */
  const errorId = `${inputId}-error`;
  const describedBy = [descriptionId, shownRejection ? errorId : null, callerDescribedBy]
    .filter(Boolean)
    .join(' ') || undefined;

  const labelId = `${inputId}-label`;
  // `loading` implies the picker cannot be used, exactly as it does on `Button`.
  // Leaving it enabled would let a second file be chosen while the first is
  // still uploading, which is the defect the two hand-built pickers avoided by
  // disabling their trigger.
  const inert = disabled || loading;

  /*
   * What the live region says while `loading` is true.
   *
   * Defaults to the field it names, so a screen on which two pickers are busy
   * says which one — "Uploading Company logo…", not a bare "Uploading…" twice.
   * Named `loadingStatus` and not `loadingLabel` (which is what `DataTable`
   * calls its equivalent) because both of this component's label props are
   * *visible* copy — `label` and `buttonLabel` — and this is the one string that
   * is never seen. A call site whose field label does not read well in that
   * sentence passes its own.
   *
   * A blank or non-string override falls back to the default rather than being
   * honoured. An upload that says nothing is the defect this region exists to
   * fix, so `loadingStatus=""` must not be a quiet way back to it — a consumer
   * that wants to announce the upload itself instead needs a prop that does not
   * exist yet, and adding one would be a deliberate decision.
   */
  const statusMessage = typeof loadingStatus === 'string' && loadingStatus.trim() !== ''
    ? loadingStatus
    : `Uploading ${label}…`;

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
   * ## Focus goes back only if it was HERE to begin with (2026-08-26)
   *
   * The first version armed the flag on every `change`, reasoning that "the
   * change event comes from the input, so the input is focused". True of the
   * picker, false of a drop: `handleDrop` below assigns the dropped files to
   * this input and dispatches `change` *from* it, and a drop moves no focus at
   * all. Measured in Chromium — after a drop on the panel `document.activeElement`
   * is still `<body>`, and the dispatched `change` arrives with it still there.
   *
   * So a mouse user who dragged a logo onto the dashed panel had focus jump into
   * a 1x1 clipped input the moment the upload finished. The restore guard below
   * cannot catch that, because `<body>` is both "the user had nothing focused"
   * and "focus was just taken away from this input" — the two states it exists
   * to tell apart. Found in review on 2026-08-26.
   *
   * The fix asks the question the guard cannot: was this input *itself* what
   * focus was on when the file arrived? That is exactly what separates the
   * paths, and each half was measured rather than assumed:
   *
   * - keyboard — Tab to the input, Space opens the picker, the OS dialog leaves
   *   `document.activeElement` on the input, and `change` fires with it there;
   * - mouse on the control — a real click on a `<label>` focuses the control it
   *   names (Chromium, measured), so this path arms too, which is right: focus
   *   is on the control the user just clicked;
   * - drop — focus stays wherever it was, so nothing arms. Unless the user had
   *   already Tabbed to this input and then dragged a file in, in which case
   *   restoring it is not a steal but a return to where they really were.
   *
   * Restoring stays conditional on nothing meaningful holding focus: never take
   * it back from wherever the user moved while the upload was in flight.
   */
  const inputRef = useRef(null);
  const restoreFocusOnIdle = useRef(false);

  const mergeRef = useCallback((node) => {
    inputRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  const handleChange = useCallback((event) => {
    /*
     * Read the focus BEFORE passing the event on. A consumer's `onChange` is
     * what sets the state that turns `loading` on, and disabling this input is
     * what takes focus off it — so afterwards the answer is already gone.
     */
    const node = inputRef.current;
    restoreFocusOnIdle.current = Boolean(node) && document.activeElement === node;
    /*
     * Any new selection retires the old rejection — the message described a drop
     * the user has now replaced, and stale error text under a file that uploaded
     * fine is worse than no text at all. `handleDrop` re-records its own message
     * after dispatching, so a mixed drop keeps the one it just earned.
     */
    setRejection(null);
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
    const dropped = Array.from(event.dataTransfer?.files ?? []);
    if (dropped.length === 0) return;
    const node = inputRef.current;
    if (!node) return;

    /*
     * `accept` has to be enforced here, because assigning `files` skips the one
     * place it was being enforced.
     *
     * The native picker filters by `accept` in its own dialog, so a call site
     * that passes `accept="image/*"` has never had to check the type it got. The
     * company logo is exactly that: `BrandingSection` passes `image/*`, and
     * `CompanyProfileTab`'s handler uploads and persists whatever arrives with no
     * validation of its own — and Storage permits PDFs in `company_assets`. So
     * before this filter, dropping a PDF on the logo control saved it as the
     * logo and left a broken image on the company profile.
     *
     * Found in review on 2026-08-25, one round after the drop handling itself was
     * added. Programmatic assignment inherits none of the picker's behaviour, and
     * `accept` was the piece of it that mattered.
     *
     * ## And then it has to SAY so (2026-08-26)
     *
     * Filtering silently is its own defect, and it shipped for a day: the file
     * went nowhere, no message appeared, and the panel looked exactly as it had.
     * A drop is a direct manipulation, so "nothing visibly happened" reads as
     * "this control is broken" rather than "that file is not allowed here".
     *
     * `resolveDroppedFiles` decides both halves together, because they are one
     * decision — what survives, and what the user has to be told. The accepted
     * files go down the existing path untouched; the message is state, below.
     */
    const { accepted, rejected, message } = resolveDroppedFiles({
      files: dropped, accept, multiple,
    });

    if (accepted.length > 0) {
      const transfer = new DataTransfer();
      for (const file of accepted) transfer.items.add(file);
      node.files = transfer.files;
      /*
       * Dispatched BEFORE the message is recorded, and that order is load-bearing:
       * `handleChange` clears any standing rejection, so a mixed drop that
       * cleared it afterwards would swallow the very message it just earned.
       * Both calls land in one React batch, so the message wins.
       */
      node.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /*
     * `onReject` exists because this component cannot promise its own message
     * survives.
     *
     * Several call sites render the picker only while there is no file —
     * `EnvelopeSidebar` is `{!file ? <FileInput/> : …}`, `UploadField` renders it
     * only in its idle state — so a mixed drop hands them a file, they
     * re-render, and the alert below is unmounted in the very commit that
     * created it. Found in review on 2026-08-26 and reproduced: the message
     * never reached the screen, while the all-refused case (which calls no
     * `onChange`, so nothing unmounts) worked.
     *
     * It fires AFTER the change for the same reason `setRejection` does: a
     * consumer clearing stale state in its `onChange` would otherwise clear the
     * message that arrived with this very drop. This way the callback lands
     * last and wins, and a call site needs one `useState` and no ordering trick.
     *
     * Where the picker stays mounted the alert below is still the whole answer
     * and no call site has to do anything.
     */
    if (message) onReject?.({ message, rejected, accepted });
    setRejection(message);
  }, [accept, inert, loading, multiple, onReject]);

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
          aria-invalid={shownRejection ? true : undefined}
          className="ds-file-input__native"
        />
      </label>
      {/*
        What the last drop refused.

        - **`role="alert"`, not `role="status"`.** The system's rule, and the
          right one here: `FormControls`' `FieldMessage` renders an error as an
          alert and everything else politely. A rejection is the direct answer to
          something the user just did, and there is nothing else competing to be
          heard — waiting politely for a gap would be waiting for nothing. The
          upload region above stays polite for the opposite reason: an upload
          starting is information, not a correction.
        - **Mounted only while there is something to say**, which is the
          opposite of the status region above and deliberate. `role="alert"` is
          defined to announce on insertion — that is what separates it from a
          bare `aria-live` region, which does need to exist first — and it is
          what every other error in this system does (`FieldMessage`,
          `ConfirmDialog`, `DataTable`). The alternative, an always-mounted span
          hidden by `:empty`, was written first and measured wrong: `display:
          none` takes the element out of the accessibility tree altogether, so
          the idle region a screen reader was supposed to be watching is not
          there to watch. A live region that is not in the tree announces
          nothing.
        - **Visible as well as announced.** WCAG 3.3.1 wants the error in text,
          and the sighted user who dropped a PDF on an image field needs to know
          it went nowhere just as much.
        - **Not rendered at all when `onReject` is passed**, because then the
          call site owns the message — see `ownsRejectionMessage`.
      */}
      {shownRejection && (
        <span className="ds-file-input__error" id={errorId} role="alert">
          {shownRejection}
        </span>
      )}
      {/*
        The upload announces itself.

        Four rules, each of them the reason a line of this is written the way it
        is rather than a shorter way:

        - **Always rendered, empty when idle.** A live region has to be in the
          document *before* its text changes for the change to be announced;
          mounting one that already contains the message is unreliable. So the
          span is unconditional and `loading` swaps its contents.
        - **`role="status"`, not `role="alert"`.** An upload starting is
          information, not an interruption — polite is the whole point. The
          `aria-live` is written out as well as implied by the role, matching
          `DataTable`'s status region so the system has one live-region shape.
        - **Outside the `<label>` and referenced by nothing.** The field's
          accessible name (`aria-labelledby`) and description
          (`aria-describedby`) are a contract, and a name that gains and loses
          "Uploading…" as an upload runs is a broken one. This region is read
          because it is live, not because it names anything.
        - **Silent when the upload ends.** This component knows an upload
          *started* — that is what `loading` tells it — and never whether it
          succeeded. Announcing "Upload complete" here would say so over a
          failure; the outcome belongs to the feature that owns the request.
          Emptying the region is what stops it repeating itself.
      */}
      <span className="ds-visually-hidden" role="status" aria-live="polite">
        {loading ? statusMessage : ''}
      </span>
    </div>
  );
});
