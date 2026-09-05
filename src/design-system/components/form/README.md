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

## `Input variant="inline"`

A field that lives inside running content rather than inside a form — a per-day
goal in a labelled chip, a date in a date-range chip.

```jsx
<Input type="number" variant="inline" size="sm" align="center" width="compact"
       aria-label={`Dials — daily goal for ${name}`} />

<Input type="date" variant="inline" size="sm" aria-label="Range start date" />
```

| Prop | Values | Notes |
|---|---|---|
| `variant` | `default` (bordered), `inline` | |
| `align` | `start` (default), `center`, `end` | inline only |
| `width` | `auto` (default), `compact` | inline only; `compact` is 56px |

### It is not the published "inline edit" pattern

Atlassian, PatternFly and Cloudscape all define an `InlineEdit` component: a
**read** view that swaps to an **edit** view on activation. That is the standard
answer for an editable value sitting in a sentence, and it is not what any
consumer here is — every one is permanently editable and saves on blur or
change. Building `InlineEdit` would be a primitive with zero consumers.

The name is a trap worth knowing about before you go looking for a read view.

### The variant owns the chrome; `size` still owns the height

Border, background and width change. `min-height`, `padding` and `font-size` do
not — that is what keeps an inline field lined up with the controls beside it,
and a test asserts the variant rule sets none of the three.

Measured before the height was chosen: the two date fields were already 36px,
and the two goal editors had no height at all, rendering at roughly 20px —
**under the 24px WCAG 2.5.8 minimum for something a person clicks into**. Both
pairs take `size="sm"` (36px): the dates are untouched and the goal editors go
over the line.

### The border is hidden, not removed

A field that drops its border on the way in shifts the text beside it by a pixel
on each side, and inside a chip that reads as a wobble. `border-color:
transparent` keeps the box and hides it, so hover can colour it back in without
moving anything.

### `width` is a prop because a class list cannot win

The variant rule sets `width: auto` at two selectors and a `w-14` utility
carries one. Measured in a real browser: a 56px class on a number field rendered
at **220px**, the browser's own default — a four-fold widening that no unit test
saw and that a probe reading the number caught. `width="compact"` is the
contract's answer; the same specificity trap is recorded one component over in
`selectable-card/README.md`.

### It refuses to render unnamed

A bordered field is named by its `FormField` label. An inline one has no such
wrapper by construction, so without an `aria-label`, an `aria-labelledby` or an
`id` a `<label>` points at, it announces as an unlabelled field. It throws
instead.

**Give the name the visible word first.** WCAG 2.5.3 (Label in Name) requires
the spoken name to contain the visible text. The goal editors show `DIALS` above
them and announced as "Daily dial goal for Maria Garcia" — singular, so the name
did not contain its own label and a speech-input user saying "Dials" could not
reach the field. They now read "Dials — daily goal for Maria Garcia", which
keeps the member's name because the row repeats per member.
