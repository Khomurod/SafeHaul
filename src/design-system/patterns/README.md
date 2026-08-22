# Patterns

Patterns compose design-system components into repeatable, business-neutral
experiences.

| Pattern | What it owns |
|---|---|
| [`modal/`](modal/README.md) | `Modal`, the accessible dialog primitive every overlay in the product goes through, and `ConfirmDialog`, the one confirmation shape |
| [`page-state/`](page-state/README.md) | `EmptyState`, `ErrorState` and `LoadingState` — the three states every data-backed page has, each with the right announcement |

Still to come: form-field structure beyond `FormSection`, table toolbars and
filter panels, and responsive data presentation. Several are documented by
example in the catalog (`stories/patterns/`) without yet existing as components —
a story that hand-composes primitives with inline `style` is a pattern waiting to
be extracted, not a pattern that exists. `page-state` was exactly that until
2026-08-21.

Patterns may expose slots and callbacks. They must not fetch data, name domain
entities, or decide which feature actions are allowed.
