# SafeHaul marketing site

The public site at `safehaul.io`. Hand-written HTML, CSS and vanilla JavaScript
with **no build step and no framework**, deployed to the `landing-production` and
`landing-testing` Firebase Hosting targets.

It is deliberately isolated from the React application in `src/`.
`src/tests/landingNewsSection.test.js` asserts that no application or
design-system code is pulled in here — do not import from `src/`.

## Three surfaces, one system

**Verified against the tree on 2026-08-13.**

| Surface | Markup | Stylesheet | Script |
| --- | --- | --- | --- |
| Homepage | `index.html` | `assets/css/styles.css` | `assets/js/main.js` |
| Privacy policy | `privacy.html` | `assets/css/styles.css` | `assets/js/main.js` |
| Blog (`/news`, `/news/{slug}`, `/news/feed.xml`) | emitted by `functions/blog/publicApi.js` | `assets/css/styles.css` | none |

All three are governed by [`../DESIGN.md`](../DESIGN.md).

### The homepage was once a fourth build, and it cost real damage

Between the "Specification" redesign and its restoration, `index.html` was
replaced by a separate build on its own `assets/css/landing.css` with an inline
script. The replacement was never carried through to the other surfaces or to any
of the checks, and while it was live:

- `npm run check:landing-claims` **failed** on it — "SafeHaul runs MVR or PSP
  checks" — and because that check is part of `npm run lint`, lint was red on
  `main`. It also advertised continuous MVR monitoring, automated DQ/MVR audits,
  named ELD integrations, a `$499/mo` tier and a "100% Audit Readiness
  Guarantee". None of those exist.
- **Nothing on the site captured a lead.** The "Request Demo" form called
  `alert()` and closed. `submitLandingLead` and its Telegram delivery were intact
  server-side and simply received nothing.
- There was **no News & Insights strip**, no skip link, no accessible FAQ, no
  structured data, no feed link, and every footer link was `href="#"`.
- It `@import`ed Google Fonts, putting a render-blocking third-party stylesheet
  and two extra connections in front of every visit — for faces this folder
  already ships — and carried three unoptimised photographs totalling **2.2 MB**
  with no `width`, `height` or `loading` attributes.
- `src/tests/landingPage.test.js` **failed**, which is the `frontend-quality` CI
  job.

`landing.css` and those three photographs were removed with the restoration; they
are recoverable from history if a photographic direction is ever chosen
deliberately.

Three things stop that recurring, and none of them should be softened:

1. `scripts/ci-plan.mjs` maps `landing/` to the `frontend_unit` lane. It used to
   map it to *no lane*, which is why a landing-only commit could ship all of the
   above with a green CI run.
2. The claims gate reads the shipped HTML, not a copy of the copy.
3. `DESIGN.md` refuses photography, ROI figures, time-saved statistics, gradients,
   glassmorphism and pills **by name**. The replacement carried every one of them.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The homepage. All copy is here. |
| `privacy.html` | Privacy policy. Uses `styles.css` and `main.js`. |
| `assets/css/styles.css` | The "Specification" system, in 21 numbered sections. Tokens in `:root`. Dresses all three surfaces. |
| `assets/js/main.js` | Navigation and the current-section rule, the reveals, the FAQ accordion, the nine-step reveal, the lead dialog, the inline closing-CTA form, the news strip. Loaded by `index.html` and `privacy.html`; the blog ships no script. |
| `assets/fonts/archivo-variable.woff2` | Self-hosted Archivo (latin, variable `wght`+`wdth`, ~90 KB). Structure and display. |
| `assets/fonts/geist-mono-variable.woff2` | Self-hosted Geist Mono (latin, variable `wght`, ~23 KB, OFL). Anything a technical document types or numbers. Replaced the two Courier Prime files, for a net −14,860 bytes. |
| `assets/images/logo.svg` | The mark, in graphite + attend red. **Also the favicon and the blog's JSON-LD publisher logo** — a recolour lands on three surfaces. |
| `assets/images/logo-mono.svg` | The reversed single-colour mark, for the graphite footer. A second file rather than `currentColor` because an `<img>` cannot inherit it. |
| `assets/images/screenshots/` | Product screenshots. **Generated — see below.** |
| `assets/images/og-card.png` | 1200×630 social card. |
| `robots.txt` | Static. Hosting resolves it before rewrites, so it cannot be a function. |

