# SafeHaul marketing site redesign — implementation plan

**Status:** approved, not yet implemented.
**Direction:** A — "Specification" (approved by the owner).
**Mono face:** Geist Mono (approved).
**Audience for this document:** an agent or engineer picking this up cold, with no memory of the research session. Everything needed is here or named by path.

---

## 0. Current state — read this first

### What has already been done

| Change | Detail |
|---|---|
| `landing/assets/fonts/geist-mono-variable.woff2` **added** | 23,128 bytes. Latin subset, variable `wght 100–900`. Downloaded from `https://fonts.gstatic.com/s/geistmono/v6/or3nQ6H-1_WfwkMZI_qYFrcdmg.woff2` with the owner's explicit permission. Geist Mono is OFL — self-hosting and redistribution are permitted. Verified `wOF2` magic bytes. |

**Nothing else has been modified.** No HTML, CSS, JS, test, function or asset file has been touched. `git status` before this work began was clean on `main` at `9124f3d`.

### What has *not* been done

Everything in §4 onward. The two Courier Prime files are still present and still referenced.

### Prior decisions already taken with the owner (do not re-ask)

1. **Logo:** refine and build a lockup — recolour, optical correction against the wordmark, defined clear-space, a small-size variant and a monochrome variant. **Keep the existing four-shape geometry.**
2. **Photography:** **none.** Every visual is authored — SVG diagrams, workflow figures, typographic composition. No stock, no truck photos.
3. **News & Insights:** **edit the render layer** in `functions/blog/publicApi.js`. Markup and styling only. The generation pipeline, Firestore schema, scheduler, themes, sources, sanitiser, claim-checking, JSON-LD *data*, sitemap and feed are untouched.
4. **Direction:** A — Specification. Not B (Night Instrument), not C (Interstate).
5. **Mono:** Geist Mono, not Martian Mono.

---

## 1. What the product actually is (so copy stays true)

SafeHaul turns driver hiring into **one structured record per driver**: a nine-step DOT-shaped application, qualification documents held per driver, e-signature included and sealed, previous-employment verification sent and tracked. Two flat plans, **$199** and **$299**/month.

Two buyers: the **owner / safety director** who buys defensibility, and the **recruiter** who buys speed. Two non-buying audiences touch it: the **driver applicant** on a phone with bad signal, and the **past employer** answering through a rate-limited portal.

**Source of truth for claims:** `functions/ai/knowledge/safehaulCapabilities.js`. Read it before writing a single line of marketing copy.

**May never be claimed:** free forever · document-expiry monitoring or renewal reminders · MVR / PSP / FMCSA Clearinghouse checks · a job board · complete GDPR export · automated instant replies or drip sequences · lead distribution between companies · Telegram intake · any guarantee of FMCSA or DOT compliance · legal advice · **any named carrier endorsing SafeHaul**.

**Does not exist and must not be invented:** testimonials, quotes, customer counts, time-saved statistics, ROI figures, review ratings, funding, team size, uptime numbers, security certifications (there is no SOC 2 claim).

**Real evidence on hand:** four customer logos (STL Truckers, True Nation, I&S Transportation, TopHire Recruiting Agency) shown strictly as *carriers hiring on SafeHaul*, never as endorsing; seven fixture-tenant screenshots; a live daily blog.

The candour is a brand asset. Keep it. The FAQ answer beginning *"No software can do that, and anyone who says otherwise is selling you something"* is worth more than any testimonial and is also **test-enforced** (§8).

---

## 2. Architecture facts that constrain every decision

| Fact | Consequence |
|---|---|
| `landing/` is hand-written HTML/CSS/vanilla JS. **No build step, no framework.** | No React, no Tailwind, no npm packages, no bundler, no `type="module"`. Motion is CSS + IntersectionObserver + WAAPI. A test asserts the isolation. |
| `landing/assets/css/styles.css` is **shared with the server-rendered blog** | `functions/blog/publicApi.js` links the same stylesheet and emits `.navbar`, `.nav-link`, `.footer-section`, `.news-*` classes. Section 16 dresses `/news`; sections 6 and 18 dress its nav and footer. Nothing in 6, 16 or 18 may assume the homepage's markup exists. |
| `?v=7` cache-buster is **triplicated** | `landing/index.html:43`, `landing/privacy.html:35`, `functions/blog/publicApi.js:168`. Bump all three to `?v=8`. |
| The blog has **no mobile-menu toggle** | Section 20 currently uses `.navbar:not(:has(.mobile-menu-toggle)) .nav-links { … }` so blog nav stays reachable on a phone. Preserve an equivalent. |
| `/news` is a **Cloud Function**, not a static file | It cannot be viewed from the static dev server. See §9 for the fixture-render workaround. |
| Deploys are **coupled** | Because `publicApi.js` changes, the hosting deploy and the functions deploy must ship together. A hosting-only deploy serves the new stylesheet against old blog markup. |
| Fonts must be self-hosted | A test forbids `fonts.googleapis.com` and `fonts.gstatic.com` in markup. |
| "Super Admin → Landing Page Settings" controls **Telegram delivery + the lead list only** | There is no CMS. It controls no landing copy. Do not touch it. |

### Files that must NOT be touched

`functions/landingLead.js` · `functions/landing/*` (leads, telegram, config, callables) · the `landing_leads` collection · `src/features/super-admin/**` · `functions/blog/pipeline/**` · `functions/blog/scheduler.js` · `functions/blog/research/**` · `functions/blog/media/**` · `functions/ai/knowledge/safehaulCapabilities.js` · `scripts/check-landing-claims.mjs` · `firestore.rules` · `firestore.indexes.json` · `firebase.json` · `landing/robots.txt`.

---

## 3. The approved visual system — "Specification"

> The site is set as engineering documentation for a system that has to be inspected.

Not a blueprint, not paperwork, not nostalgia. **Modern technical documentation**: exploded assembly views, callout balloons on leader lines, dimension ticks, section marks, figure numbers, title blocks. The mechanism SafeHaul sells — four scattered artifacts becoming one inspectable assembly — is literally what an exploded parts diagram depicts.

### 3.1 Tokens (final — contrast already verified)

