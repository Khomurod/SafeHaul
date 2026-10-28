# Patterns

Patterns compose design-system components into repeatable, business-neutral
experiences.

| Pattern | What it owns |
|---|---|
| [`list-toolbar/`](list-toolbar/README.md) | `ListToolbar`, the one row of controls above a list, and the six rules every list page follows |
| [`modal/`](modal/README.md) | `Modal`, the accessible dialog primitive every overlay in the product goes through, and `ConfirmDialog`, the one confirmation shape |
| [`page-state/`](page-state/README.md) | `EmptyState`, `ErrorState` and `LoadingState` — the three states every data-backed page has, each with the right announcement |
| [`save-bar/`](save-bar/README.md) | `SaveBar`, the one bar a page shows while it has unsaved changes, and `useUnsavedChanges`, which guards reload and lets a shell ask before leaving |

Still to come: form-field structure beyond `FormSection`, and responsive data
presentation. Several are documented by example in the catalog
(`stories/patterns/`) without yet existing as components — a story that
hand-composes primitives with inline `style` is a pattern waiting to be
extracted, not a pattern that exists.

Patterns may expose slots and callbacks. They must not fetch data, name domain
entities, or decide which feature actions are allowed.
