# SafeHaul marketing site

The public site at `safehaul.io`. Hand-written HTML, CSS and vanilla JavaScript
with **no build step and no framework**, deployed to the `landing-production` and
`landing-testing` Firebase Hosting targets.

It is deliberately isolated from the React application in `src/`.
`src/tests/landingNewsSection.test.js` asserts that no application or
design-system code is pulled in here — do not import from `src/`.

## Files

| Path | What it is |
| --- | --- |
| `index.html` | The homepage. All copy is here. |
| `privacy.html` | Privacy policy. Shares the stylesheet and script. |
| `assets/css/styles.css` | Every style, in numbered sections. Brand tokens in `:root`. Also dresses `privacy.html` and the server-rendered blog. |
| `assets/js/main.js` | Navigation and the tab rail, the FAQ accordion, the nine-step reveal, the lead dialog, the news strip. |
| `assets/fonts/archivo-variable.woff2` | Self-hosted Archivo (latin, variable `wght`+`wdth`, ~90 KB). Structure and display. |
| `assets/fonts/courier-prime*.woff2` | Self-hosted Courier Prime (latin, ~19 KB each). Anything the file world would have typed, stamped or logged. |
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

Three rules worth keeping in mind when editing styles:

- **`--folder` and `--folder-deep` never carry text.** They are grounds and
  rules. Goldenrod ink on this page's own surfaces is illegible or close to it,
  and `src/tests/landingPage.test.js` fails the build if a `color:` uses either.
  `--folder-lit` is the one permitted for text, and only on kraft.
- **Secondary ink is darker on folder grounds.** `--ink-soft` clears 4.5:1 on
  paper and measures 3.97:1 on goldenrod. The five folder-ground sections
  redefine `--ink-soft` and `--ink-faint` for everything inside them rather than
  hand-picking a colour per call site. Adding a sixth folder section means
  adding it to that list, or axe will catch you.
- **`[hidden]` is forced to `display: none !important`** near the top of the
  stylesheet, because several components set their own display value and would
  otherwise silently defeat `element.hidden`.

## News & Insights

`/news`, `/news/{slug}`, `/news/feed.xml` and `/sitemap.xml` are server-rendered
by the `serveBlogPublic` function and share **this stylesheet** — see section 16
of `styles.css`, and note that the navbar and footer it emits are styled by
sections 6 and 18. Nothing in those sections may assume the homepage's markup
exists: the blog header has no mobile-menu toggle, which is why section 20 uses
`:has()` to keep its tabs reachable on a phone. The homepage strip fetches
`/api/news/latest` at runtime and degrades to a link when that fails. Full
documentation:
[`docs/news-and-insights.md`](../docs/news-and-insights.md).

## Deployment

Deployed by the SafeHaul GitHub workflow to its repository-specific Hosting
target. See [`docs/FIREBASE_HOSTING_RUNBOOK.md`](../docs/FIREBASE_HOSTING_RUNBOOK.md).
Do not deploy this folder separately and do not reconnect it to Vercel.
