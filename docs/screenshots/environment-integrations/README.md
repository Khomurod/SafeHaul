# Environment & Integrations review screenshots

Captured 2026-08-02 from the **real** Super Admin view running under
`VITE_E2E_TEST_MODE=1`, driven with Chromium.

The inventory and reveal callables were stubbed at the network layer so the page
could render populated rows without a backend. **Every key, company and value in
these images is artificial** — the only revealed string is the literal
`demo-value-not-a-real-secret`. No real SafeHaul configuration appears in any of
them, and none was read to produce them.

| File | Shows | Width |
| --- | --- | --- |
| `desktop-masked-1440.png` | The default state: every value `********` | 1440 |
| `desktop-revealed-1440.png` | One value revealed, with its "Hides automatically in 30s" notice | 1440 |
| `desktop-unavailable-from-source-1440.png` | A GitHub Actions secret reporting "The source does not permit reading the saved value." | 1440 |
| `desktop-protected-row.png` | Permission summaries and action controls: protected rows show *No edit / No replace / No add / No delete* with greyed controls; the editable company credential shows *Reveal / Edit / Replace / Delete* | 1920 |
| `mobile-masked-412.png` | Mobile layout: stacked filters, full-width cards, the table's swipe hint, no page-level horizontal overflow | 412 (Pixel 7) |

`desktop-protected-row.png` is taken at 1920 so the whole column set fits without
the table's own horizontal scroll. At 1440 inside the Super Admin shell (which
spends 256px on the navigation rail) a nine-column table scrolls horizontally
**within its own container** — the approved `DataTable` behaviour, announced by
the swipe hint. The page itself never overflows; `e2e/super-admin-environment-integrations.spec.cjs`
asserts that at 1440, 1024, 768 and 412px.
