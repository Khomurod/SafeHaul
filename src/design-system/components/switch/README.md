# Switch

The WAI-ARIA `switch` pattern: an immediate on/off control.

## A switch is not a checkbox

A checkbox is a value you set and then submit. A switch takes effect the moment
it moves.

- `Checkbox` — inside a form with a Save button.
- `Switch` — where the change is applied at once.

Getting this backwards produces either a control that announces a state it has
not reached yet, or a form field that saves behind the user's back.

## Where it came from

Promoted from `features/settings/.../ToggleSwitch` on 2026-08-21. That
implementation was already correct; it was feature-owned only because the design
system had no switch — which meant the Super Admin feature matrix could not
import it and used a `Checkbox` instead, announcing the wrong role for a control
that saved immediately.

## Rules the tests pin

- **`label` is required** and is the accessible name. In a matrix, name *both*
  dimensions — "Enable exports for Northwind Ltd", not "Enable". The feature
  matrix once shipped a grid of these with no name at all: a screen-reader user
  heard "button" and could not tell which row or column it belonged to.
- **A real `<button>`**, so Space and Enter work with no key handler of our own.
- **The thumb's position is the non-colour signal.** `tone` only tints the *on*
  state, for cases where on is affirmative or restrictive rather than neutral.
