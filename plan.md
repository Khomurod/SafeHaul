# Finish the "Driver File" landing redesign

## Context

A previous agent ran the `impeccable` skill and rebuilt the marketing site around a new
north star — **"The Driver File"**: goldenrod folder stock, kraft board, form paper, rope
red, Archivo + Courier Prime. The work is **entirely uncommitted** in the working tree.
`HEAD` (4d4d96e) is still the old navy `#004C68` / mint `#0be2a4` / Inter site.

It got much further than a half-finished redesign. What it did **not** do is carry the new
design across the site's *other two surfaces* — `privacy.html` and the server-rendered blog
— and it left the accessibility gate unverified. Shipping as-is would deploy a site whose
homepage and `/news` pages visibly disagree.

## What is already done (verified)

- `landing/index.html` — full rewrite. All 12 sections from HEAD survive, none dropped
  (verified by diffing the section lists). New authored components: prong/exhibit sheet,
  nine-step reveal, activity logbook, index-tab nav.
- `landing/assets/css/styles.css` — 3041 lines, 21 sections, complete rewrite. All 21
  DESIGN.md colour tokens declared; no `color: var(--folder)` anywhere; no font-size
  below 11px; all five breakpoints present; reduced-motion and print survive.
- **Every CSS class the blog emits still has a new-palette rule** — I checked all 28
  (`.news-*`, `.navbar`, `.nav-*`, `.btn*`, `.footer-*`, `.skip-link`). Nothing dropped.
  The `:has()` fallback at `styles.css:2836` deliberately keeps blog nav reachable below
  968px where there is no mobile toggle. This was done carefully.
- `landing/assets/js/main.js` — IntersectionObserver tab scroll-spy and the nine-step
  reveal added, both guarded for the blog and for missing `IntersectionObserver`.
- `src/tests/*` updated; **58/58 pass** (I ran them).
- `npm run check:landing-claims` — **passes** on both pages (I ran it).
- `landing/README.md` rewritten accurately; new fonts on disk (Archivo 90 KB, Courier
  Prime 19 KB ×2); `.gitignore` ignores `.impeccable/review/`.

## Where it stopped — remaining work

### 1. The server-rendered blog was never migrated (blocker)

`functions/blog/publicApi.js` is **completely unmodified** — it is the shared shell for
`/news`, `/news/{slug}`, 404 and 500. Three defects, all verified by reading lines 160–163:

- **L163** links `styles.css?v=6`; `index.html` and `privacy.html` moved to `?v=7`.
  Firebase Hosting caches per full URL, so any returning visitor gets the **old navy
  stylesheet** on `/news` and the new one on `/`. This is the single highest-impact item.
- **L162** preloads `/assets/fonts/inter-variable.woff2`, **which this branch deletes** —
  a 404 on the critical path of every blog page. Neither new face is preloaded, so blog
  pages get a FOUT the homepage does not.
- **L160** `theme-color` still `#004C68`.

Fix: bump to `?v=7`, swap the preloads to `archivo-variable.woff2` + `courier-prime.woff2`,
set `theme-color` to `#2B1D0E`. Keep the nav/footer markup as-is — the CSS already handles it.

### 2. `privacy.html` got a 3-line font swap and nothing else (blocker)

Verified: the whole diff is the preload + `?v=7` lines. Its body classes
(`.privacy-hero`, `.policy-content`, `.policy-section`) *do* have new-palette rules, so it
will not look broken — but:

- **L20** `theme-color` still `#004C68` (verified).
- Audit reports it still **asserts capabilities PRODUCT.md forbids** — MVR / Clearinghouse
  data, DQ expiration tracking, GDPR compliance — which **directly contradicts** FAQ 3 and
  FAQ 4 on the homepage. *Verify this against the file first;* if it holds it is the most
  serious content problem here, because `check:landing-claims` reports the page `ok`.
- Consequently: **`scripts/check-landing-claims.mjs` has regex gaps** (patterns live in
  `functions/ai/knowledge/safehaulCapabilities.js`). Tighten them so the checker actually
  catches what it claims to, then re-run.
- Also: `og:image` is `logo.svg` (the exact thing `landingPage.test.js:200` forbids on
  index), no skip link, no `id="main"`, stale "Last Updated: March 2026", inline styles in
  the footer, `support@` vs `info@` mismatch, old hyped voice.

### 3. `logo.svg` is still the navy + mint mark (major, verified)

