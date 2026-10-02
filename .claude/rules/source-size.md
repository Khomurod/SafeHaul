---
paths:
  - "scripts/source-size*.mjs"
  - "scripts/test-source-size*.mjs"
  - "src/firestore.rules"
---

# Source size

- **500 physical lines is the hard limit** for every handwritten source file,
  tests and tooling included; at 400 a file must justify its shape in review.
  Physical lines on purpose: comments count. `npm run check:source-size`, in the
  unskippable `callable-contract` job; `npm run test:source-size` tests the
  checker.
- **Measured:** the JS/TS family plus `.css`, `.scss`, `.html`, `.rules`, `.vue`,
  `.svelte`. Unmeasured with a reason each (`UNMEASURED_FORMATS`): `.json`, `.md`,
  `.mdx`, `.yml`/`.yaml`. Every other tracked format is named in
  `NOT_SOURCE_FORMATS` (test A7), so a new format cannot arrive unclassified.
  Dotfiles count as their own format.
- **The only exclusion** is `public/pdf.worker.min.mjs` (vendored PDF.js).
- **The only documented exception** is `src/firestore.rules`: owner-ruled ceiling
  of 689 lines that may only move down (§G pins it).
- **Agent instruction files are measured separately**, by
  `npm run check:agent-docs`.
- **The backlog is gone** (drained 2026-09-01). The checker still compares any
  backlog against the base commit: an entry may never be added or raised, must
  record debt the base already carried, and a malformed count is refused. CI
  passes `--require-baseline`, so "no base found" is a refusal; locally the
  comparison is skipped with a printed reason.
- **What the checker must keep doing:** read `git ls-files -z` (NUL-delimited, so
  no path can hide), and assert that `src`, `functions`, `scripts`, `e2e`, `web`
  and `.storybook` all still yield files.
- **Known limitation:** `.github/workflows/main.yml` is over 1,000 lines and outside
  the measured roots. `check:ci-plan` pins its structure job by job instead.