```css
:root {
  /* Grounds */
  --paper:        #F7F7F5;  /* page ground — cool-neutral, ~2% warm. NOT cream, NOT parchment. */
  --paper-2:      #EDEEEC;  /* recessed panels, table header rows */
  --paper-3:      #E4E6E3;  /* pressed / active states on paper */

  /* Graphite — ink, primary action, inverted grounds */
  --graphite:     #14161A;  /* 17.0:1 on --paper */
  --graphite-2:   #1E2126;  /* raised panel on a graphite ground */
  --graphite-3:   #2A2E34;  /* pressed state on graphite */

  /* Ink on paper */
  --ink:          #14161A;  /* headings                       17.0:1 */
  --ink-2:        #4B5157;  /* body copy                       7.4:1 */
  --ink-3:        #6B7278;  /* captions, metadata              4.6:1 */

  /* Ink on graphite */
  --ink-on-dark:   #F1F3F2; /* headings                       ~16:1  */
  --ink-on-dark-2: #A8B0B6; /* body                            8.3:1 */
  --ink-on-dark-3: #838C93; /* captions                        5.4:1 */

  /* Rules */
  --rule:          #DADCD9; /* hairline on paper */
  --rule-strong:   #C3C7C3; /* table dividers, stronger separation */
  --rule-on-dark:  #333940;

  /* The drawn line + the three meanings. Colour NEVER decorates. */
  --draft:        #2C4A9A;  /* drawn lines, leaders, links, focus ring   7.7:1 */
  --draft-soft:   rgba(44, 74, 154, 0.10);
  --clear:        #0F5F4C;  /* verified / complete                       7.1:1 */
  --clear-soft:   rgba(15, 95, 76, 0.10);
  --attend:       #A93226;  /* attention / required                      6.2:1 */
  --attend-soft:  rgba(169, 50, 38, 0.10);

  /* Type */
  --font-display: 'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-body:    'Archivo', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono:    'Geist Mono', ui-monospace, 'Cascadia Mono', 'SFMono-Regular', monospace;
  --font-size-base: 16px;

  /* Layout */
  --measure:          1180px;
  --gutter:           24px;
  --section:          112px;
  --section-tight:    76px;
  --radius-control:   2px;
  --radius-panel:     3px;

  /* Elevation — flat by default. Shadows only for genuinely floating things. */
  --shade-1: 0 1px 2px rgba(20, 22, 26, 0.06);
  --shade-2: 0 8px 24px -12px rgba(20, 22, 26, 0.24), 0 2px 6px -2px rgba(20, 22, 26, 0.08);
  --shade-3: 0 32px 64px -24px rgba(20, 22, 26, 0.34), 0 8px 20px -12px rgba(20, 22, 26, 0.18);

  /* Motion */
  --ease-out:  cubic-bezier(0.23, 1, 0.32, 1);
  --ease-seat: cubic-bezier(0.16, 0.84, 0.30, 1);
  --t-fast:    0.14s;
  --t-base:    0.22s;
  --t-slow:    0.32s;
}
```

**Deleted tokens** (every occurrence must go): `--folder`, `--folder-lit`, `--folder-tab`, `--folder-deep`, `--kraft`, `--kraft-rule`, `--sheet`, `--sheet-alt`, `--sheet-rule`, `--sheet-edge`, `--ink-soft`, `--ink-faint`, `--ink-on-kraft`, `--ink-on-kraft-soft`, `--rope`, `--rope-deep`, `--rope-soft`, `--stamp`, `--stamp-lit`, `--verified`, `--grain-fine`, `--grain-coarse`, `--lift-1..4`, `--ease-place`, `--t-normal`, `--radius-tab`, `--radius-sheet`, `--max-width`, `--section-padding`, `--section-padding-tight`.

### 3.2 Named rules (these replace the old world's rules)

1. **The Drawn-Line Rule.** Structure is drawn in `--graphite` and `--rule`. `--draft` is a *line* colour — leaders, dimension ticks, focus rings, inline links. It never fills a region behind text.
2. **The Meaning Rule** *(carried over)*. `--clear` = verified/complete. `--attend` = attention/required. `--draft` = the drawn line and the link. No fourth meaning, and none of the three is ever used decoratively.
3. **The Black-Action Rule.** The primary CTA is `--graphite`, not a brand colour. On a graphite ground it inverts to `--paper` fill with `--graphite` text. There is no brand colour on this site.
4. **The Typed-Things Rule** *(carried over, re-pointed)*. Geist Mono is for what a technical document types or numbers: figure numbers, dimensions, section numbers, table headers, timestamps, prices, revision codes, source citations. **Never for prose.**
5. **The Eleven-Pixel Floor** *(carried over)*. No text below 11px (`0.6875rem`) anywhere. Test-enforced from stylesheet section 16 onward.
6. **The Illustration Rule** *(carried over)*. Any demonstration data a visitor could mistake for a real driver record is labelled as an illustration.
7. **No ambient decoration.** No gradients, no glow, no glassmorphism, no noise/grain overlay, no coloured card shadows, no pills, no radius above 4px, no icon-in-a-circle.

**Retired rules** (they existed only to compensate for the goldenrod ground): The Ground Rule, The Darker-On-Gold Rule, The Material Rule.

### 3.3 Typography

**Archivo is retained** (already at `landing/assets/fonts/archivo-variable.woff2`, variable `wght 400–800` + `wdth 75–125`) but **completely re-voiced**. The old site set display at `wdth 88 / wght 800`, which reads as a filing-drawer plate. That is the register being left.

| Role | Spec |
|---|---|
| Display (h1 only) | Archivo, `font-variation-settings: 'wdth' 100, 'wght' 620`, `clamp(2.75rem, 4.6vw, 4.25rem)`, line-height `1.05`, letter-spacing `-0.02em`. Left-aligned, ~half measure, never centred. |
| Headline (h2) | Archivo, `'wdth' 100, 'wght' 600`, `clamp(1.75rem, 2.6vw, 2.5rem)`, line-height `1.12`, letter-spacing `-0.016em`. |
| Title (h3, card/row headings) | Archivo, `'wdth' 100, 'wght' 600`, `1.1875rem`, line-height `1.3`, letter-spacing `-0.008em`. |
| Body | Archivo `400`, `1.0625rem`, line-height `1.6`, `max-width: 68ch`. |
| Engineered label | **Geist Mono** `500`, `0.75rem`, `letter-spacing: 0.06em`, `text-transform: uppercase`. |
| Data / numerals | Geist Mono `400–500`, `font-variant-numeric: tabular-nums`. |
| Condensed label (optional) | Archivo `'wdth' 88, 'wght' 600` — reserved for dimension text and table headers where condensed reads as instrument lettering. |

