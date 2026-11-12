# Switch

The WAI-ARIA `switch` pattern: an immediate on/off control.

## A switch is not a checkbox

A checkbox is a value you set and then submit. A switch takes effect the moment
it moves.

- `Checkbox` — inside a form with a Save button.
- `Switch` — where the change is applied at once.

Getting this backwards produces either a control that announces a state it has
not reached yet, or a form field that saves behind the user's back.

## How it looks

Off, a grey track (`--ds-color-border`) with the white thumb at the start; on,
the tone's colour with the thumb at the end, so the state never rests on colour
alone. 44 × 24px: a 24px target is the smallest WCAG 2.5.8 allows.

## Rules the tests pin

- **`label` is required** and is the accessible name. In a matrix, name *both*
  dimensions — "Enable exports for Northwind Ltd", not "Enable". The feature
  matrix once shipped a grid of these with no name at all: a screen-reader user
  heard "button" and could not tell which row or column it belonged to.
- **A real `<button>`**, so Space and Enter work with no key handler of our own.
- **The thumb's position is the non-colour signal.** `tone` only tints the *on*
  state, for cases where on is affirmative or restrictive rather than neutral.
- **`showLabel` prints the label beside the switch**, as a `<label>` for the
  button: the words name it (`aria-labelledby`) and pressing them moves it. Use
  it for a switch that stands alone, such as "Only mine" in a list toolbar.
  `className` then goes on the pair, so a layout places both together.
