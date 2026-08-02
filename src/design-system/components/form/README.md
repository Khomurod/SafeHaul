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
