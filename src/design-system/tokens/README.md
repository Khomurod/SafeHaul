# Design tokens

SafeHaul uses two token levels:

- `foundation.css` contains raw, namespaced scales. Feature code should not
  normally consume palette tokens directly.
- `semantic.css` assigns UI meaning such as surface, content, action, status,
  focus, and table roles.

The `--ds-*` namespace prevents collisions with the temporary legacy variables
in `src/shared/styles/designTokens.css`. Tailwind exposes selected semantic
tokens with `ds-`-prefixed utilities. Existing utilities continue to work
until their feature area is migrated and verified.

Do not add body text below 12px. Do not add a raw color to a feature when an
appropriate semantic role exists; add or revise a semantic role with contrast
evidence instead.
