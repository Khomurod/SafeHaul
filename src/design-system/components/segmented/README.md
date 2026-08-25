# SegmentedControl

A single-select group of toggle buttons. Retires four separate recorded
exceptions that were each a `role="group"` of raw `<button aria-pressed>` cards.

## Why `aria-pressed` and not a radiogroup

A radiogroup is the textbook choice for single-select, and it is the wrong one
here. It brings the roving-focus keyboard model with it: arrow keys move *and*
select, and Tab leaves the group. Every call site is a grid of tappable cards
that users reach one at a time with Tab, and two of them sit inside a form where
the arrow keys already mean something else.

`role="group"` with `aria-pressed` keeps each option individually tabbable and
announces its state — which is what those call sites already do and what their
tests already assert.

**The trade-off has a limit.** This is not the pattern for a long list of
mutually exclusive options. For that, use `ChoiceGroup` with `Radio`, which is a
real radiogroup and gives you the arrow-key model that a long list needs.

## Rules the tests pin

- **`ariaLabel` is required.** "pressed" on its own does not say what was chosen.
- **Exactly one option is pressed** at a time.
- **Selection is a filled tint plus a heavier border**, never the tint alone —
  the tint is what disappears in forced-colours mode.
- **A multi-column grid collapses to one column below 640px.** Two cards at
  412px get about 170px each, which truncates any real label.
