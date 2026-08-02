# Storybook catalog review screenshots

Captured 2026-07-29 from the production `npm run build-storybook` output, served
statically and driven with Chromium, as part of the catalog-foundation campaign.

| File | Story | Width |
| --- | --- | --- |
| `button-variants.png` | Components/Button → Variants | 1440 |
| `form-structure.png` | Components/Form structure → Section | 1440 |
| `datatable-default.png` | Components/DataTable → Default | 1440 |
| `back-nav-header.png` | Patterns/Back navigation and page header → Default | 1440 |
| `section-navigation.png` | Patterns/Section navigation and content → Default | 1440 |
| `filter-panel.png` | Patterns/Filter panel → Default | 1440 |
| `compact-table-desktop.png` | Patterns/Compact data table → Desktop viewport | 1440 |
| `compact-table-tablet.png` | Patterns/Compact data table → Tablet viewport | 1024 |
| `compact-table-mobile.png` | Patterns/Compact data table → Mobile viewport | 412 |
| `page-states-empty.png` | Patterns/Page states → Empty, no matches | 1440 |
| `page-states-error.png` | Patterns/Page states → Error, nothing loaded | 1440 |
| `modal-form.png` | Patterns/Modal form → Default | 1440 |

These are **review evidence, not baselines.** Nothing compares against them and
nothing fails if the UI changes. Approved visual-regression baselines remain an
open Phase 11 roadmap item; see `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`.

Every image renders only hand-written fixture data from
`src/design-system/stories/fixtures.js`. No production data appears in any of
them.