`@font-face` for the new face:

```css
@font-face {
  font-family: 'Geist Mono';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('/assets/fonts/geist-mono-variable.woff2') format('woff2-variations');
}
```

### 3.4 The signature device — the margin rule

The strongest single thing separating this from "generic minimal SaaS". A technical drawing has a ruled margin carrying the sheet number.

- Every major section opens with a **2px `--graphite` rule** running the full measure.
- Immediately under it, a **title block row**: mono section number (`01`, `02`, …) and a mono section label on the left; the `h2` below, at measure.
- At `≥1180px`, section numbers hang **outside** the measure in the left margin, `position: absolute`, `--ink-3`, mono. Below that they sit inline in the title block row.
- This is a ruled block, not a floating pill eyebrow. Do not build an eyebrow chip.

### 3.5 Motion grammar — "parts seat into position"

One grammar for the whole site.

| Case | Spec |
|---|---|
| Section / element reveal | `translateY(10px)` + `opacity 0→1`, `320ms`, `var(--ease-out)`, **stagger 60ms**, fired **once** by IntersectionObserver (`threshold: 0.2`), then unobserved. |
| Leader-line draw (figures) | `stroke-dashoffset` → 0, `480ms`, `var(--ease-seat)`. |
| Hero assembly seat | Four plates travel down their leaders and seat: **520ms total, 60ms stagger**, `var(--ease-seat)`, then the `--clear` check fades in. Runs once on load. |
| Hover | `140ms`, `ease`. Gate behind `@media (hover: hover) and (pointer: fine)`. |
| Button `:active` | `transform: scale(0.98)`, `120ms`. |
| FAQ open | See §6.4 — must keep the `hidden` attribute. Short `opacity` + `translateY(-4px)` keyframe on reveal. |
| Modal | Overlay `opacity` + `visibility 0s`; container `scale(0.98) → 1` + opacity, `220ms`, `var(--ease-out)`. **Never `scale(0)`.** `transform-origin: center` (modals are exempt from origin-awareness). |

**Banned:** parallax, scroll-hijacking, counting-up numbers, infinite loops, `transition: all`, `ease-in` on any UI element, animating `width`/`height`/`margin`/`padding`.

`prefers-reduced-motion: reduce` keeps opacity transitions and removes every transform. The stylesheet must retain a block containing `animation-duration: 0.001ms` (test-enforced).

---

## 4. File-by-file work orders

### 4.1 `landing/assets/fonts/`

- **Delete** `courier-prime.woff2` and `courier-prime-bold.woff2` (37,988 bytes total).
- `geist-mono-variable.woff2` is already present.
- Net weight change: **−14,860 bytes**.

Do the deletion **after** the test in §8 has been updated, or `npx vitest run src/tests/landingPage.test.js` will fail on the existence check in the meantime.

### 4.2 `landing/assets/css/styles.css` — full rewrite

Keep the **21 numbered sections** and their numbering; the blog and a test both depend on the structure. Keep the file's leading block comment but rewrite it to describe the new world and the same three architectural warnings (shared with the blog / no app code / claims).

| § | Title | Notes |
|---|---|---|
| 1 | Tokens | The `:root` block from §3.1 verbatim. |
| 2 | Reset, base and browser surfaces | Keep `*{margin:0;padding:0;box-sizing:border-box}`. Keep `[hidden]{display:none !important}` (**test-enforced**). `html{ scroll-behavior:smooth; scroll-padding-top:96px; color-scheme:light; accent-color:var(--graphite); caret-color:var(--graphite); }`. `body{ background:var(--paper); color:var(--ink-2); overflow-x:hidden; }`. Theme selection, scrollbar and focus-ring styling from the new palette. Both `@font-face` blocks (Archivo + Geist Mono), each with `font-display: swap` (**test-enforced**). |
| 3 | Typography | The scale from §3.3. `h1/h2/h3` variation settings. `p{max-width:68ch}`. `.mono` utility. |
| 4 | Utilities | `.visually-hidden`, `.skip-link` (with `.skip-link:focus{top:0}` — **test-enforced**), `.section-shell` (the `padding-inline: max(var(--gutter), (100% - var(--measure)) / 2)` pattern), `.rule`, `.measure`. |
| 5 | Buttons | `.btn` must contain `min-height: 44px` within the first 300 chars of its block (**test-enforced**). Variants `.btn-primary` (graphite fill, paper text), `.btn-secondary` (1px graphite border, transparent), `.btn-outline`, `.btn-ghost`, `.btn-lg` (52px), `.btn-block`. `border-radius: var(--radius-control)`. `:active{transform:scale(0.98)}`. On graphite grounds, `.btn-primary` inverts to paper fill. |
| 6 | Navigation | **Shared with the blog — must not assume homepage markup.** `.mobile-menu-toggle` must contain `height: 44px` within 300 chars (**test-enforced**). Slim paper bar, 1px `--rule` bottom edge, `[data-scrolled="true"]` thickens to 2px `--graphite` and adds `--shade-1`. `.nav-link[aria-current="true"]` draws a 2px `--graphite` underline. No pills. |
| 7 | Hero | Asymmetric two-column grid, left-weighted (`minmax(0, 1.05fr) minmax(0, 1fr)`). Keep the wrapper class **`hero-visual`** (see §8 gotcha). |
| 8 | Logo strip | Hairline-ruled row, mono label, marks normalised to one optical height (`max-height` on the `img`, `filter: grayscale(1)` at ~`opacity:.72`, full colour on hover). |
| 9 | Inspection frame | Two-column spread; ruled list left, figure right. |
| 10 | Platform — specification rows | Ruled rows: `grid-template-columns: 3.5rem minmax(0,14rem) minmax(0,1fr)` → mono index / key / value. 1px `--rule` between rows, 2px `--graphite` above the first. |
| 11 | Story blocks | Alternating two-column. `.story--reverse`. Figure and text swap sides. |
| 12 | Trust band | `--graphite` ground, `--ink-on-dark*` type, `--rule-on-dark` hairline grid. |
| 13 | Comparison | Specification table. `--paper-2` header row, mono headers, 1px `--rule-strong` dividers, `.highlight-col` marked by a 2px `--graphite` leading rule (not a colour fill). |
| 14 | Pricing | Two ruled tables side by side. `.price-card--premium` marked by a 2px `--graphite` leading rule and a mono tag flush to it. **No floating badge pill.** |
| 15 | FAQ | Hairline-separated rows. See §6.4. |
| 16 | **SafeHaul News & Insights (shared with the blog)** | The divider comment must match `/\*\s*16\.\s*SafeHaul News & Insights` exactly — **a test greps for it** and slices from there to check the 11px floor. See §7 for the full contract. |
| 16b | Privacy policy | `privacy.html` only. |
| 17 | Closing CTA | `--graphite` full-bleed band, inline form. |
| 18 | Footer | **Shared with the blog.** `--graphite` ground, four columns, hairline rules, mono headings. |
| 19 | Lead modal | `.modal-overlay.active` must contain `visibility: visible`, and the overlay's `transition` must include `visibility 0s;` (**both test-enforced**). `.honeypot-field` must contain `position: absolute` (**test-enforced**). |
| 20 | Responsive | Breakpoints **1024, 768 and 480 must all exist literally** (**test-enforced**), plus 1180 and 720 as needed. Keep a `:has()`-based or equivalent rule so the blog's toggle-less nav stays reachable on a phone. |
| 21 | Reduced motion and print | Must contain `@media (prefers-reduced-motion: reduce)` with `animation-duration: 0.001ms` (**test-enforced**). Keep a `@media print` block. |

