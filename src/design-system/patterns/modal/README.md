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

### The legacy props are gone

`className` and `overlayClassName` were removed on 2026-09-05, and passing
either now throws. They REPLACED the chrome rather than extending it, which is
how 38 call sites came to write 30 spellings of the same six intentions.

They are still *named* in the signature, deliberately: a removed prop that falls
into a `...rest` lands on the DOM as an unknown attribute, which is the quiet
version of the same problem. A caller that reaches for one gets a sentence
telling it what to use instead.

There is no styling escape hatch left. If none of the six axes is the shape you
need, the case goes into `Modal.css` with the roadmap row that justifies it —
which is a review, not a class list.

### Nested dialogs need no stacking prop

Four dialogs open inside another one: the document preview inside the driver
dossier, the delete confirmation inside the dossier and inside the team dialog,
and the request history inside the PEV tab. Each used to carry a bigger number
than its parent — `z-[65]`, `z-[70]`, `z-[100]` — and none of them needed to.

A nested dialog's overlay is a DOM **descendant** of its parent's, and the parent
sets a `z-index`, so the parent forms a stacking context. A positioned descendant
with `z-index >= 0` paints above its ancestor's content whatever number it
carries. The numbers were compensating for nothing, and they are gone.

## Stacking

The overlay sits at `--ds-z-modal`, which is not a caller's decision.
`check:visual-contract` reads the overlay's `zIndex` on every run so the
contract's own layer cannot drift back down, and `e2e/dialog-layering.spec.cjs`
checks the whole scale resolves in order in a real browser.

The scale is in `tokens/foundation.css`, and it is worth reading the comment
there: the tree carried **74 raw `z-*` sites spelling fourteen different
numbers**, `z-[9999]` among them, because a bare number says nothing about what
it is *for* — so the only way to raise something was to outbid whatever it had
lost to. `--ds-z-drawer` (50) sits below `--ds-z-modal` (60) for that reason.

**One correction worth keeping**, because the earlier version of this paragraph
got it wrong. `WorkspaceFrame`'s mobile drawer did read `--ds-z-modal`, so in
the CSS it outranked every dialog — but that conflict is **not reachable
through the UI**: while the drawer is open its backdrop covers every page
control, and nothing rendered inside the drawer opens a dialog. Both were
checked. So the ordering was wrong rather than visibly broken, and what the fix
removes is a trap the next "open a dialog from the navigation" would have fallen
into, not a bug anyone can currently see.

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
