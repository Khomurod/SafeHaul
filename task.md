# Task tracker — finish the "Driver File" landing redesign

Companion to `plan.md`. Tick each box as it lands so another agent can take over
mid-flight. **Delete both `plan.md` and `task.md` when everything below is ticked.**

Status key: `[ ]` not started · `[~]` in progress · `[x]` done · `[!]` blocked (say why)

---

## ⚠️ HANDOFF — read this first

Two files have **already been edited** in the working tree by the previous agent. They are
uncommitted, sitting on top of the (also uncommitted) redesign. Do not redo them; do
verify them with `git diff` before continuing.

1. **`functions/blog/publicApi.js` — COMPLETE.** The shared blog `<head>` (~L160-167) now
   emits `theme-color: #2B1D0E`, preloads `archivo-variable.woff2` + `courier-prime.woff2`
   instead of the deleted `inter-variable.woff2`, and links `styles.css?v=7`. A comment
   above it explains why the cache-buster must track the static pages. Section 1 below is
   fully ticked. Nothing else in `functions/` was touched.

2. **`landing/privacy.html` — PARTIAL, one edit only.** The `<h3>Sensitive Fleet & Driver
   Data</h3>` block in section 2 was rewritten: the `Motor Vehicle Records (MVRs)` and
   `Background checks and Clearinghouse results` list items are gone, the list now
   describes what SafeHaul actually stores, and an explicit paragraph was added saying
   SafeHaul does not order or receive MVRs, PSP reports, background checks or Clearinghouse
   results. **Everything else in privacy.html is untouched** — the remaining prohibited
   claims in section 3 and section 5 are still live. See §2 below for exactly what is left.

Nothing has been committed. No tests have been re-run since these two edits.

---

## 0. Baseline (already true before this work started — verified, do not redo)

- [x] `landing/index.html` fully rewritten, all 12 sections intact
- [x] `landing/assets/css/styles.css` rewritten, 21 sections, all tokens declared
- [x] All 28 blog-emitted CSS classes still styled with the new palette
- [x] `landing/assets/js/main.js` — tab scroll-spy + nine-step reveal added
- [x] `src/tests/landingPage.test.js` + `landingNewsSection.test.js` — 58/58 pass
- [x] `npm run check:landing-claims` passes on index.html + privacy.html
- [x] `landing/README.md` rewritten; new fonts on disk

---

## 1. Blog shell never migrated — `functions/blog/publicApi.js` (BLOCKER)

- [x] L163 — bump `styles.css?v=6` → `?v=7` (stops `/news` serving the cached OLD navy CSS)
- [x] L162 — replace the `inter-variable.woff2` preload (file is deleted → 404) with
      preloads for `archivo-variable.woff2` and `courier-prime.woff2`
- [x] L160 — `theme-color` `#004C68` → `#2B1D0E`
- [x] Leave the nav/footer markup alone — the `:has()` rule at `styles.css:2836` already
      covers the toggle-less blog header
- [x] Re-read the emitted `<head>` to confirm

## 2. `privacy.html` — only got a 3-line font swap (BLOCKER)

- [ ] L20 — `theme-color` `#004C68` → `#2B1D0E`
- [x] Section 2, "Sensitive Fleet & Driver Data" — MVR + Clearinghouse list items removed,
      replaced with what SafeHaul actually stores, plus an explicit "does not order or
      receive" paragraph. **DONE — do not redo.**
- [ ] Section 3, "How We Use Your Information" (~L125-128) — still says
      `FMCSA/DOT Verification: Automating expiration tracking (DQ files) and executing
      essential compliance dashboards`. PRODUCT.md bans document-expiry monitoring and any
      DOT-compliance guarantee; homepage FAQ 3 says the opposite. Reword to storage only
- [ ] Same block — `PEV Automations: ... with automated certificates` overclaims. PEV is
      real, but reword to "tracked requests and recorded responses"; drop "certificates"
- [ ] Section 5 (~L159) — `Infrastructure is structured to rapidly assist in organizational
      GDPR/Clean compliance` — PRODUCT.md bans the complete-GDPR-export claim. Reword
- [ ] L74 — "next-generation Applicant Tracking System (ATS)" opening line (old hyped voice)
- [ ] L151 — "At SafeHaul, trust is absolute." (old hyped voice)
- [ ] `og:image` is `logo.svg` — swap to `og-card.png` (`landingPage.test.js:200` forbids
      this on index; privacy is simply not covered by that assertion)
