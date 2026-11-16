# Form controls

These primitives own the visual and accessibility contract for native form
controls. They use native event objects and do not transform values, validate
business rules, fetch data, or save anything.

- `FormField` associates one control with its label, helper text, required
  state, and error. Its rows pack at its top (`align-content: start`): in a
  grid row beside a taller field (a hint that wraps, an error) the extra height
  goes below the messages, so the two controls stay level. Before, the rows
  shared it and the shorter field's control sat lower (6px in Settings → Text
  messages, under a two-line phone hint).
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
- `FormSection` groups related fields with a heading and optional actions, in
  one of three layouts, with an optional footer (below, "FormSection layouts").
- `Checkbox` and `Radio` are the native-first choice controls: each owns its own
  label (always required — an unlabelled box is the defect they exist to
  prevent), an optional description, the invalid treatment, the focus ring, and
  the 20 px box inside a comfortable label row.
- `ChoiceGroup` wraps a set of related choices in a real `<fieldset>`/`<legend>`
  so assistive technology announces the question once instead of repeating it
  inside every option label. `appearance="card"` draws each option as a card
  (below, "Choice cards").

## FormSection layouts

`FormSection` lives in `FormSection.jsx` / `FormSection.css` (re-exported from
`FormControls.jsx`, so either import works).

| Prop | Values | Default | Notes |
|---|---|---|---|
| `layout` | `card`, `stacked`, `aside` | `card` | an unsupported value throws |
| `padding` | `none`, `sm`, `md`, `lg` | `md` | the card **body**'s inset; `none` makes a table or a list the card itself |
| `header` | `inset`, `bleed` | `inset` | `card` only: the header divider inset by the card padding, or edge to edge; an unsupported value, or `bleed` on `stacked`/`aside`, throws |
| `footer` | node | — | a row of actions under the body |
| `actions` | node | — | header tools; in `aside`, under the description |
| `title` / `description` | string | — | a title or an `aria-label` is required; `stacked` and `aside` require a visible title |
| `as` | element | `section` | |

- **`card`** — the heading is the card's first row, over a divider, then the
  body. By default (`header="inset"`) the divider stops at the card's padding
  and the description is `--ds-font-size-sm` (13px), `content-muted` — the
  header the driver application, the verification portal and the prep editors
  have always had. **`header="bleed"`** (C2: Add lead, Import) runs the divider
  edge to edge, as the footer's does, and gives the description C2's 14px
  (`--ds-font-size-body`), 80ch measure and `text-wrap: pretty`. Pair `bleed`
  with a `footer` or a flush body (`padding="none"`) so the dividers line up.
- **`stacked`** — a `<section>` holding the 16px heading and the description,
  then, `--ds-space-3` below, a full-width card with the body and the footer.
  Put stacked sections in a `Stack gap="lg"` (C2 draws 32px; the Stack scale's
  largest step is 24px, the section-gap role).
- **`aside`** — the heading, the description and the `actions` in a 232px
  column beside the card (`--ds-space-8` apart), top-aligned. Under a **760px
  section** it becomes `stacked`: the section is its own size container
  (`container: ds-form-section / inline-size`), so the rule follows the width
  it is given, not the viewport — the settings content column is 872px at 1440
  and 702px at 1366 (the catalog's `AsideSectionsInNarrowColumn` shows it at a
  desktop viewport). An `aside` section **fills its container's width**
  (`width: 100%`): the containment takes its width off its content, so in a
  shrink-to-fit parent it would otherwise measure 0. Adjacent `aside` sections
  are divided by a rule.
- `stacked` and `aside` descriptions are 14px, at most 80ch, `text-wrap: pretty`.

**The card pads nothing itself.** The header, the body and the footer each carry
the inset (`--ds-form-section-inset`, from the card padding role), so the
footer's divider (and a `bleed` header's) runs edge to edge and `padding="none"`
flushes only the body: the header and the footer keep their inset, so their
words line up with a padded body's.

**`footer`**: right-aligned, `--ds-space-2` apart, a full-bleed top border,
`--ds-space-4` above and below; on a phone (under 768px) each child takes an
equal share of the row and never breaks its label. A section that saves on a
button puts the button here; a page that saves on `SaveBar` keeps `SaveBar`.

Every layout is a region named by its heading (`aria-labelledby`), so a reader
can jump between sections.

## Choice cards

```jsx
<ChoiceGroup legend="Role" required appearance="card" orientation="horizontal">
  <Radio name="role" value="standard" label="Standard" description="Sees their own records."
         required requiredMark={false} checked={…} onChange={…} />
  <Radio name="role" value="full" label="Full access" description="Sees everything and changes settings."
         required requiredMark={false} checked={…} onChange={…} />
</ChoiceGroup>
```

Each option is a bordered card (`--ds-color-border`, `--ds-radius-lg`), its
label a semibold 14px title and its description a 12px line straight under it,
so a short description holds one line and a card stands about 66px, as C2 draws
the role choice. The label's hit area
covers the whole card, so pressing anywhere on it chooses it. A chosen card
wears what a selected `SelectableCard` wears: the action border, an inset 1px
ring (no thicker border, so nothing shifts) and `--ds-color-surface-selected`;
in forced colours a `Highlight` border and outline. `horizontal` puts the cards
side by side while each keeps 240px, one a row on a phone; `vertical` stacks
them.

Because the hit area covers the card, text in it is not selectable by drag.
A link or a button inside a `description`, and the error message, sit above
the hit area (`position: relative; z-index: 1`), so they stay pressable and
selectable; a press on the rest of the card still chooses it. Hover marks a
card that is neither chosen nor disabled — a chosen card keeps its border.

They stay native inputs in a real `<fieldset>`, so a set of radio cards is
still a radio group — arrow keys move and choose, Tab leaves, `required` is the
browser's — which is why this is a `ChoiceGroup` appearance and not
`SelectableCard`, which is a button. An unsupported `appearance` throws.

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
