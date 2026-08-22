# Modal and ConfirmDialog

`Modal` is the accessible dialog primitive. `ConfirmDialog` composes it into the
one confirmation shape the product uses.

**Every overlay goes through `Modal`.** A repository-wide scan for
`fixed inset-0` should return only `Modal.jsx` and callers passing it an
`overlayClassName`. Anything else is a hand-built dialog, and every hand-built
dialog this migration replaced was missing the same four behaviours:

- `role="dialog"` + `aria-modal="true"`, with a label by construction;
- focus moved into the dialog on open and restored to the trigger on close;
- Tab / Shift+Tab trapped inside while open;
- Escape and backdrop dismissal, each optional.

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