### 4.3 `landing/index.html` — full rewrite

Full section spec in §5.

### 4.4 `landing/assets/js/main.js` — targeted edits

Detail in §6. Most of this file survives unchanged and is genuinely well written — do not rewrite it wholesale.

### 4.5 `landing/privacy.html`

Restyle into the new system. Keep: its own canonical (`https://safehaul.io/privacy.html`), `href="/#get-started"`, and **no** `id="leadModal"` and **no** `js-open-lead-modal` (all test-enforced). Update its font preloads and `?v=8`.

### 4.6 `functions/blog/publicApi.js` — markup only

Detail in §7.

### 4.7 Brand assets

- **`landing/assets/images/logo.svg`** — currently hardcodes `#17130e` (three shapes) and `#b03a24` (one shape). Recolour to `--graphite #14161A` and `--attend #A93226`. Correct optical alignment against the wordmark. Keep the geometry.
- **New:** a monochrome variant for the graphite footer and the favicon (`logo-mono.svg`, single-colour, `currentColor` where possible).
- **Lockup:** define clear-space (recommend 0.5× mark height on all sides) and a small-size variant. Document both in `DESIGN.md`.
- **`landing/assets/images/og-card.png`** — regenerate at exactly 1200×630 in the new world. It must remain a real raster (test-enforced) and `og:image:width` must stay `1200`.
- **Screenshots** — keep `pipeline.png`, `driver-application-mobile.png`, `edocs.png`. Drop references to `dashboard.png` and `signing-consent.png` where an authored figure replaces them. Delete the two already-orphaned files `campaigns.png` and `super-admin.png` plus their entries in `scripts/capture-landing-screenshots.mjs`. **Remove the `mix-blend-mode: multiply` + `saturate(0.88)` treatment entirely** — screenshots render at true colour in a plain 1px `--rule-strong` frame with a mono caption.
- **`landing/assets/images/news-fallback.svg`** — restyle to the new palette. It must keep `role="img"`, `aria-label="SafeHaul News and Insights"`, `viewBox="0 0 1200 630"`, and contain no external references and no `<script>` (all test-enforced).

---

## 5. `landing/index.html` — section-by-section spec

### 5.0 Head

- Keep every existing meta tag, canonical, OG and Twitter tag, and the JSON-LD `@graph` **unchanged in content** — the `199`/`299` offers must keep matching the visible prices (test-enforced).
- `theme-color`: change `#2B1D0E` → `#14161A`.
- Preloads: `archivo-variable.woff2` and `geist-mono-variable.woff2`. **Remove** the Courier Prime preload.
- Stylesheet: `?v=8`.
- **Hero image preload:** the hero no longer contains a screenshot, so `<link rel="preload" as="image" … pipeline.png … fetchpriority="high">` must be **removed** — and the test asserting it must be rewritten (§8).

### 5.1 Direction contract comment

Replace the existing `THESIS:` comment block as the first child of `<body>`. Five blocks, ≤150 words, plus the FINISH line:

```
THESIS: … the one idea this surface owns, and the arrangement it refuses.
OWN-WORLD: paper and graphite technical documentation; Archivo + Geist Mono;
           colour only ever carries meaning; the action is near-black.
STORY: what the visitor understands, believes and does.
FIRST VIEWPORT: exact composition, what is where, at what scale, where the action sits.
FORM: Specification, candidate 1 of 7, seed 766c53d6.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
```

### 5.2 Icon sprite

Keep the inline `<svg class="icon-sprite">` pattern. Redraw to the new grammar: **1.75px stroke**, `stroke-linecap: square`, `stroke-linejoin: miter`. Symbols needed: `#i-check`, `#i-seal`, plus any new ones the figures require. One stroke weight across the whole site.

### 5.3 Nav

Structure and IDs unchanged from the current file. Links: Platform (`#features`) · Why SafeHaul (`#why-safehaul`) · Pricing (`#pricing`) · News & Insights (`/news`) · FAQ (`#faq`) · Contact (`#footer`).

**Exact string required by a test:**
```html
<a href="/news" class="nav-link">News &amp; Insights</a>
```

Keep `id="mobileMenuToggle"` with `aria-expanded="false"` and `aria-controls="navLinks"`.

### 5.4 Hero

- `<h1>Hire drivers without losing the paperwork.</h1>` — **keep this headline.** It is good, claim-safe, and it is the only `<h1>` on the page (test-enforced: exactly one).
- Subtitle: keep the existing sentence or a claim-equivalent rewrite.
- Actions: `[Get started]` (`.btn .btn-primary .btn-lg .js-open-lead-modal`) and `[See how it works]` (`.btn .btn-outline .btn-lg` → `#features`).
- Note line: "Built for US trucking carriers. Two flat monthly plans, no per-signature fees."
- **Right column: `<figure class="hero-visual">`** containing **FIGURE 1** (§5.13). Keep the class name `hero-visual` — a test slices the document on it.
- **No `<img>` in the hero.**

