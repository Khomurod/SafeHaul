# Patterns

Patterns compose design-system components into repeatable, business-neutral
experiences.

| Pattern | What it owns |
|---|---|
| [`modal/`](modal/README.md) | `Modal`, the accessible dialog primitive every overlay in the product goes through, and `ConfirmDialog`, the one confirmation shape |

Still to come: page feedback and empty states, form-field structure, table
toolbars, and responsive data presentation. Several are documented by example in
the catalog (`stories/patterns/`) without yet existing as components — a story
that hand-composes primitives with inline `style` is a pattern waiting to be
extracted, not a pattern that exists.

Patterns may expose slots and callbacks. They must not fetch data, name domain
entities, or decide which feature actions are allowed.
