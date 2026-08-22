# FileInput

The approved file-picker contract. Four places were feature-owned for want of
one, and between them had three different ways of opening a picker.

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
filtering and drag-and-drop target come for free.

## It is a picker, not an uploader

Progress, retry, preview, size limits, and the upload itself stay with the
feature. The public application's `UploadField` composes exactly this and owns
all of that around it.

## Rules the tests pin

- **`label` is required** and names what is being uploaded.
- **`description` becomes `aria-describedby`**, so the accepted types are heard
  *before* the picker opens rather than discovered from a rejection afterwards.
- **`disabled` dims the label with the control**, not separately.
- The focus ring is drawn on the label through `:focus-within`, because the
  input itself is clipped.