`landing/assets/images/logo.svg` is untouched — `#004C68` and `#0BE2A4` fills. It is the
favicon, the navbar mark **on goldenrod**, the footer mark **on kraft**, and the JSON-LD
`logo`. PRODUCT.md L104–106 explicitly puts the mark in scope for replacement. Every other
pixel moved; this did not. Needs a decision: redraw in ink/rope, or keep and accept the clash.

### 4. The accessibility gate has never run (blocker for merge)

`npm run check:landing-a11y` exits 1 — Playwright's Chromium is not installed locally
(I ran it; the script's error handling is correct, it is the browser that is missing).
So **no contrast decision in the new palette has been machine-checked**, including the
Darker-On-Gold Rule that DESIGN.md says "axe will catch". The passing unit tests only read
CSS as text; they cannot compute a ratio.

```bash
npx playwright install chromium
```

Then `npm run check:landing-a11y` at 390 / 768 / 1440 on both pages.

### 5. Design-contract gaps to close (major → minor, from audit, spot-check before acting)

- **Grain applied to 4 of 8 surfaces.** `styles.css:299` gives `position: relative` to
  eight selectors for a grain overlay; only four get one. `.logos-section` and `.navbar`
  sit flush against `.hero` on the same goldenrod, so the tooth visibly stops mid-field.
- **Focus and invalid are byte-identical** on modal inputs (`styles.css:2652` vs `2659`),
  and `outline: none` at specificity 0-2-1 beats the global `:focus-visible` at 0-1-1 —
  a just-focused field looks like a failed one. Breaks the Meaning Rule.
- **Tab rail goes inert across ~half the page** — the scroll-spy only observes the five
  `#`-anchored nav targets. `#story-hire/-sign/-verify` already have ids and are unused.
- **Four demo visuals unlabelled** (hero screenshot, mobile app, edocs, signing) against
  DESIGN.md's "label demonstration data as an illustration" rule.
- Minor: four orphaned selectors (`.grain-folder`, `.margin-rule`, `.typed`,
  `.news-index-header .news-meta`); unused token `--kraft-lit`; `.modal-form` has no rule;
  three unused sprite symbols (`i-rule`, `i-arrow`, `i-clip`); `campaigns.png` and
  `super-admin.png` orphaned in the deploy artifact; `courier-prime-bold.woff2` declared
  at weight 700 but nothing requests 700.
- Radius outliers vs the stated vocabulary (verified): `99px` scrollbar thumb (L225),
  `0 0 4px 4px` skip-link (L502), `1px` `.screenshot` (L975), `10px` `.screenshot--phone`
  (L985). Only the last is really visible inside a square-cut system.
- Doc drift: section 16b (Privacy) missing from the CSS table of contents; the blog block
  is called "section 16" in `styles.css` + README but "section 15" in PRODUCT.md and
  `docs/news-and-insights.md`. The `styles.css:30` header says "sections 6 or 19" where
  the TOC puts Footer at 18.
- **The Eleven-Pixel Floor test may be passing by accident** — it slices from the first
  occurrence of `'SafeHaul News & Insights'`, which is the TOC entry at L48, not the
  section header at L1928. Reordering one comment line would silently shrink its coverage
  to sections 16–21. Worth anchoring to the real header.

### 6. Housekeeping

- `DESIGN.md`, `PRODUCT.md`, `.impeccable/design.json`, the three font files and
  `is-truckers.png` are **untracked** — a careless `git clean` loses the redesign's
  contract and its fonts. Decide whether DESIGN.md/PRODUCT.md are committed project docs.
- `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` was not touched. AGENTS.md requires a roadmap
  entry for UI work; add one recording that the marketing site now runs its **own**
  system, deliberately separate from the app's `--ds-*` tokens.
- `.claude/launch.json` gained a `safehaul-landing` entry on port 4173 — use it to preview.

## Suggested order

1. `functions/blog/publicApi.js` head (item 1) — smallest diff, largest live impact.
2. `privacy.html` claims + chrome (item 2), then tighten `check-landing-claims` and re-run.
3. `npx playwright install chromium`, run `check:landing-a11y`, fix whatever axe reports.
4. Design-contract gaps (item 5), grain and focus/invalid first.
5. Logo decision (item 3), roadmap entry, then commit.

## Verification

```bash
npx vitest run src/tests/landingPage.test.js src/tests/landingNewsSection.test.js
npm run check:landing-claims
npm run check:landing-a11y
```

Plus: preview `safehaul-landing` (port 4173) and check `/` and `/privacy.html` at 390,
768 and 1440. The blog shell cannot be previewed statically — verify `publicApi.js` by
reading the emitted head, or run the functions emulator.
