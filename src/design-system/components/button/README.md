# Button and IconButton

Buttons own shared sizing, focus, disabled, loading, and visual variants.
Features own labels, icons, permission checks, and callbacks.

- Use `Button` for text or text-plus-icon actions.
- Use `IconButton` for icon-only actions and always provide `label`.
- Supported variants are `primary`, `secondary`, `ghost`, and `danger`.
- Supported sizes are `sm`, `md`, and `lg`; all meet the minimum touch target
  contract for their intended density.
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