- [ ] Add `twitter:card` / `twitter:title` / `twitter:image`
- [ ] Add skip link + `id="main"` on the `<main>` element
- [ ] Refresh "Last Updated: March 2026"
- [ ] Replace footer inline styles; realign footer/nav markup with index.html
- [ ] `support@safehaul.io` → `info@safehaul.io`
- [ ] Rewrite meta description + opening lines out of the old hyped voice

## 3. `scripts/check-landing-claims.mjs` reports privacy.html clean when it isn't

- [ ] Tighten the patterns in `functions/ai/knowledge/safehaulCapabilities.js` (~L376-390):
      DQ-expiry word-order, the 40-char MVR/PSP gap, `Clearinghouse results`, and add a
      GDPR pattern
- [ ] Re-run `npm run check:landing-claims` — must now catch the pre-fix privacy.html
- [ ] Confirm it still passes once §2 is done

## 4. Accessibility gate has never run (BLOCKER for merge)

- [ ] `npx playwright install chromium`
- [ ] `npm run check:landing-a11y` (axe at 390/768/1440 on `/` and `/privacy.html`)
- [ ] Fix every violation it reports — no contrast decision in the new palette has been
      machine-checked yet, including the Darker-On-Gold Rule
- [ ] Confirm the FAQ-keyboard and dialog-focus-trap assertions pass

## 5. Design-contract gaps

- [ ] **Grain on 4 of 8 surfaces** — `styles.css:299` sets `position: relative` on eight
      selectors; only four get an overlay. Add grain to `.logos-section`, `.navbar`,
      `.story-tab`, or drop them from the group (visible seam under the hero)
- [ ] **Focus == invalid on modal inputs** — `styles.css:2652` vs `2659` are identical, and
      `outline: none` (0-2-1) beats global `:focus-visible` (0-1-1). Give focus its own mark
- [ ] **Tab rail inert across ~half the page** — scroll-spy only observes the 5 `#`-anchored
      targets; `#story-hire` / `#story-sign` / `#story-verify` already exist and are unused
- [ ] **Label the 4 unlabelled demo visuals** (hero screenshot, mobile app, edocs, signing)
- [ ] Remove orphans: `.grain-folder`, `.margin-rule`, `.typed`,
      `.news-index-header .news-meta`, token `--kraft-lit`, `.modal-form`
- [ ] Sprite symbols `i-rule` / `i-arrow` / `i-clip` — wire them or drop them
- [ ] `campaigns.png` + `super-admin.png` orphaned in the deploy artifact — use or remove
- [ ] `courier-prime-bold.woff2` declared at weight 700 but nothing requests 700
- [ ] Radius outliers: `99px` (L225), `0 0 4px 4px` (L502), `1px` (L975), `10px` (L985) —
      `.screenshot--phone` is the visible one
- [ ] Doc drift: add section 16b to the CSS table of contents; reconcile "section 15" in
      PRODUCT.md + `docs/news-and-insights.md` with "section 16"; fix `styles.css:30`
      ("sections 6 or 19" → 18)
- [ ] Anchor the Eleven-Pixel Floor test to the real section header, not the TOC entry at
      L48 (it currently passes by accident of string matching)

## 6. Logo decision

- [ ] `landing/assets/images/logo.svg` is still `#004C68` + `#0BE2A4` — navbar mark on
      goldenrod, footer mark on kraft, favicon, JSON-LD `logo`. Redraw in ink/rope, or
      confirm with the user that the clash is accepted

## 7. Housekeeping

- [ ] Decide whether `DESIGN.md` / `PRODUCT.md` / `.impeccable/design.json` are committed
      project docs (currently untracked — a `git clean` loses the design contract)
- [ ] `git add` the untracked fonts + `is-truckers.png` so they are not lost
- [ ] Add a `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` entry: the marketing site now runs its
      own system, deliberately separate from the app's `--ds-*` tokens (AGENTS.md requires it)

## 8. Final verification

- [ ] `npx vitest run src/tests/landingPage.test.js src/tests/landingNewsSection.test.js`
- [ ] `npm run check:landing-claims`
- [ ] `npm run check:landing-a11y`
- [ ] Preview `safehaul-landing` (port 4173); check `/` and `/privacy.html` at 390/768/1440
- [ ] Review the full diff
- [ ] **Delete `plan.md` and `task.md`**