### 5.5 Proof strip

`<section class="logos-section" aria-label="Carriers hiring on SafeHaul">`. Keep the string `logos-section` — a test slices on it. Keep the four marks with their existing intrinsic `width`/`height` attributes and `loading="lazy"`. Keep the wording "Carriers hiring on SafeHaul" — never "trusted by", never "our customers love".

### 5.6 The inspection frame *(replaces the three Loose/Unsigned/Unverified cards)*

Section number `01`. Headline: **"Someone will ask to see the file."**

Two-column spread. Left: a ruled list of the four things an auditor asks for. Right: **FIGURE 2** — a section view showing which of those typically live in different systems. Copy must stay inside the allowlist: describe the *problem*, not a compliance guarantee.

### 5.7 Platform *(replaces `.manifest`)*

`id="features"` — **required, test-enforced.** Section number `02`. Headline: "One platform, from first contact to a complete driver file." Sub: "Every capability below is in the product today."

Six specification rows, mono index `01`–`06`:

| # | Key | Value (existing copy is approved — reuse) |
|---|---|---|
| 01 | Driver applicant tracking | Nine-step application + recruiter pipeline. Carries the `pipeline.png` exhibit, `FIG. 01`. |
| 02 | Documents, per driver | Server-issued links checked against company membership. |
| 03 | Electronic signature, included | Signed in a browser without an account, sealed copy back, no per-envelope charge. |
| 04 | Previous-employment verification | Tracked responses, results behind a checked link. |
| 05 | Start from a licence photo | CDL auto-fill, every extracted value shown to the driver to confirm. |
| 06 | Reporting on your pipeline | Counters maintained as activity happens. |

### 5.8 Story 1 — Apply

`data-tab="features"` (keeps the Platform tab lit through the stories — the scroll-spy depends on it). Section number `03`. Headline: "The application survives a bad signal." Keep the existing body paragraph and the three `.story-list` items.

- **FIGURE 3** — the queue/retry timing diagram.
- The nine steps as `<ol class="steps" id="applicationSteps">` — keep the id and the nine labels; the reveal script depends on it.
- Screenshot: `driver-application-mobile.png`, mounted, `loading="lazy"`.

### 5.9 Story 2 — Sign

`data-tab="features"`. Section number `04`. Headline: "Paperwork signed and sealed, with no envelope bill." Keep the body and the three list items.

- **FIGURE 4** — the seal detail drawing. Replaces the handwriting scribble entirely.
- Screenshot: `edocs.png`, mounted, `loading="lazy"`.

### 5.10 Story 3 — Verify

`data-tab="features"`. Section number `05`. Headline: "A record of what was asked, and what came back."

- **FIGURE 5** — the verification round-trip sequence.
- **The row board** — replaces `.logbook`. Fixed columns, five timestamped rows, mono, tabular numerals, states cascading left→right on reveal at 24ms per cell. Footer line naming it an illustration.
- **Keep the `.story-caveat` paragraph verbatim.** It contains `does not track their dates`, which a test requires:
  > "SafeHaul stores and organises qualification documents. It does not track their dates for you — that stays your process, and we would rather say so than imply a safety net that is not there."

### 5.11 Trust band — "What holds up under inspection"

`--graphite` ground. Section number `06`. Four mechanism statements on a hairline grid, no icon circles. Reuse the existing four (tenant separation by database rules · tamper-evident sealing · never public URLs · actions leave a trail) — all four are in the allowlist.

### 5.12 Comparison · Pricing · News · FAQ · CTA · Footer

| Section | Required ids / strings |
|---|---|
| Comparison | `id="why-safehaul"` **(test-enforced)**. Keep the scrollable wrapper `tabindex="0" role="region"` with its `aria-label` as a fallback; add a per-capability stacked layout below 768px. |
| Pricing | `id="pricing"` **(test-enforced)**. `199` and `299` must appear as visible text. Keep every feature line and the footnote — the footnote carries `your own messaging provider` and `Two-way message threads … not`, both test-enforced. |
| News strip | `id="newsGrid"` + `id="newsLoading"` + `aria-live="polite"` + `aria-busy="true"`. Must contain the literal `SafeHaul News &amp; Insights`. Must **not** contain the string `news-card-excerpt`. Must contain exactly: `<a href="/news" class="btn btn-secondary">View all articles</a>`. |
| FAQ | `id="faq"` **(test-enforced)**. Six `<button class="faq-question">`, each with `aria-expanded="false"` and `aria-controls="faq-a\d+"`. Each `.faq-answer` carries the `hidden` attribute. **Keep all six answers verbatim** — answer 1 contains `no software can do that`, answer 3 contains `it does not monitor`, answer 5 contains the messaging limitations. All test-enforced. |
| Closing CTA | `--graphite` band. Headline + **the two-field form inline** (`fullName`, `workEmail`, honeypot) posting the same step-1 payload to `/api/landing-lead`. Give its fields distinct ids (e.g. `ctaFullName`, `ctaWorkEmail`, `ctaWebsite`) so the modal's ids stay unique. |
| Footer | `id="footer"` **(test-enforced)**. Must contain `href="/news"` and `href="/privacy.html"`. Keep the disclaimer. |
| Lead modal | Keep the entire structure, every id, the honeypot, both steps, `#skipStepTwo`, `#formStatus[role="status"]`, `.field-error`. **Restyle only — zero behavioural change.** |

### 5.13 The six authored figures

All inline SVG. One grammar: **1.25px hairlines, 1.75px emphasis, square caps, mitre joins**, no fills except `--graphite`/`--clear`/`--attend`, 18px callout balloons with mono numerals, leader lines that break at right angles rather than curving. Give every figure `role="img"` and an `<title>` (or `aria-label`) that describes it.

> ⚠️ **Text inside an SVG is page copy.** The claims test strips tags and keeps text nodes, so any `<text>` or `<title>` in a figure is checked against the capability allowlist. Keep figure labels factual and generic.

