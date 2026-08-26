# FileInput

The approved file-picker contract. Nine places were feature-owned for want of
one, and between them had three different ways of opening a picker.

Every one of those nine carried a comment saying "the design system has no
approved file-input contract yet". It shipped on 2026-08-21; four days later this
component had **two** consumers and the other nine were untouched. Migrating them
(2026-08-25) showed why, and it was not neglect: **the contract existed and its
API covered one of the product's three shapes.** A primitive that fits a third of
its call sites does not get adopted. `check:ui-contract`'s `raw-file-input` rule
is what stops the tenth being written.

## The one structural rule

A **real `<input type="file">`**, visually hidden but still focusable, with a
`<label>` styled as the visible control.

- **Not `display: none`.** It removes the input from the tab order and takes the
  keyboard path to the picker with it — the exact defect in two of the four
  hand-built controls this replaces, both of which were a `<div onClick>`
  driving a hidden input.
- **Not a `<button>` calling `.click()`** on a hidden input. That works with a
  mouse and leaves the accessible name on the wrong element.

With a real input and a real label, Tab reaches it, Space and Enter open the
picker, the label is its accessible name, and the browser's own file-type
filtering come for free; dropped files are handled explicitly by `onDrop`.

## Three shapes

| Prop | For |
|---|---|
| default | A picker beside other controls — a settings field, a per-row upload |
| `variant="dropzone"` | The full-width dashed panel. `BulkUploadLayout`, the driver application's `UploadField`, the campaign recipient import and the e-doc envelope creator had each built this by hand. As a `<label>` the whole panel is the click target, and `onDrop` accepts a file dropped anywhere on it — none of the four hand-built versions had the second, and neither did this until 2026-08-25: the docs claimed the label supplied it, but a label forwards a click to its control and never a drop, so dropped files were silently discarded |
| `loading` | An upload in flight: it spins, says so with `aria-busy`, and refuses a second file. The avatar and company-logo pickers used `Button loading` plus a hidden input for exactly this |
| `labelHidden` | A picker whose field is already named on screen — a photo preview beside it. Same prop and meaning as `Checkbox`'s |

`variant` throws on an unknown value rather than falling back, so a typo is a
crash at the call site instead of a silently wrong control.

## It is a picker, not an uploader

Progress, retry, preview, size limits, and the upload itself stay with the
feature. The public application's `UploadField` composes exactly this and owns
all of that around it.

## `loading` owns the focus it takes away

`loading` disables the input, and disabling the element that currently has focus
drops focus to `<body>`. An upload started from the keyboard therefore ended with
the user at the top of the document once it finished — the picker they were on had
been disabled underneath them.

The two hand-built pickers this component replaced each had their own
focus-return effect for exactly this, and deleting them without putting the
behaviour here is a real regression a review caught on 2026-08-25. It lives in
the component now, because `loading` is the component's prop and this is the
component's consequence.

It is a **restore**, not a grab, and it asks a narrower question than it first
did. An earlier version armed the flag on every `change`, reasoning that the
event comes from the input so the input must be focused. True of the picker,
false of a drop: `handleDrop` dispatches `change` *from* the input and a drop
moves no focus at all, so a mouse user who dragged a logo onto the panel had
focus jump into a clipped 1x1 input when the upload finished. The flag is now
armed only when this input *is* `document.activeElement` as the file arrives, and
focus is returned only if nothing meaningful holds it when `loading` clears. A
user who tabbed away during the upload keeps their place.

## Rules the tests pin

- **`label` is required** and names what is being uploaded.
- **`description` becomes `aria-describedby`**, so the accepted types are heard
  *before* the picker opens rather than discovered from a rejection afterwards.
  In `dropzone` it renders *inside* the panel, because that is where the accepted
  types belong when the panel is the whole control.
- **A caller's `aria-describedby` is added to ours, not replaced by it.** It used
  to sit after the `{...props}` spread, so a caller passing its own help-text id
  had it silently dropped. Found by migrating the profile-photo picker, whose
  "Accepts image files under 2 MB" stopped being announced — and nothing looked
  wrong, which is what makes a silently discarded accessibility attribute the
  worst kind of override.
- **A drop the `accept` list refuses says so.** The native picker will not offer
  a file it cannot accept; a drop inherits none of that, so `handleDrop` enforces
  `accept` itself — and, since 2026-08-26, reports what it refused instead of
  returning in silence. The message is a `role="alert"`, matching `FieldMessage`'s
  rule that errors are assertive and everything else polite, and it is visible as
  well as announced. While it stands the input is `aria-invalid` and the message
  joins its `aria-describedby`; any later selection clears all three.
- **A mixed drop is explicit about both ways a file can vanish.** Accepted files
  go down the normal path untouched; refused ones are named (up to three, counted
  after that), and a single-file field says that only the first was taken.
- **`onReject` transfers ownership of that message**, and a call site that
  removes the picker needs it. `EnvelopeSidebar` renders the picker only while
  `!file` and `UploadField` only in its idle state, so on a *mixed* drop the
  accepted file unmounts the alert in the commit that created it — found in
  review on 2026-08-26 and reproduced. `onReject` fires **after** `onChange`, so
  a call site can clear stale state in its own handler and still receive the
  message that arrived with this drop. When it is passed, `FileInput` announces
  nothing of its own, so the same sentence is never said twice — but it keeps
  `aria-invalid` and keeps the message as a silent, visually hidden
  `aria-describedby` target. The live region moves to the call site; the field's
  error contract stays where the field is. Dropping it altogether was the first
  attempt, and it left a screen-reader user who tabbed back to the picker with a
  valid-looking control and no reason attached, because the consumer's alert has
  no id the input can point at.
- **`loading` implies `disabled`**, so a second file cannot replace the first
  mid-upload.
- **`disabled` dims the label with the control**, not separately.
- The focus ring is drawn on the label through `:focus-within`, because the
  input itself is clipped.
