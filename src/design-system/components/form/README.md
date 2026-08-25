# Form controls

These primitives own the visual and accessibility contract for native form
controls. They use native event objects and do not transform values, validate
business rules, fetch data, or save anything.

- `FormField` associates one control with its label, helper text, required
  state, and error.
- `FieldDisplay` presents labelled read-only information without adding a form
  control to keyboard order.
- `Label` and `FieldMessage` are available for uncommon compositions.
- `Input`, `Textarea`, and `Select` share height, typography, focus, invalid,
  disabled, and read-only presentation.
- They take `size` from the **shared control scale** — `sm` (36px), `md` (44px,
  the default) and `lg` (52px) — which is the same scale `Button` reads. That is
  what makes an input and its adjacent button line up at the default; before it,
  `.ds-form-control` hardcoded 44px while `Button`'s `md` was 40px and screens
  compensated with `size="lg"` on the button.
  - A `Textarea` opts out of the height token, because it is sized by rows, but
    keeps the step's padding and type so it still reads as the same family.
  - **On a phone they take 16px, not their scale step.** iOS Safari zooms the
    viewport in when a focused input is under 16px and does not zoom back out,
    and every step here is 13–15px. Under `max-width: 639px` all three take
    `--ds-font-size-control-mobile`. Heights are unaffected: 16px at the body
    line-height fits inside all three min-heights, so the type grows and the
    control does not move.
  - `size` deliberately **shadows the native `size` attribute** of `<input>` and
    `<select>` (character width / visible rows). A control whose width came from
    a character count could not line up with anything beside it, so width is a
    layout decision. Passing `size={30}` throws, with a message saying so —
    silently ignoring it would be worse.
- `FormSection` groups related fields with a heading and optional actions.
- `Checkbox` and `Radio` are the native-first choice controls: each owns its own
  label (always required — an unlabelled box is the defect they exist to
  prevent), an optional description, the invalid treatment, the focus ring, and
  the 20 px box inside a comfortable label row.
- `ChoiceGroup` wraps a set of related choices in a real `<fieldset>`/`<legend>`
  so assistive technology announces the question once instead of repeating it
  inside every option label.

## Why native checkbox and radio inputs

The browser already provides the correct roving-focus keyboard model for a radio
group (arrow keys move and select within a shared `name`, Tab leaves the group),
required-group validation, and platform autofill. A `div` with
`role="radiogroup"` has to reimplement all three, and usually gets one wrong.

`Radio` therefore requires a `name`. Inside a repeating row, pass a row-unique
`name`/id base — reusing one `name` across rows makes the browser treat every row
as a single group and produces duplicate element ids, so `label[for=…]` resolves
to the first row. `src/shared/components/form/RadioGroup.jsx` shows the pattern
(`idPrefix` / `groupName` scoping while the saved field key stays put).

`required` sets the native attribute *and* the visible/announced required marker.
Inside a `ChoiceGroup` whose legend already carries the marker, pass
`requiredMark={false}` so options do not announce as "Yes required, No required".

Existing `src/shared/components/form/InputField.jsx` remains a compatibility
adapter for consumers that require `(name, value)` callbacks and specialized
file behavior. Migrate those consumers separately and preserve their callback
contracts.

Switch and file-input contracts remain open roadmap work; do not improvise local
design-system alternatives. Feature-owned file-input compositions (the public
application's `UploadField` and the custom-questions upload) document that gap at
their call sites.
