# Component catalog

This directory is the approved component catalog. It is built with **Storybook
10** (`@storybook/react-vite`), configured in `.storybook/` at the repository
root.

```bash
npm run storybook        # dev server on :6006
npm run build-storybook  # static build into storybook-static/ (also run in CI)
npm run test:stories     # renders every story and runs axe over each one
```

## What lives here

- `Introduction.mdx` — the catalog landing page: approval statuses, known
  primitive gaps, appearance policy, viewports, and the safety guarantees.
- `*.stories.jsx` — one file per documented component.
- `patterns/*.stories.jsx` — business-neutral page compositions.
- `fixtures.js` — the shared, deterministic fixture data.

Three story files live **outside** this directory, in
`src/shared/components/modals/`: `Modal` and `ConfirmDialog` (plus the modal-form
and typed-confirmation patterns built on them). They are colocated with the components they document
because the design system must not depend on `shared`, and those primitives have
not moved into `design-system/patterns` yet. Their catalog `title` still files
them under Components and Patterns. They move when `Modal` moves.

## Rules for stories in this directory

1. **Business-neutral vocabulary only.** The catalog documents the design
   system, so it must not know that SafeHaul has drivers, recruiters, carriers or
   signing requests. Fixtures say *record*, *owner*, *reference*.
2. **No feature imports, no Firebase, no network.** Enforced for everything in
   `src/design-system` by `../tests/architecture.test.js`.
3. **Deterministic only.** No `Math.random`, no `Date.now()`, no timers, no
   generated data. A story that renders differently on two runs is useless for
   review.
4. **Document honestly.** Every page states an explicit status — Approved,
   Needs review, or Temporary — and says what is unresolved. Do not mark
   something approved because it renders.
5. **Real APIs only.** Stories are written against the components' actual props.
   Unsupported values throw in most of these primitives, and the story test
   renders every story, so an invented prop fails CI.

## Catalog chrome

Layout scaffolding for stories (`sb-row`, `sb-grid`, `sb-specimen`, `sb-note`,
…) lives in `.storybook/catalog.css`, deliberately **outside** `src/`:
`tailwind.config.js` scans `./src/**` for class names, so a Tailwind utility
written only in a story would be compiled into the *application's* production
stylesheet. Story furniture must not grow the shipped CSS, and it is not an
approved design decision — nothing in the product may consume those classes.

## Status

The roadmap's Phase 11 catalog item is **still open**. `WorkspaceFrame` has no
story, reduced-motion has no dedicated story, and the statuses recorded on each
page are this campaign's honest reading rather than an owner-approved sign-off.
Visual regression baselines do not exist; see Phase 11 for what remains.
