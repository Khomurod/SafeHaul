---
paths:
  - "src/**/*.{jsx,css}"
  - "src/design-system/**"
  - ".storybook/**"
  - "tailwind.config.js"
  - "index.html"
---

# UI and design-system work

Applies to any UI, UX, styling, responsive, accessibility or visual-component
change.

1. **Read first:** `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` (the standard, its
   approved exceptions, its guardrails, the decisions still open) and
   `src/design-system/README.md` plus the docs of the components you touch.
2. **Who owns what.** The design system owns reusable appearance and interaction.
   Feature folders own feature content, available actions, domain vocabulary and
   domain-to-visual mapping. Hooks and services own data, state, integrations and
   business logic. Keep feature screens in their features.
3. **Reuse approved components and semantic `--ds-*` tokens.** Do not create a
   local button, modal, form control, table, status treatment, arbitrary colour,
   unsupported font size or competing visual primitive unless the roadmap records
   the missing capability and the code documents the temporary exception. No 9px
   or 10px body text.
4. **Update the roadmap in the same change** whenever you complete or change
   design-system work, and never mark an item complete without recorded
   implementation, behaviour-preserving tests, desktop (1440) and mobile (412)
   review where it applies, an accessibility and keyboard review, documentation,
   and a read of the final diff. Say honestly when a check could not run, and
   leave the item open.
5. **UI work must not change** Firebase rules, data structures, backend behaviour,
   integrations, permissions, routes, feature flags or business workflows unless
   the task separately justifies and approves that change.
6. **Guards to run:** `npm run check:ui-contract`, `npm run check:icon-contract`,
   `npm run test:stories`. Run `npm run check:visual-contract`,
   `npm run check:table-layout` and `npm run test:visual` (each needs
   `npm run build-storybook`) when components, tokens, styles or tables change.
