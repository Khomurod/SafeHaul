# Button and IconButton

Buttons own shared sizing, focus, disabled, loading, and visual variants.
Features own labels, icons, permission checks, and callbacks.

- Use `Button` for text or text-plus-icon actions.
- Use `IconButton` for icon-only actions and always provide `label`.
- Supported variants are `primary`, `secondary`, `ghost`, and `danger`.
- Supported sizes are `sm` (36px), `md` (44px, the default) and `lg` (52px).
  This is the **shared control scale**: `Input`, `Select` and `Textarea` read the
  same three tokens, so a button and the control beside it are the same height
  without anything being set at the call site.
  - `sm` for dense chrome — table row actions, toolbar affordances, pagination.
    It clears WCAG 2.2 SC 2.5.8 (Minimum, 24px).
  - `md` for everything else. 44px is SC 2.5.5 (Enhanced, AAA), and it is the
    default rather than an opt-in.
  - `lg` for the primary action of a public, mobile-first, single-task screen —
    the driver application wizard, Login, the employer verification portal, the
    signing sheet. When one action in a row takes `lg`, its siblings take it too.
- **`lg` is not how you match a form control.** The default already does that.
  `md` was 40px while `.ds-form-control` hardcoded 44px, so 25 internal call
  sites had reached for `size="lg"` meaning "make it 44px". They no longer do,
  and `lg` got its meaning back. Reintroducing that habit is the regression.
- **Icon size is not a call-site decision.** `Button.css` sizes the icons a
  button is handed directly (`.ds-button__content > svg`) from the step's token (14 / 16 / 18px; an icon-only `IconButton`
  takes the next step up). A CSS declaration beats the `width`/`height`
  *attributes* an icon library renders, so `<Plus size={24} />` inside a button
  renders at the token, not at 24. Call sites had been passing 16, 18, 20, 24 and
  `className="h-5 w-5"` to adjacent buttons, which is why identical actions had
  different-looking internal spacing. A button that instead composes a
  multi-line tile — a larger glyph beside heading-sized text inside a wrapper —
  keeps its own sizing, because flattening it would be a downgrade.
- Supported tones are `default` and `success`. A tone recolours the button while
  the variant keeps owning shape, size, focus, disabled and loading. Use
  `tone="success"` only where completion is part of the action's meaning — the
  signing room's **Finish & Submit** is the reference case. Tone is never the
  only signal: the label still has to say what the action does.

Do not recolour a `Button` with a background utility class from a feature. The
component's own `[data-variant]` rules carry two selectors, so a single-class
utility loses on specificity and the override becomes dead CSS — silently, and
without touching the hover state at all. If a needed tone is missing, record the
gap in the roadmap and add it here instead.
