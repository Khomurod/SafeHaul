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
`npm run check:public-claims` enforces it and runs as part of `npm run lint`.

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

**There is no marketing site right now.** It was removed by owner decision, and
is to be rebuilt from scratch rather than revived. What remains public is `web/` —
hand-written CSS with **no build step and no framework**, dressing the
server-rendered blog (`/news`, `/news/{slug}`, `/news/feed.xml`) and a standalone
privacy page, deployed to Firebase Hosting separately from the React app in
`src/`. `/` redirects to `/news`.

**Constraints a rebuild inherits.** The blog had no styling of its own — it shared
the marketing site's single 3447-line stylesheet — so removing that site meant
extracting what the blog used into `web/assets/css/`, not deleting it. Any new
marketing site must not assume it owns those files. The capability discipline
above still applies to every public surface, and the homepage briefly escaping it
is the reason: it was once a separate build on its own stylesheet with no claims
gate, and shipped an MVR/PSP claim the product cannot support.

## Brand Commitments

Confirmed by the user: **the SafeHaul name is the only binding element.** The
existing navy `#004C68` / mint `#0be2a4` palette, the Inter typeface and the
current mark are all open to replacement on the marketing site. The user accepts
that the site may visibly diverge from `app.safehaul.io` until the app follows.

Voice, as established by the current copy and worth preserving: plain, specific,
unhyped, and willing to say what the product does *not* do — including a FAQ
answer that begins "No software can do that, and anyone who says otherwise is
selling you something." That candour is an asset, not a liability. It lived on
the removed homepage and was test-enforced there so it could not be quietly
dropped; **a rebuild should carry it back**, with the test.

## Evidence on Hand

- Three real customer logo files — STL Truckers, True Nation, I&S Transportation
  — went with the removed marketing site and are **recoverable from git history**.
  They may be shown as carriers hiring on SafeHaul. They may **not** be presented
  as endorsing it. A fourth carrier, TopHire Recruiting Agency, has no logo file,
  so the old strip set its name as a wordmark rather than inventing a mark.
- Three real product screenshots captured from a fixture tenant ("Ridgeline
  Carriers") — pipeline, edocs, driver-application-mobile — likewise removed and
  recoverable from history. The capture script went with them. **The rule that
  produced them stands for any rebuild:** capture against `VITE_E2E_TEST_MODE=1`
  and **never against production**, which once leaked real driver names onto a
  public page.
- A live, daily-publishing News & Insights blog, still serving at `/news`.
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

The removed site was held to a real bar and checked mechanically: an axe audit
at 390, 768 and 1440 that additionally asserted the two things axe cannot see —
that the FAQ opened from the keyboard and that focus was trapped inside the lead
dialog. Both were genuinely broken before it existed. **The audit went with the
pages it audited; a rebuild needs it back**, and the two hand-written assertions
are the part worth copying, not the axe run.

Standing rules from the current build that any replacement must honour: no body
text below 11px; the scrollable comparison table stays keyboard-reachable; every
interactive element keeps one visible focus treatment; and any accent colour
used must pass contrast where it carries text — the current mint measures about
1.6:1 on white, which is exactly why it was never allowed to.