## The rule that matters most: claims must be true

Every product claim on this site must trace to an `available` or `partial` entry
in [`functions/ai/knowledge/safehaulCapabilities.js`](../functions/ai/knowledge/safehaulCapabilities.js).
That file is the verified description of what SafeHaul actually does, and its
`PROHIBITED_CLAIMS` list exists partly because this page used to contradict it —
it promised "free forever" beside its own $199 and $299 plans, advertised a job
board that has never existed, and described document-expiry monitoring that was
never built.

`npm run check:landing-claims` runs the same deterministic checker the automated
blog runs on every draft, against the shipped HTML. It is part of `npm run lint`,
so a prohibited claim fails the build.

**If the product genuinely gains a capability, update the knowledge package
first.** It is the source of truth, and the blog is generated from it.

## Updating copy

All text is in `index.html`. Search for the sentence and edit it. Then:

```bash
npm run check:landing-claims
npx vitest run src/tests/landingPage.test.js src/tests/landingNewsSection.test.js
```

## Updating screenshots

Do **not** screenshot production. The images that shipped here before this was
automated contained real driver names and phone numbers on a public page, and one
showed a feature that had been removed from the product.

Captures run against the fixture tenant instead, which has no route to real data:

```bash
VITE_E2E_TEST_MODE=1 npm run dev          # terminal 1
npm run capture:landing-screenshots       # terminal 2
```

`VITE_E2E_TEST_MODE=1` points Firestore at a closed port and serves in-memory
fixtures; `?demo=marketing` renames the tenant to the fictional "Ridgeline
Carriers". Add or change a shot in `scripts/capture-landing-screenshots.mjs`,
where each entry names the section it supports.

## The lead form

A two-step dialog. Step one asks only for a name and a work email and **saves the
lead immediately**; step two adds qualification. Someone who abandons at the
qualification questions is still a captured, contactable lead — the previous
single form lost them entirely.

- Any element with `.js-open-lead-modal` opens it. `/#get-started` opens it on load,
  which is how `privacy.html` reaches it without duplicating the markup.
- Both steps post to `/api/landing-lead`, a same-origin Hosting rewrite onto
  `submitLandingLead`.
- The lead is written to Firestore **before** Telegram delivery is attempted, so
  an outage delays a notification instead of destroying a customer.
- **Telegram credentials never appear in this folder, in browser JavaScript, in
  GitHub or in GitHub Actions.** They are managed in Super Admin → Landing Page
  Settings, encrypted at rest, with Google Secret Manager as the deploy-time
  fallback. See [`docs/environment-and-integrations-runbook.md`](../docs/environment-and-integrations-runbook.md).

## Accessibility

`npm run check:landing-a11y` serves this folder and runs axe at 390, 768 and
1440, then checks the two things axe cannot see: that the FAQ opens from the
keyboard, and that focus is trapped in the dialog. Both were broken before the
redesign. It needs a Chromium; set `PW_CHROMIUM_EXECUTABLE` if Playwright's
bundled browser is unavailable.

Two things carry a tab stop on purpose, because a scroll region a keyboard cannot
reach is a region a keyboard user cannot read: the comparison table's wrapper, and
the wide figures. The figures ship `tabindex="0"` **in the markup** so it holds
with JavaScript off; `main.js` then *removes* the stop wherever the figure does
not actually overflow. The enhancement only ever removes a tab stop, never adds
one — the safe direction for it to fail in.

Three rules worth keeping in mind when editing styles:

