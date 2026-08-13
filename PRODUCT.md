# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two people, one purchase.

- **The owner or safety director** at a US trucking carrier — often the person
  who signs the cheque *and* wears the compliance hat. They are afraid of the day
  someone asks to see a driver's file and it is spread across a filing cabinet,
  a phone gallery and three inboxes. They buy defensibility.
- **The recruiter** who lives in the tool daily and is measured on drivers
  seated. They lose candidates to applications that die at a truck stop with two
  bars of signal, and to paperwork that stalls waiting on a signature. They use
  it for speed.

Confirmed by the user: the owner buys, the recruiter uses. The marketing site
must carry both arcs — survive the audit *and* hire faster — without saying
either weakly.

A third audience touches the product but is not the buyer: the **driver
applicant**, on a phone, often on a bad connection, filling in a nine-step
application; and the **past employer** answering a verification request through
a rate-limited portal.

## Product Purpose

SafeHaul turns driver hiring into one structured record per driver. An
application, the qualification documents, the signed paperwork and the verified
employment history live against the same driver, in the same system, so the file
holds together months later when someone asks to see it.

Success is a carrier that can produce a complete, coherent driver file on
demand, and a recruiter who did not lose a candidate to a dropped connection or
an unsigned PDF.

## Positioning

The driver file is the deliverable, and a general ATS plus a standalone
e-signature tool splits it in half. SafeHaul is the only one of the three that
holds application, documents, signature and previous-employment verification as
one record — with signing included at no per-envelope charge, on a flat monthly
price rather than per seat or per envelope.

It deliberately does *not* claim to make anyone DOT compliant. It supports the
carrier's own compliance process and says so on the page.

## Operating Context

- Drivers apply on phones, frequently on poor connections. Applications are
  queued client-side and retried; an identifier derived from company, email and
  phone prevents a retry creating a duplicate driver.
- Recruiters work a pipeline of applicants through hiring stages, and may run
  more than one carrier under one account.
- Signers sign in a browser with no account, after an ESIGN/UETA disclosure.
- Past employers answer verification requests through a portal with a reminder
  cycle and rate limiting.
- Document files are never public URLs; every link is server-issued for one
  request and checked against company membership.
- Two flat plans: $199/month, and $299/month adding bulk SMS and email.

## Capabilities and Constraints

Source of truth: `functions/ai/knowledge/safehaulCapabilities.js`. Any claim on
the marketing site must trace to an `available` or `partial` entry there;
`npm run check:landing-claims` enforces it and runs as part of `npm run lint`.

**Available today:** driver applicant tracking (nine-step application + recruiter
pipeline); offline-tolerant application submission; per-driver qualification
document storage; electronic documents and signatures (unlimited, sealed,
tamper-evident); AI signer-field placement (suggestion, human-reviewed); CDL
photo auto-fill (values shown to the driver to confirm); previous-employment
verification with tracked responses; candidate lead intake; recruiting
analytics; multi-company management; activity and audit records.

**Partial:** bulk SMS and email campaigns — the carrier connects their own
messaging provider and is billed by that provider directly. No two-way threads,
no automated multi-step sequences.

**Must never be claimed:** free forever; document-expiry monitoring or renewal
reminders; MVR / PSP / FMCSA Clearinghouse checks; a job board; complete GDPR
export; automated instant replies or drip sequences; lead distribution between
companies; Telegram intake; any guarantee of FMCSA or DOT compliance; legal
advice; **any named carrier endorsing SafeHaul**.

**Technical constraints of the marketing site:** `landing/` is hand-written
HTML, CSS and vanilla JS with **no build step and no framework**, deployed to
Firebase Hosting targets separately from the React app in `src/`.
`src/tests/landingNewsSection.test.js` asserts no application or design-system
code is imported into it. `/news`, `/news/{slug}` and `/news/feed.xml` are
server-rendered by `serveBlogPublic` and **share `landing/assets/css/styles.css`**
(section 16) — so the stylesheet cannot be rewritten without carrying the blog's
styles with it.

**The homepage is currently a separate build** on its own
`landing/assets/css/landing.css`, and does not use `styles.css`, `main.js`, the
news strip or the `/api/landing-lead` capture path — see
[`landing/README.md`](landing/README.md). It also currently **fails**
`npm run check:landing-claims` on an MVR/PSP claim. Bringing it back under the
capability discipline described here is an open product decision.

## Brand Commitments

Confirmed by the user: **the SafeHaul name is the only binding element.** The
existing navy `#004C68` / mint `#0be2a4` palette, the Inter typeface and the
current mark are all open to replacement on the marketing site. The user accepts
that the site may visibly diverge from `app.safehaul.io` until the app follows.

Voice, as established by the Specification-era copy and worth preserving: plain,
specific, unhyped, and willing to say what the product does *not* do — the
model being a FAQ answer that began "No software can do that, and anyone who
says otherwise is selling you something." That candour is an asset, not a
liability. **It is not on the site today** — the current homepage dropped that
FAQ — and nothing enforces it, so restoring it is a deliberate act.

## Evidence on Hand

- Three real customer logos are on hand in
  `landing/assets/images/company_logos/`: STL Truckers, True Nation, I&S
  Transportation. They may be shown as carriers hiring on SafeHaul. They may
  **not** be presented as endorsing it. (No file exists for TopHire Recruiting
  Agency, and the current homepage displays no logo strip at all.)
- Three real product screenshots captured from a fixture tenant ("Ridgeline
  Carriers"), in `landing/assets/images/screenshots/`: pipeline, edocs,
  driver-application-mobile — one per entry in
  `scripts/capture-landing-screenshots.mjs`. Regenerated by
  `npm run capture:landing-screenshots` against `VITE_E2E_TEST_MODE=1` — **never
  against production**, which once leaked real driver names onto a public page.
- A live, daily-publishing News & Insights blog, fetched at runtime by the
  `styles.css` surfaces.
- **Absent, and not to be invented:** testimonials, quotes, named endorsements,
  customer counts, time-saved statistics, ROI figures, review-site ratings,
  funding, team size, uptime numbers, security certifications (no SOC 2 claim
  exists).

## Product Principles

1. **The file is the product.** Every feature exists to make one driver record
   complete and defensible; anything that splits the record is the competition.
2. **Say what it does not do.** The candour about expiry monitoring, background
   checks and compliance guarantees is the reason the rest is believable.
3. **The worst connection is the design target.** A driver on two bars at a
   truck stop is the load-bearing case, not the edge case.
4. **Never a public URL, never a silent alteration.** Access is server-checked
   and signed documents are sealed; the record has to survive being looked at.
5. **Flat and unmetered.** No per-seat, no per-envelope, no surprise line item.

## Accessibility & Inclusion

The site is held to a real bar and it is checked mechanically:
`npm run check:landing-a11y` runs axe at 390, 768 and 1440 and additionally
asserts the two things axe cannot see — that the FAQ opens from the keyboard and
that focus is trapped inside the lead dialog. Both were genuinely broken before.

Standing rules from the current build that any replacement must honour: no body
text below 11px; the scrollable comparison table stays keyboard-reachable; every
interactive element keeps one visible focus treatment; and any accent colour
used must pass contrast where it carries text — the current mint measures about
1.6:1 on white, which is exactly why it was never allowed to.