| Figure | Where | What it draws |
|---|---|---|
| **1 — Exploded assembly** | Hero | Four labelled plates (Application · Documents · Signature · Employment history) suspended on leader lines above one assembled record plate. Balloon callouts ①–④, dimension ticks. On load the plates travel down their leaders and seat (520ms, 60ms stagger), then a `--clear` check lands. **Needs a second `viewBox` variant for ≤720px with vertical leaders — do not squash the desktop figure.** |
| **2 — Section view** | Inspection frame | A cutaway showing the four artifacts sitting in *different* systems, with the gaps dimensioned. |
| **3 — Queue / retry timing** | Apply | Horizontal time axis. Connection dropouts as gaps, submission attempts as ticks, and the deterministic-ID dedupe drawn as two attempts collapsing into one record. |
| **4 — Seal detail** | Sign | An enlarged callout of a sealed document with a leader and a mono note about tamper-evidence. |
| **5 — Verification round-trip** | Verify | A sequence: request → delivery → reminder cycle → response → stored result, with the rate-limited portal drawn as a real element. |
| **6 — Pipeline small-multiple** | Platform row 06 *(optional)* | A restrained data figure of where candidates enter and drop out. Label it an illustration. |

**Build Figure 1 first and judge it before building past it.** The whole direction rests on figure quality; a weak hero figure collapses this into a generic minimal SaaS site.

---

## 6. `landing/assets/js/main.js` — what changes

Most of this file is good and stays. Do not rewrite it wholesale.

### 6.1 Keep unchanged

- Navbar `data-scrolled` scroll listener (passive).
- The IntersectionObserver scroll-spy setting `aria-current`, including the `[data-tab]` handling. Update `rootMargin` from `-124px 0px -55% 0px` to match the new nav height (~`-96px`).
- Mobile menu open/close, `aria-expanded`, `aria-label`, Escape handling.
- The nine-step reveal (`#applicationSteps`), including the `prefers-reduced-motion` and `IntersectionObserver`-availability guards.
- **The entire lead modal block** — `trapFocus`, `requestAnimationFrame` focus, `validateStep`, `showStepTwo`, `showSuccess`, `resetModal`, `openModal`, `closeModal`, `attribution`, `postLead`, `withPendingButton`, the submit handler, `#skipStepTwo`, and the `#get-started` hash handling.
- **The entire news fetch block.** Several exact strings are test-enforced — see §8.

### 6.2 Add

- **A generic reveal observer.** Observes `[data-reveal]`, adds `data-revealed="true"` once, unobserves. Stagger via `--reveal-index` custom property or `nth-child` delay. Guarded by `prefers-reduced-motion` and `'IntersectionObserver' in window`.
- **The hero assembly seat.** Runs once on `DOMContentLoaded`; skipped entirely under reduced motion (final state applied immediately).
- **The row board cascade** in the Verify section — 24ms per cell, once, on reveal.
- **The inline CTA form handler.** Reuse `attribution()`, `postLead()`, `validateStep()` and `withPendingButton()`. Post the same step-1 payload. On success, swap the form for a short confirmation in place. Must not use `alert(` (test-enforced) and must report errors inline.

### 6.3 Remove

Nothing structural. If any selector referenced only old markup, re-point it.

### 6.4 FAQ — important constraint

A test requires **both**:
- `html` matches `class="faq-answer"[^>]*hidden`
- `css` matches `\[hidden\]\s*\{[^}]*display:\s*none\s*!important`

`display: none` cannot be transitioned, so the `grid-template-rows: 0fr → 1fr` approach originally sketched **will not work** alongside the `hidden` attribute. **Keep the `hidden` mechanism** — it is the accessibility hardening this page was fixed to have — and animate the reveal with a short keyframe (`opacity` + `translateY(-4px)`, ~240ms, `var(--ease-out)`) applied when the answer becomes visible. This is a deliberate amendment to the Phase 1 sketch; the reason is recorded here so it is not "fixed" later by someone who does not know why.

---

## 7. `functions/blog/publicApi.js` — News & Insights render layer

**Markup and styling only.** Do not touch routing, Firestore reads, `renderBlocksToHtml`, `sanitize`, `renderJsonLd`'s *data*, `renderAtomFeed` or `renderSitemap`.

### 7.1 `renderPage` (the shared shell, ~line 140)

- Font preloads → `archivo-variable.woff2` + `geist-mono-variable.woff2`. Remove Courier Prime.
- `?v=7` → `?v=8` (line ~168).
- `theme-color` `#2B1D0E` → `#14161A`.
- Nav markup rebuilt to match the homepage exactly — same classes, same link set, `aria-current="page"` on News. **The blog has no mobile-menu toggle**; either add one (and the matching script) or preserve the `:has()`-based responsive rule in stylesheet section 20. Pick one and document it.
- Footer rebuilt to match the homepage's graphite footer.

### 7.2 `renderIndexPage`

Asymmetric two-column: a sticky theme rail on the left, ruled article rows on the right, the first article given a larger figure.

> ⚠️ **Constraint:** a test asserts `.news-grid` collapses to `repeat(2, 1fr)` at `max-width: 1024px` and `1fr` at `max-width: 768px`. So `.news-grid` must remain a **multi-column grid**. Implement the asymmetric index layout as a wrapper *around* `.news-grid` (e.g. `.news-index-layout`), or give the index a modifier class and keep `.news-grid`'s column behaviour intact. Do not remove the grid columns from `.news-grid`.

### 7.3 `renderArticlePage`

- Real article header: theme, title, date, author, reading time.
- Body at a **68ch measure**; figures allowed to break the measure.
- `--rule` section dividers.
- Sources as a **numbered mono apparatus**. `.news-sources a` must keep `word-break: break-word` (test-enforced).
- Keep the About block, the disclaimer and the back link.
- At `≥1200px`, a right-margin metadata column.

### 7.4 `renderCard`

Becomes a ruled entry rather than a boxed card. Keep the class names `.news-card`, `.news-card-image`, `.news-card-body`, `.news-eyebrow`, `.news-card-excerpt`, `.news-meta`, `.news-read-more` — they are shared with the homepage strip built by `main.js`, and several are test-enforced.

---

## 8. The test contract — exact, assertion by assertion

Run: `npx vitest run src/tests/landingPage.test.js src/tests/landingNewsSection.test.js src/tests/hostingConfig.test.js`

### 8.1 `src/tests/landingPage.test.js` — assertions that MUST change