- **`--ink-3` is the contrast floor, and only on `--paper`.** It measures 4.55:1
  against `#F7F7F5` and only **4.19:1** against the recessed `--paper-2`, so
  anything quiet sitting on `--paper-2` or `--paper-3` uses `--ink-2` instead
  (6.9:1 there). `npm run check:landing-a11y` catches this on a real ground; it
  cannot see a hover state, so `.spec-row:hover` darkens its own index by hand.
  `src/tests/landingPage.test.js` fails the build if a `color:` uses a rule or
  recessed-ground token at all. Do not lighten `--ink-3` — the earlier candidate
  `#7A8087` measures 3.7:1 and fails outright.
- **A grid track a figure can sit in must be `minmax(0, 1fr)`, never `1fr`.** A
  bare `1fr` is `minmax(auto, 1fr)` and never shrinks below its content's
  min-content width. Figure 2 carries `min-width: 520px` — it scrolls rather than
  shrinking under the eleven-pixel floor — which forced its collapsed track to
  520px at 390 and pushed the figure off the page, where `overflow-x: hidden` on
  the body clipped it into unreachability. The one deliberate exception is
  `.news-grid` at 768px, where a test greps for the literal `1fr` and nothing
  inside a card carries a min-width.
- **`[hidden]` is forced to `display: none !important`** near the top of the
  stylesheet, because several components set their own display value and would
  otherwise silently defeat `element.hidden`. This is also why the FAQ animates
  with a keyframe rather than `grid-template-rows: 0fr → 1fr`: `display: none`
  cannot be transitioned, and the two approaches cannot coexist.

And one that is not about styles: **a standalone `.svg` is parsed as XML, so its
comments may not contain a double hyphen.** Naming a CSS custom property in one
silently breaks the whole file — the browser shows a broken-image icon and reports
nothing. Both authored SVGs say so in their own comments.

## News & Insights

`/news`, `/news/{slug}`, `/news/feed.xml` and `/sitemap.xml` are server-rendered
by the `serveBlogPublic` function and share **this stylesheet** — see section 16
of `styles.css`, and note that the navbar and footer it emits are styled by
sections 6 and 18. Nothing in those sections may assume the homepage's markup
exists.

**The blog ships no JavaScript of its own, and therefore no mobile-menu toggle** —
a toggle button with nothing wired to it is a control that does not work. Section
20 keeps its navigation reachable below 900px with a
`:not(:has(.mobile-menu-toggle))` rule that lays the links out as a horizontally
scrolling row instead of a hidden panel. That rule and that omission are **one
decision**: change either and the blog loses its navigation on a phone.

`.news-grid` must stay a multi-column grid, and its `grid-template-columns: 1fr`
must stay literal *and* within 400 characters of the 768px breakpoint — a test
greps for exactly that, and a verbose comment in front of it fails a test that is
actually satisfied.

**The two deploys ship together.** A hosting-only deploy serves the new stylesheet
against old blog markup.

The homepage strip fetches `/api/news/latest` at runtime and degrades to a link
when that fails. Full documentation:
[`docs/news-and-insights.md`](../docs/news-and-insights.md).

`/news` cannot be served from the static dev server. To review it, render fixtures
with the real functions into `landing/` so the real stylesheet dresses them, then
delete the temporary files:

```js
const { __test } = require('../functions/blog/publicApi.js');
// __test.renderIndexPage(posts) and __test.renderArticlePage(post)
```

Note that `safeUrl()` rejects relative paths, so a fixture image must use either an
absolute URL or one of our own root-relative asset paths — `safeImageSrc()` in
`publicApi.js` accepts both.

## Deployment

Deployed by the SafeHaul GitHub workflow to its repository-specific Hosting
target. See [`docs/FIREBASE_HOSTING_RUNBOOK.md`](../docs/FIREBASE_HOSTING_RUNBOOK.md).
Do not deploy this folder separately and do not reconnect it to Vercel.
