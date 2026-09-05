# Modal and ConfirmDialog

`Modal` is the accessible dialog primitive. `ConfirmDialog` composes it into the
one confirmation shape the product uses.

**Every overlay goes through `Modal`.** A repository-wide scan for
`fixed inset-0` should return only `Modal.css` and callers still passing an
`overlayClassName` (see *Chrome contract* below, which is retiring those).
Anything else is a hand-built dialog, and every hand-built dialog this
migration replaced was missing the same four behaviours:

- `role="dialog"` + `aria-modal="true"`, with a label by construction;
- focus moved into the dialog on open and restored to the trigger on close;
- Tab / Shift+Tab trapped inside while open;
- Escape and backdrop dismissal, each optional.

## Chrome contract

Added 2026-09-05. Before it, `Modal` took a `className` and an
`overlayClassName` that **replace** the panel and backdrop wholesale, and 38 of
the 41 call sites used them — writing 30 different spellings of the same handful
of intentions. A hairline border here and none there; `max-h-[85vh]` beside
`max-h-[92vh]`; `backdrop-blur-md` beside `backdrop-blur-sm`. None of it was
visible to any guard, because every one of those classes is perfectly
on-contract. The variation was the problem, not the classes.

So the chrome moved into `Modal.css` and the variation became six enumerated
props:

| Prop | Values | Default | For |
|---|---|---|---|
| `size` | `sm` `md` `lg` `xl` `2xl` `4xl` `5xl` `7xl` | `lg` | panel width |
| `scroll` | `panel` `body` | `panel` | `body` pins a header and footer inside the panel |
| `fill` | boolean | `false` | fixes the height, for a viewer that must not resize |
| `mobile` | `inset` `fullscreen` | `inset` | below 640px |
| `placement` | `center` `bottom` | `center` | `bottom` is a sheet |
| `tone` | `neutral` `danger` | `neutral` | borders a destructive dialog |

**What a caller does not choose:** surface, border, radius, shadow, overlay
colour, blur and stacking layer. Those are what makes a dialog look like this
product's dialog, so they are fixed chrome with no prop at all.

**An unsupported value throws.** A silent fallback to the default is exactly how
thirty spellings accumulated without anyone noticing.

`scroll="body"` deserves the emphasis it gets: without it, a dialog whose
content grows scrolls its footer out of reach on a short viewport, and the
confirm button becomes unreachable. It is the commonest dialog layout defect
there is.

### The legacy props, and when they go

`className` and `overlayClassName` still work and still replace the chrome, so
every unmigrated call site renders **exactly** as it did. They warn once per
distinct class list in development.

They are one decision, not two: passing either opts the whole dialog out, and
the other falls back to what such a caller used to inherit. That is deliberate —
20 of the 41 sites pass only `className`, and handing those the contract's
overlay would have moved their stacking layer from 50 to 60 in a slice that
promises no change. Half the contract and half a class list is also the one
combination that cannot be reasoned about, since the two would fight over the
same properties.

The slice that finishes migrating the call sites deletes both and throws on
either.

## Stacking

The overlay sits at `--ds-z-modal`, which is not a caller's decision. It matters
because the mobile navigation drawer sits at the same layer and every dialog
still writing its own overlay writes a bare `z-50` — which renders it **behind**
the drawer. Nine hand-written workarounds for that exist in the tree.
`check:visual-contract` reads the overlay's `zIndex` on every run so the
contract's own layer cannot drift back down.

## Rendering convention

There is no `open` prop. **Rendering the component means the dialog is open**, so
the owner writes `{open && <Modal …/>}`. That is what makes focus restoration
work — unmounting *is* the close event.

## ConfirmDialog

Domain-neutral: it does not know what a campaign, envelope or application is.
Callers supply the words, the tone and the action. Two of its defaults are safety
properties rather than preferences, and both are covered by tests:

- **Initial focus goes to Cancel, not Confirm.** These dialogs guard
  irreversible work, so the safe action is the one under the user's finger.
- **Escape and backdrop dismissal are disabled while `loading`**, and backdrop
  dismissal is off by default. A stray click beside a delete dialog decides
  nothing, and an operation in flight cannot be abandoned half-way.

A flow that needs two destructive choices uses **two sequential
`ConfirmDialog`s**, not one dialog with two of them. `ConfirmDialog` routes
Escape to `onCancel`, so a single dialog whose cancel discarded a draft would
delete a driver's saved application on a stray keypress. The driver
application's resume flow is the reference case.

## Why this is in the design system

Dialog structure was always meant to be a pattern. It sat in
`src/shared/components/modals` until 2026-08-21 for one reason: `ConfirmDialog`
composes `Modal`, and the design system may not depend on `shared`, so moving
either alone would have created the exact dependency inversion the migration
exists to remove. They moved together, and `tests/architecture.test.js` now
forbids `shared` imports from this directory outright — a rule that could not be
written while these two files were the counterexample.

No blocking browser dialogs. `confirm()` and `alert()` are rejected by
`src/tests/noBlockingBrowserDialogs.test.js`; use `ConfirmDialog` for a
confirmation and a toast or `FieldMessage` for a notification.