| Line | Assertion | Required change |
|---|---|---|
| ~137–148 | `never uses the folder ground as a text colour` — greps for `color: var(--folder…)` | **Rewrite.** `--folder` will not exist. Replace with the new world's equivalent: assert no `color:` uses a non-text token — `var(--rule)`, `var(--rule-strong)`, `var(--paper-2)`, `var(--paper-3)`. Keep the same shape and a comment explaining the substitution. |
| ~232–246 | `self-hosts both faces` — asserts `landing/assets/fonts/courier-prime.woff2` exists | Change the path to `landing/assets/fonts/geist-mono-variable.woff2`. **Keep** the `fonts.googleapis.com` / `fonts.gstatic.com` prohibitions and the `font-display: swap` check unchanged. Update the comment. |
| ~248–250 | `preloads the hero image and marks it high priority` — asserts `rel="preload" as="image" … pipeline.png … fetchpriority="high"` | **Rewrite.** The hero is now inline SVG, so there is no hero image to preload. Replace with two assertions: (a) the hero contains no `loading="lazy"`, and (b) both font files are preloaded with `rel="preload" … as="font" … crossorigin`. Record the reason in a comment. |

### 8.2 `landingPage.test.js` — assertions that MUST NOT change

Every other assertion stays. In particular:

- The whole `claims match the verified capability package` block, including the positive-candour greps: `does not (monitor|track) their dates|it does not monitor`, `no software can do that`, `your own messaging provider`, `two-way (message|conversation) threads.{0,60}not`, and the presence of `199` and `299`.
- All accessibility assertions: 6+ FAQ buttons with `aria-expanded`/`aria-controls`, `hidden` + `[hidden]{display:none!important}`, `trapFocus` (+ the exact `event.key !== 'Tab'` and the add/remove listener lines), `requestAnimationFrame`, `.modal-overlay.active{…visibility:visible}`, `transition:…visibility 0s;`, mobile toggle aria, skip link + `.skip-link:focus{top:0}`, exactly one `<h1>`, `.btn{…min-height:44px}`, `.mobile-menu-toggle{…height:44px}`, `prefers-reduced-motion` + `animation-duration: 0.001ms`.
- All conversion-flow assertions, including that `#stepOne` contains `fullName`/`workEmail` and **not** `companySize`/`primaryGoal`, the `step: 1` / `step: 2` / `reference: leadReference` payload shape, `#skipStepTwo`, the honeypot with `position: absolute`, no `alert(`, `.field-error`, `#formStatus[role="status"]`, `utm_source`, `sourcePage`.
- All SEO assertions, including the JSON-LD parse and the `['199','299']` offer check.
- `declares intrinsic dimensions on every image` — **every `<img>` needs `width`, `height` and `alt`**, and there must be **more than 4** `<img>` tags. After the redesign the count is ~8 (nav logo, 3 company logos, 3 screenshots, footer logo). Inline SVG is exempt because it is not an `<img>`.
- `references only screenshots that exist` — one-directional, so removing references is safe.
- The `no duplicated lead form` block.

### 8.3 `src/tests/landingNewsSection.test.js` — assertions that MUST change

| Line | Assertion | Required change |
|---|---|---|
| ~126 | `.news-eyebrow { … var(--rope-deep) }` | Re-point to `var(--attend)`. |
| ~127 | `.news-card { … var(--sheet-rule) }` | Re-point to `var(--rule)`. |

### 8.4 `landingNewsSection.test.js` — assertions that MUST NOT change

- The literal `SafeHaul News &amp; Insights`.
- The exact nav anchor `<a href="/news" class="nav-link">News &amp; Insights</a>`.
- All five anchors `#features`, `#pricing`, `#why-safehaul`, `#faq`, `#footer`.
- Footer contains `href="/news"` and `href="/privacy.html"`.
- The exact `<a href="/news" class="btn btn-secondary">View all articles</a>`.
- `#newsGrid`, `#newsLoading`, `aria-live="polite"`, `aria-busy="true"`.
- `html` must **not** contain `news-card-excerpt`.
- `id="leadModal"`, `js-open-lead-modal`, `fetch('/api/landing-lead'`.
- The isolation guard: no `/src/`, no `react`, no `type="module"` in markup; `href="/assets/css/styles.css`; `src="/assets/js/main.js"`.
- No `.innerHTML =`, no `insertAdjacentHTML`, no `document.write` anywhere in `main.js`.
- **Exact JS strings:** `titleLink.textContent = post.title` · `excerpt.textContent = post.excerpt` · `eyebrow.textContent = post.themeName` · `img.alt = post.image.altText || post.title` · `fetch('/api/news/latest?limit=3'` · `posts.slice(0, 3)` · `renderNewsFallback` · `Articles could not be loaded right now` · `The first articles are on their way` · `setAttribute('aria-busy', 'false')` · `if (post && post.title && post.url)`.
- CSS: `.news-section`, `.news-card`, `@media (max-width: 1024px) … repeat(2, 1fr)`, `@media (max-width: 768px) … 1fr`, `@media (max-width: 480px)`, `.news-card a:focus-visible … outline:`, `.news-sources a { … word-break: break-word }`.
- The **section 16 divider comment** must still match `/\*\s*16\.\s*SafeHaul News & Insights` — the 11px-floor check slices from it.
- The `news-fallback.svg` contract.

### 8.5 Silent-pass traps — check these deliberately

Several assertions use `html.indexOf(...)`. If the anchor string disappears, `indexOf` returns `-1`, `slice(-1)` returns one character, and the assertion **passes vacuously**. Do not let that happen:

| Anchor string | Used by |
|---|---|
| `class="hero-visual"` | `lazy-loads everything below the fold but not the hero` |
| `logos-section` | same test (both ends) |
| `id="stepOne"` / `id="stepTwo"` | `asks only for a name and an email` |
| `<footer` | `links to News & Insights from the footer` |

**Keep all four strings**, or update the tests and say so. After the rewrite, assert manually that each `indexOf` returns `> -1`.

---

## 9. Verification

### 9.1 Local servers

```bash
npx vite landing --port 4173 --strictPort
```

Already configured in `.claude/launch.json`.

