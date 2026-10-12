---
paths:
  - "scripts/source-size*.mjs"
  - "scripts/test-source-size*.mjs"
  - "src/firestore.rules"
---

# Source size

- **Runtime code and tooling warn past 500 physical lines and are refused past
  700. Tests have no limit** (owner ruling). Physical lines on purpose: comments
  count. A file past 500 justifies its shape in review; the check names it, in
  CI as a GitHub warning. `npm run check:source-size` runs in the unskippable
  `callable-contract` job; `npm run test:source-size` tests the checker.
- **A test** is `*.test.*` or `*.spec.*`, anything in a directory named test,
  tests, __tests__ or e2e, and the tooling's own `scripts/**/test-*.mjs`.
- **Measured:** the JS/TS family plus `.css`, `.scss`, `.html`, `.rules`, `.vue`,
  `.svelte`. Unmeasured with a reason each (`UNMEASURED_FORMATS`): `.json`, `.md`,
  `.mdx`, `.yml`/`.yaml`. Every other tracked format is named in
  `NOT_SOURCE_FORMATS` (test A7), so a new format cannot arrive unclassified.
  Dotfiles count as their own format.
- **The only exclusion** is `public/pdf.worker.min.mjs` (vendored PDF.js). There
  is no exemption list, so nothing a branch edits can let a file through.
- **Agent instruction files are measured separately**, by
  `npm run check:agent-docs`.
- **What the checker must keep doing:** read `git ls-files -z` (NUL-delimited, so
  no path can hide), and assert that `src`, `functions`, `scripts`, `e2e`, `web`
  and `.storybook` all still yield files.
- **Known limitation:** `.github/workflows/main.yml` is over 1,000 lines and outside
  the measured roots. `check:ci-plan` pins its structure job by job instead.
