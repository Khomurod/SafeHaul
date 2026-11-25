---
name: landing-page
description: >-
  SafeHaul's rules for building or changing the public site at safehaul.io
  (`web/`): the landing page, its sections, copy, look, and the checks before a
  pull request. Use it together with `implement` whenever a task touches `web/`
  or the owner asks for a landing page, home page or marketing page.

  Not for: application screens in `src/`, or the automated blog articles.
---

# /landing-page — the public site

`implement` holds the order of work. This skill adds what is particular to the
public site. Read `docs/APP_BRIEF.md` §3 and §10 and the "News & Insights
routes" section of `docs/FIREBASE_HOSTING_RUNBOOK.md` before you start.

## 1. Where it lives and how it ships

- The public site is the static `web/` folder: plain HTML and CSS, no build
  step, no framework, no imports from `src/` or the design system.
- A template from GitHub supplies the look only. Rewrite its sections as plain
  HTML and CSS in `web/`; never add its React, Next.js or Astro project, its
  package files or a build step. Use only templates under MIT or Apache-2.0, and
  keep their licence notice in a comment where you copy their markup or CSS.
- A merge to `main` deploys `web/` to `safehaul-landing-testing.web.app`, which
  sends `noindex`. `safehaul.io` changes only when the owner promotes a release.
- The home page is `web/index.html`, with `web/assets/css/home.css` (the page),
  `home-screens.css` (the drawn app screens) and one script,
  `web/assets/js/home.js`. There is no redirect for `/` on either
  `landing-*` target in `firebase.json`, and there must not be one: it would hide
  the page. Keep both targets' rewrites and headers as they are.
- Shared assets are in `web/assets/`: the logo, the app's Inter font
  (`inter-variable-latin.woff2`), and the blog's Archivo and Geist Mono fonts
  and styles. Load nothing from another site: no font services, CDNs, trackers,
  chat widgets or embedded videos; host any font in `web/assets/fonts/`.

## 2. Every sentence must be true

- Product sentences come only from `available` entries in
  `functions/ai/knowledge/safehaulCapabilities.js`, in the wording of their
  `approvedClaims`. A `partial` feature is described together with its
  limitation. `planned` and `retired` entries are never described as features.
- `npm run check:public-claims` reads every `.html` file at the top of `web/`,
  including text inside SVG, but not subfolders: keep pages at the top. It
  reads clause by clause, so a question such as "Does SafeHaul run
  MVR checks? Not today." fails. Phrase a limitation as its own statement:
  "SafeHaul does not order or receive background checks."
- Never claim DOT or FMCSA compliance, MVR, PSP or Clearinghouse checks,
  expiry monitoring or renewal reminders, a job board, or "free forever".
- No testimonials, customer logos, star ratings, customer counts or "hours
  saved" figures unless the owner gives a real, named source in writing.
- No prices on the page: the owner decided visitors learn them by asking. If
  that changes, only the two flat plans in `PRODUCT.md` ($199 and $299 a
  month). No checkout or "start free trial": SafeHaul takes no payments online.
- Keep the line that SafeHaul supports the carrier's own compliance process
  and does not give legal advice.
- The company is Safehaul Technologies LLC; the contact address is
  `info@safehaul.io`. Name no person on the page unless the owner asks.

## 3. Page structure

Write in plain US English for a carrier owner, recruiter or safety manager.
Short sentences, active voice, their words (driver, application, DQ file,
CDL), not ours (record, tenant, pipeline stage).

1. **Hero**: a headline with the outcome for the carrier, one or two lines on
   what SafeHaul is, a primary button and a "Log in" link to
   `https://app.safehaul.io`.
2. **Who it is for**: carrier owners, recruiters, safety teams.
3. **What it does**: three to six features, each a benefit plus one true
   detail. Show the product (a drawn screen or a real screenshot without
   customer data), not stock photos of trucks.
4. **How it works**: three or four real steps, from sharing the application
   link to a signed and verified file.
5. **The driver's side**: licence photo auto-fill, weak signal, signing
   without an account.
6. **Pricing** is not shown (see §2); the FAQ says how to ask.
7. **FAQ**: the real objections, including what SafeHaul does not do.
8. **Final call to action**, then a footer with About, Privacy, News, the
   company name and the contact address.

- Button text says what happens: "Talk to us", "See it with your process".
  Avoid "Submit", "Learn more" and "Get started".
- Avoid filler: "seamless", "revolutionize", "unlock", "leverage", "cutting-
  edge", "all-in-one solution", dashes used as asides, and "not X, but Y".
- Contact is the form in the final section, posted to `/api/contact`
  (`submitWebsiteLead`), with the email address shown as text and a `mailto:`
  link beside it. A change to the form keeps the bar in the runbook's "Landing
  lead form security" section; never revive `submitLandingLead`.

## 4. Look and behaviour

- The look is monochrome (the owner's choice): a white page, near-black
  `#111111` text and buttons, greys for secondary text, hairline borders, and
  the app's Inter (headings at weight 600). Colour appears only in the logo and in the
  app screens drawn on the page, which keep the app's own colours. No glows,
  colour gradients, gradient text or pill buttons: corners 8 px on buttons and
  12 px on cards.
- The logo is exactly `src/shared/components/Logo.jsx` (teal `#004C68`, mint
  `#0BE2A4`, gradient `#0CE1A5` to `#077B5A`) on a light background.
  `web/assets/images/logo.svg` carries it with padding; reuse that file.
- No stock road or truck scenes: show the product itself.
- A drawn app screen shows the real app: its menu, labels, columns and statuses
  as they are on app.safehaul.io, with made-up people. Never a view the app does
  not have, such as a Kanban board.
- Phone first: check 390 px and 1280 px widths, no sideways scrolling, tap
  targets at least 44 px.
- The owner wants motion on every screen, each piece explaining the product:
  scroll that tells a story (a driver's application travelling from the phone
  to the team's record), product screens demonstrated with a moving cursor,
  and sections that reveal as they enter. No animation is decoration only.
- Animation and the form's code are one plain JavaScript file,
  `web/assets/js/home.js`, with no libraries and no inline script. The About and
  Privacy pages stay script-free.
- Never take over scrolling: the page moves at the visitor's speed and the
  animation follows it. With JavaScript off every section shows its finished
  state; with `prefers-reduced-motion` it shows that state without movement.
- Animate only `transform` and `opacity`, stop loops that are off screen, and
  keep the page smooth on a mid-range phone.
- Accessibility: one `h1`, headings in order, a skip link as in
  `web/about.html`, alt text, a visible focus ring, contrast at least 4.5:1.
- Speed: inline SVG or compressed images in `web/assets/images/`, width and
  height on every image, fonts preloaded as `web/about.html` does. Keep the page
  under 500 KB before fonts.
- Search: a title and meta description, `link rel="canonical"` to
  `https://safehaul.io/`, Open Graph tags, and JSON-LD that states only true
  facts. Check that `web/robots.txt` and the generated sitemap still work.

## 5. Before the pull request

- `npm run check:public-claims` and
  `npx vitest run src/tests/hostingConfig.test.js` pass. Add a test there for
  each new page, as the About page has.
- `npm run check:agent-docs` passes if you changed this skill.
- Look at the page at 390 px and 1280 px in light and dark, with fonts loaded.
- `docs/APP_BRIEF.md` §3 and §10, `DESIGN.md` and the runbook describe the site
  as it now is.
- **Кратко** tells the owner that the page appears on the Testing public site
  after the merge and on `safehaul.io` only after the owner promotes a release.