**`/news` cannot be served this way** — it is a Cloud Function. Primary approach: write a throwaway Node script that imports `renderIndexPage` and `renderArticlePage` from `functions/blog/publicApi.js`, runs them against fixture post objects, and writes the output to temporary HTML files **inside `landing/`** so the real stylesheet dresses them. Review those, then delete the temporary files. Functions emulator is the fallback.

### 9.2 Automated gates

```bash
npm run check:landing-claims
```
```bash
npx vitest run src/tests/landingPage.test.js src/tests/landingNewsSection.test.js src/tests/hostingConfig.test.js
```
```bash
npm run check:landing-a11y
```

`check:landing-a11y` serves `landing/` on port 8137 and runs axe at 390×844, 768×1024 and 1440×900, then checks the two things axe cannot see: that the first FAQ question opens `#faq-a1` from the keyboard, and that focus enters *and stays inside* `#leadModal`. It needs a Chromium — set `PW_CHROMIUM_EXECUTABLE` if Playwright's bundled browser is unavailable.

```bash
node C:/Users/Kholmurod/.claude/skills/impeccable/scripts/detect.mjs --json landing/index.html landing/assets/css/styles.css
```

Run the detector **once**, at the end, not during concept work.

### 9.3 Visual QA — required, not optional

Screenshot and inspect at **1440 · 1024 · 768 · 390** px:

- homepage — full page **and per-section crops at legible scale** (a full-page thumbnail hides exactly the failures that matter)
- `/news` index (fixture render)
- one article (fixture render)
- `/privacy.html`
- the lead modal at step 1, step 2 and success

Check each for: hierarchy · whitespace · visual balance · typography · mobile composition · clipping and overflow · awkward empty areas · repeated AI-looking patterns · animation quality · CTA clarity · consistency between homepage, index and article pages.

Capture into `.impeccable/review/` as `desktop.png` and `mobile.png` (plus extras as needed).

### 9.4 Keyboard pass (manual)

Tab through: nav → hero actions → each section → FAQ (open with Enter **and** Space) → pricing CTAs → modal (open, trap, Escape, focus returns to trigger) → inline CTA form → footer. **A visible focus treatment at every stop.**

### 9.5 Definition of done

- [ ] All three automated gates green.
- [ ] Visual QA passed at all four widths with screenshots inspected, not assumed.
- [ ] Keyboard pass clean.
- [ ] Every changed test assertion has a replacement or a written reason in a comment.
- [ ] `?v=8` in all three places.
- [ ] Courier Prime files deleted; no dangling references.
- [ ] `DESIGN.md` and `.impeccable/design.json` rewritten **from the built world**, not from this plan.
- [ ] `landing/README.md`'s three "rules worth keeping in mind" replaced with the new world's rules.
- [ ] `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md` updated with a dated entry recording what shipped, what was checked, and — honestly — what could not be checked.

---

## 10. Gotchas, in one place

1. **SVG text is page copy.** The claims test strips tags and keeps text nodes, so `<text>` and `<title>` inside authored figures are checked against the capability allowlist.
2. **`display: none` cannot be transitioned.** The FAQ must keep the `hidden` attribute (test-enforced); animate with a keyframe on reveal, not `grid-template-rows`.
3. **`.news-grid` must stay a multi-column grid** — a test asserts `repeat(2, 1fr)` at 1024px and `1fr` at 768px. Build the asymmetric index layout around it, not instead of it.
4. **The section 16 divider comment is greppable.** `/* 16. SafeHaul News & Insights` must survive verbatim or the 11px-floor check loses its anchor.
5. **`indexOf` anchors can make tests pass vacuously.** See §8.5.
6. **Two deploys must ship together.** Hosting alone leaves `/news` styled by a stylesheet its markup does not match.
7. **Never screenshot production.** Captures run against the fixture tenant: `VITE_E2E_TEST_MODE=1 npm run dev` in one terminal, `npm run capture:landing-screenshots` in another. Production screenshots once leaked real driver names and phone numbers onto a public page.
8. **The logo is also the favicon and the blog's JSON-LD publisher logo.** Recolouring it affects three surfaces.
9. **`--ink-3` at `#6B7278` is the floor.** The earlier candidate `#7A8087` measures 3.7:1 on `--paper` and fails AA. Do not lighten it.
10. **There are no visual-regression baselines for the marketing site.** This work does not create them. Do not imply coverage that does not exist.
11. **`npm run typecheck` currently fails** with 20 pre-existing errors in `src/config/applicationDefinition.js`. That is a known, recorded limitation and is unrelated to this work — do not try to fix it here, and do not report it as a regression.

---

## 11. Reference material

| What | Where |
|---|---|
| Phase 1 research and direction rationale (three directions, declined worlds, tradeoffs) | `C:\Users\Kholmurod\.claude\plans\please-redesign-the-safehaul-hazy-puzzle.md` |
| Product truth, users, positioning, brand commitments | `PRODUCT.md` |
| Outgoing design system (the anti-reference) | `DESIGN.md`, `.impeccable/design.json` |
| Landing site primer, claims rule, screenshot workflow | `landing/README.md` |
| Capability allowlist and prohibited claims | `functions/ai/knowledge/safehaulCapabilities.js` |
| Blog pipeline documentation | `docs/news-and-insights.md` |
| App design system (separate, and staying separate) | `docs/SAFEHAUL_DESIGN_SYSTEM_ROADMAP.md`, `src/design-system/README.md` |
| Test-runner and CI safety rules | `AGENTS.md` |

### Research findings worth keeping

Extracted live from the reference sites, not from articles about them:

- **Motive** (`gomotive.com`, closest category peer): MaisonNeue, near-monochrome — white / black / `#666` — one saturated accent `#CB152D`, negative tracking (−0.06 to −0.08px) on nearly every string, no gradients.
- **Mercury**: custom variable face at non-standard weights (360/420/480), three-step neutral ink ramp, dominant **4px** radius used 192 times, accent mostly as a 10% tint.
- **Linear**: Inter Variable + **Berkeley Mono used 216 times** — mono as a genuine second voice. Radii 2px and 6px. Surfaces from white at 2–8% alpha over near-black.
- **Negative result worth remembering:** `ui-ux-pro-max`'s own default for "enterprise B2B SaaS" returns indigo→violet gradient CTAs, pill buttons, coloured card shadows and `back.out(1.4)` stagger. That is the AI look this redesign exists to avoid. If the build starts drifting toward it, the direction has been lost.
