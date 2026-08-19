# SafeHaul News & Insights

An automated blog. Three articles publish every calendar day, one per theme,
generated through the [shared AI platform](./ai-platform.md) from researched
sources and an approved capability package.

- [Themes and schedule](#themes-and-schedule)
- [Why the timezone work matters](#why-the-timezone-work-matters)
- [Idempotency](#idempotency)
- [Research source policy](#research-source-policy)
- [SafeHaul knowledge package](#safehaul-knowledge-package)
- [Generation pipeline](#generation-pipeline)
- [Duplicate prevention](#duplicate-prevention)
- [Image licensing](#image-licensing)
- [Content safety](#content-safety)
- [Firestore model](#firestore-model)
- [Public routes and SEO](#public-routes-and-seo)
- [Landing page section](#landing-page-section)
- [Deletion behaviour](#deletion-behaviour)
- [Super Admin operation](#super-admin-operation)
- [Testing](#testing)
- [Limitations](#limitations)

## Themes and schedule

| Slot | Theme | Local hour | Sources required | Primary source required |
| --- | --- | --- | --- | --- |
| 0 | Industry news and regulation | 07:00 | 2, or 1 primary | Yes |
| 1 | Recruiting and retention | 12:00 | 1 | No |
| 2 | SafeHaul and product education | 17:00 | 0 (uses the knowledge package) | No |

All times are **America/Chicago**, because the audience is the US trucking
industry.

The scheduler runs **hourly at minute 15**, not three times a day. Each run asks
"which of today's slots are due and still empty" and fills at most one. That
single choice provides four properties without extra machinery: it is idempotent,
retry-safe, it recovers a slot missed during a provider outage (the slot stays due
for the rest of the local day), and it never puts three articles on the site
within a minute of each other.

It never reaches into a previous day. Yesterday's missed article is not published
today under today's date.

## Why the timezone work matters

The publication day is the America/Chicago calendar day. Deriving that by
subtracting a fixed offset from UTC is wrong twice a year: on the spring-forward
day one local hour does not exist, and on the fall-back day one local hour happens
twice. Either mistake produces a duplicate slot or a missing date.

`functions/blog/pipeline/themes.js` uses `Intl.DateTimeFormat` with an explicit
`timeZone`, which asks the platform's own timezone database what the local
wall-clock date and hour are at a given instant. That is correct across both
transitions by construction. `blogPipeline.test.js` pins both 2026 transitions:
spring-forward keeps one date while the local hour jumps 01→03, and fall-back
produces identical slot keys for both occurrences of 01:30.

## Idempotency

The unique key for a publication is `${publicationDate}_${themeId}`, and that key
**is the Firestore document id**. Creation uses `create()`, which fails if the
document exists, so a scheduler retry, a duplicated delivery and a catch-up run
all lose the race rather than producing a second article. There is no
check-then-write window to lose.

## Research source policy

An AI model that generates text is not thereby a trustworthy source of current
events. Everything factual in an article must trace to an entry in
`functions/blog/research/sources.js`.

**Primary** — official feeds and APIs. A claim about a law, rule or government
action requires one of these; a regulatory article sourced only from trade
coverage is refused however many outlets reported it.

| Source | Publisher | Kind |
| --- | --- | --- |
| `federal-register-fmcsa` | Federal Register (FMCSA documents) | JSON API |
| `federal-register-dot` | Federal Register (DOT documents) | JSON API |
| `fmcsa-newsroom` | FMCSA | RSS |
| `dot-briefing-room` | US Department of Transportation | RSS |
| `bls-news-releases` | Bureau of Labor Statistics | RSS |
| `bts-news` | Bureau of Transportation Statistics | RSS |
| `ntsb-news` | National Transportation Safety Board | RSS |

**Secondary** — reputable trade press with a public feed. These can corroborate
and can suggest what is newsworthy, but cannot alone support a claim about a rule.

| Source | Publisher | Kind |
| --- | --- | --- |
| `ttnews` | Transport Topics | RSS |
| `freightwaves` | FreightWaves | RSS |
| `ccj` | Commercial Carrier Journal | RSS |
| `overdrive` | Overdrive | RSS |

### Rules this encodes

- **RSS, Atom and official JSON only.** No arbitrary HTML scraping.
- **No paywall circumvention**, and no republication: SafeHaul reads headlines
  and summaries to decide what to write about, writes its own article, and links
  back.
- **Requests identify SafeHaul** as `SafeHaulNewsBot/1.0` with a contact URL, so
  a publisher who wants to block us can.
- **A refusal is respected.** A 403 or 429 is recorded and the source skipped,
  not retried around.
- **Corroboration where practical.** Two sources is the target; a single
  *primary* source already satisfies the intent, because an article written from
  the rule itself is better evidenced than one written from two summaries of it.
  A single *secondary* source is never enough.
- **One unreachable publisher does not stop publication.** Failures are recorded
  per source and the run continues.

Provider-native web grounding may be used only as an additional aid where
officially supported. It never replaces saved source evidence.

## SafeHaul knowledge package

`functions/ai/knowledge/safehaulCapabilities.js` is the **only** thing the
generator may know about SafeHaul. It was verified against source files —
deliberately *not* against the landing page, which at the time made several claims
the code did not support. `npm run check:landing-claims` now runs the same
checker over the shipped marketing HTML, so the page follows the package rather
than the other way round.

Each entry records name, status, verified description, intended users, business
benefit, limitations, supporting source files, documentation, approved claims,
and the commit it was last verified against. Only `available` and `partial`
features reach the generator; `planned` and `retired` entries appear solely in a
"do not claim" list, so there is nothing for a model to write from.

`PROHIBITED_CLAIMS` records claims that must never be made, with reasons —
including several the landing page once made: "free forever" (contradicted by
the published pricing), Firebase App Check (deliberately removed, risk formally
accepted), automated DQ expiry monitoring (roadmap), MVR/PSP/Clearinghouse checks
(roadmap), a job board (does not exist), GDPR data export (not implemented),
speed-to-lead and drip campaigns (roadmap), lead distribution (removed), Telegram
intake (retired), guaranteed compliance, and legal advice.

A **deterministic pattern check** enforces this on every draft, ahead of the AI
verification step, because it is free and cannot be talked out of a verdict. It
applies to every theme — a news article that mentions SafeHaul in passing is
checked too.

`KNOWLEDGE_VERSION` is stamped onto every published article, so any claim can be
traced back to the package that authorised it. **Bump it whenever the entries
change**, and re-verify the package when a meaningful feature change ships.

## Generation pipeline

`functions/blog/pipeline/generate.js`, one slot in, one published article or one
recorded refusal out:

1. Gather current source items for the theme's topics.
2. Drop stale and duplicate items.
3. Choose a candidate topic — **deterministic, not an AI call**. Candidates are
   ranked primary-source-first, then by document length, then by recency, and
   filtered to those that can satisfy the theme's sourcing bar, so the first one
   is already the judgement the model used to be asked for. It was also the third
   sequential AI call in a run and it overran Groq's 8,000-tokens-per-minute
   budget, causing generation to be rejected *after* selection had succeeded.
   `selectTopic` still exists in `functions/ai/tasks/articleGeneration.js` and is
   no longer called by the pipeline. Claim verification was **not** dropped: that
   one is a safety control, not a convenience.
4. Compare against the last 60 days.
5. Build a fact package from the lead item plus topically-related corroboration.
6. Generate a structured draft through the shared router.
7. Validate title, slug, meta description, excerpt, structure and word count.
8. Check SafeHaul claims deterministically against the knowledge package.
9. Verify factual claims against the sources — a **separate** AI request, because
   a model asked to check its own work in the same breath tends to approve it.
10. Check originality against recent articles.
11. Find a legally usable image.
12. Sanitize.
13. Save.

**Refusing to publish is a valid, recorded outcome.** No path fills a slot with a
fabricated topic, an unsupported claim or an unlicensed image to reach the daily
count. Recorded outcomes: `published`, `skipped_no_sources`,
`skipped_all_duplicates`, `skipped_validation`, `skipped_unsupported_claims`,
`skipped_prohibited_claim`, `skipped_not_original`, `skipped_slot_taken`,
`failed_generation`, `deferred_to_next_run`.

If the verification step itself cannot run, the article is **not** published.
Publishing unverified factual claims is the failure mode the pipeline exists to
avoid.

### The run ledger: which stage refused, and why

Those outcomes used to exist only as a `console.log` in the scheduler. Nothing was
persisted per run or per slot, so "the transaction succeeded and no article
published" had no answer anywhere in the product — and the two AI transactions a
run makes both reported `success`, because a provider *had* replied in shape.

`blog_runs` now records one row per slot per run, on every path — scheduled,
manual, and a slot deferred to the next run:

| Field | Notes |
| --- | --- |
| `outcome` | one of the values above |
| `stage` | `scheduling`, `sourcing`, `generation`, `validation`, `claim_check`, `verification`, `originality`, `image`, `publication` |
| `slotKey`, `themeId`, `publicationDate`, `trigger` | which slot, and whether the schedule or an operator started it |
| `detail` | the safe reason, bounded |
| `slug` | present when something published |
| `generationTransactionId`, `verificationTransactionId` | join keys into the Logs tab |
| `verificationSupported`, `unsupportedClaimCount` | the fact-check's own answer, separate from its transaction succeeding |
| `providerId`, `model`, `fallbackCount` | who served the generation |
| `createdAt`, `expiresAt` | 30-day TTL, following the `ai_telemetry` precedent |

`claim_check` and `verification` are deliberately distinct stages: the first is
the deterministic SafeHaul claim check, the second the source-backed AI
fact-check. They refuse for different reasons and an operator's next step
differs — one means the draft over-claimed about SafeHaul, the other that a
factual claim was not supported by its sources.

Writing a ledger row can never fail a run: `recordSlotRun` swallows its own
errors. A publication that happened must not be reported as a failure because its
bookkeeping did not land.

## Duplicate prevention

Three articles a day for a year is a thousand articles, and the same handful of
stories recur constantly in trade coverage. Four independent checks over the last
**60 days**, because each catches what the others miss:

1. **Canonical source URL** — the same underlying article, however retitled.
   Scheme, `www.`, tracking parameters, fragment and trailing slash are stripped.
2. **Normalized title** — the same headline with different punctuation or casing.
3. **Topic fingerprint** — a SHA-256 of canonical sources plus title terms, so
   the same event from two publishers is caught with no shared URL.
4. **Token overlap** — a Jaccard similarity ≥ 0.6 over significant terms.

The window includes **tombstoned** articles: a deleted article still means the
topic was covered, so deleting one does not invite the generator to rewrite it
the same day.

Same-day distinctness comes from two rules that run: one document per
`{publicationDate, theme}`, so a theme cannot publish twice in a day, and the
duplicate window above, which catches two themes converging on one story.
`themesAreDistinct` in `dedupe.js` is a stricter post-hoc check for a day's set;
it is exported and tested but **not wired into the pipeline**. This document used
to describe it as an enforced rule, which is worse than not having it — a
documented safeguard that does not run is one nobody re-examines.

## Image licensing

SafeHaul never takes an image from a news article or an arbitrary website.

| Provider | Licence | Hosting | Attribution | Credential |
| --- | --- | --- | --- | --- |
| Pexels | Pexels License | Permitted | Stored and rendered | API key |
| Unsplash | Unsplash License | **Hotlink only**, per API terms | **Required** | Access key |
| Openverse | Per item (CC0, PDM, CC BY, CC BY-SA) | Hotlink | **Required** | Optional token |

Every stored image records provider, source URL, image URL, creator, licence
name, licence URL, attribution text, alt text and retrieval date.
`isLicenceComplete` refuses anything missing one of those. Openverse items whose
licence code we do not recognise are **rejected rather than guessed at**, and the
search asks only for commercially-usable, modifiable work.

When no provider is configured, or none returns a verifiable licence, articles use
the approved local fallback
(`landing/assets/images/news-fallback.svg`) — SafeHaul-owned, 1200×630 so it also
serves as the social card, and referencing no external resource. **The daily
article count is never a reason to publish an image we do not have the right to
use.**

Attribution renders whenever the licence requires it *or* whenever we have it:
crediting a photographer who did not demand it costs nothing, and omitting one who
did is a licence breach.

## Content safety

The generator returns **structured blocks**, never HTML or Markdown, and
`functions/blog/pipeline/sanitize.js` builds the markup itself. That inverts the
trust: nothing a model writes is ever interpreted as markup, because the markup is
ours and only the text is theirs.

Consequences: no script executes, no event handler attaches, no `javascript:` or
`data:` link is followed, no iframe or object embeds, and no unclosed tag escapes
the article container — because none of those constructs survive as anything but
escaped text. Unknown block types are dropped; heading levels are clamped to h2/h3
so an article cannot introduce a competing document title; control characters are
stripped.

## Firestore model

`blog_posts/{publicationDate}_{themeId}` — **server-only**, denied to every
client including Super Admins.

| Field | Notes |
| --- | --- |
| `id`, `title`, `slug`, `excerpt` | `slug` is lowercase ASCII with single hyphens |
| `contentBlocks` | Sanitized structured blocks. Never raw model HTML |
| `theme`, `publicationDate`, `status` | `published` or `deleted` |
| `sources[]` | title, publisher, url, summary, publishedAt, sourceId, tier, retrievedAt |
| `image` | Full licence metadata (see above) |
| `seo` | canonicalUrl, metaDescription, openGraph, twitter, author, publicationDate |
| `generation` | provider, model, fallbackCount, wordCount, verification summary, claim-check result, originality similarity, source count, hasPrimarySource, and the generation/verification `transactionId`s |
| `knowledgeVersion` | Which knowledge package authorised the SafeHaul claims |
| `normalizedTitle`, `topicTokens`, `sourceFingerprint` | Duplicate prevention |
| `publishedAt`, `modifiedAt`, `deletedAt` | |

`generation` stores **safe structured evidence only** — sources, checks and
validation results. No hidden chain-of-thought is stored.

The document is server-only even though the article content is public, because it
also carries tombstones, source fingerprints and provider/model records. The
public surface is the server-rendered routes, which filter and strip —
`publicApi.js` serves no generation metadata at all, so the transaction ids stay
internal.

The article keeps its own copy of the transaction ids because it outlives the
ledger row: `blog_runs` expires after 30 days and a published article does not.

`blog_runs/{runId}` — also **server-only** (`allow read, write: if false`), read
through the `listBlogRuns` callable. Fields are listed under
[The run ledger](#the-run-ledger-which-stage-refused-and-why). Its query is a
single `orderBy('createdAt', 'desc')` so it needs no composite index; the stage
filter is applied client-side.

## Public routes and SEO

One `onRequest` handler, `serveBlogPublic`, serves everything behind Firebase
Hosting rewrites:

| Path | Response |
| --- | --- |
| `/news` | Index of the latest 30 published articles |
| `/news/{slug}` | Full article HTML with metadata and JSON-LD |
| `/news/feed.xml` | Atom feed (latest 20) |
| `/sitemap.xml` | Static pages plus every published article |
| `/api/news/latest?limit=3` | JSON cards for the static landing page |

`/robots.txt` is **not** in that table. Hosting resolves it before it consults
rewrites, so a rewrite to the function was deployed and never fired — both
landing sites returned an empty `404`. It is now the static file
`landing/robots.txt`. The function keeps a `/robots.txt` branch as a backstop for
a direct hit on its own URL; `src/tests/hostingConfig.test.js` pins the two to
the same content and fails if the dead rewrite is reintroduced.

Both landing targets deploy the same `landing/` directory and therefore the same
permissive `robots.txt`, so `landing-testing` carries an
`X-Robots-Tag: noindex, nofollow` response header. A per-site header is the only
way to keep the test site from competing with production as duplicate content.

Server-rendered rather than client-rendered, because articles are created after
deployment and a crawler must receive complete HTML on the first request.
Committing static files would mean a deploy per article, which an automatically
published blog cannot do.

Each article page carries a unique SEO title, meta description, canonical URL,
Open Graph title/description/image, Twitter card, published and modified times,
`SafeHaul Editorial Team` as author, `BlogPosting` JSON-LD, linked sources,
descriptive image alt text, a clean h1→h2 heading structure, an internal link to
the product, and a plain statement that the article is not legal advice.

### Rewrite ordering

On both landing targets, in order: `/api/landing-lead`, then `/news`,
`/news/**`, `/api/news/**`, `/sitemap.xml`, then the `**` catch-all. **The
specific rules must stay before the catch-all** or it swallows them and returns
the marketing homepage. Hosting's documented priority is reserved namespaces →
redirects → exact-match static content → rewrites, and within `rewrites` the
first matching source wins. `src/tests/hostingConfig.test.js` asserts the order.

### Required Firestore indexes

`blog_posts` needs two composite indexes, both declared in
`firestore.indexes.json` and deployed by the production repository only:

| Fields | Used by |
| --- | --- |
| `status` ASC, `publicationDate` DESC | `listPublished`, `listPublishedSlugs` |
| `slug` ASC, `status` ASC | `findPublishedBySlug` |

The first one is not optional and its absence is not a quiet degradation.
Firestore rejects an equality filter combined with an `orderBy` on a different
field with `FAILED_PRECONDITION` **even against an empty collection**, so
without it `/news`, `/news/feed.xml`, `/sitemap.xml` and `/api/news/latest` all
return `500` from the moment they are deployed. That is what happened on the
first production rollout.

Neither the unit suite nor the rules emulator can catch this: the unit tests stub
the Firestore client, and the emulator creates composite indexes on demand and
never raises `FAILED_PRECONDITION`. `functions/test/unit/blogFirestoreIndexes.test.js`
closes the gap statically — it parses the query chains out of
`functions/blog/store.js`, works out which need a composite index, and asserts
each is declared. A new query with a new filter/order combination fails there
rather than in production.

`recentForDeduplication` filters and orders on `publicationDate` alone, so it
needs no composite index; the guard asserts that too, so nobody adds dead
configuration for it.

### Public security

Only `status === 'published'` articles are ever returned, so a deleted article is
indistinguishable from one that never existed. Slugs from the URL are validated
against the pattern the generator can produce, then used only for an equality
query; an invalid slug gets the same 404 as an unknown one, so probing tells an
attacker nothing. A 404 is `noindex, follow` so a removed article is not indexed
at its old URL. Non-GET methods get 405. No generation metadata, provider name or
model is ever exposed. Responses set an explicit content type, a short cache
policy and the same hardening headers as the landing site.

## Presentation

The pipeline above is unchanged by the 2026-08 marketing redesign. What changed
is how the articles look, and one defect that had been shipping since the section
launched.

**The chrome was unstyled.** `renderPage` emitted `<nav id="navbar">`,
`.nav-logo` and `.footer-container`. The stylesheet contains no ID selectors and
defines neither of those classes, so every article page rendered with an
unstyled header and footer while the article body itself was fully styled. The
renderer now emits the same `.navbar` / `.nav-link` / `.footer-section` classes
the homepage uses, plus a skip link and the self-hosted font.

**`.btn-secondary` did not exist.** The landing strip's "View all articles"
button asked for a class the stylesheet never defined, so it rendered as a bare
`.btn`. It is now a real variant.

**The index and article pages are designed rather than merely styled.** Section
15 of `landing/assets/css/styles.css` covers both: a centred index header with a
card grid, and an article column set to a ~68-character measure with heading
rhythm, blockquote treatment, a licensed hero image with visible attribution,
and a **Sources** block styled as a deliberate part of the page. That last one is
the section's credibility — every factual claim traces to a named source — and it
had been rendering as an afterthought.

Card titles are styled at both `h2` and `h3`, because the server-rendered index
uses `h2` (under the page's own `h1`) while the landing strip uses `h3`. Without
the `h2` rule the index inherited the global display scale and the cards became
billboards.

## Landing page section

`landing/index.html` carries a **SafeHaul News & Insights** section, a navigation
link and a footer link. The landing site keeps its isolated static architecture:
no application code, no React, no design-system import. The section reuses the
page's own `:root` brand tokens and the same card idiom as the features section.

Cards are fetched at runtime from `/api/news/latest` rather than committed,
because articles are published after deployment and the landing site has no build
step that could regenerate them. Every fetched value is inserted with
`textContent` or `setAttribute`, never `innerHTML` — the endpoint already escapes
its output, but the page must not depend on that. A failed fetch degrades to a
link rather than an error, and the placeholder means the section is never empty
and never shifts layout.

## Deletion behaviour

Deleting an article tombstones it: `status` becomes `deleted` and `deletedAt` is
stamped, but the row survives.

**Immediately public-invisible** — the landing cards, `/news`, the article page
(404 + noindex), the sitemap and the feed all filter on `status`, so a single
write removes it from every surface at once.

**Internally retained** for the audit trail and for duplicate prevention. A
soft-delete is what stops the generator rewriting the same topic the same day.

Deletion requires the exact super-admin role, recent authentication, the shared
confirmation dialog naming the article, server-side authorization, and a
value-free audit record.

**A deleted slot is not regenerated, and this is now said out loud.** `slotIsFilled`
tests only whether the document exists, and a tombstone exists, so the
`{date, theme}` slot stays filled for good. Deleting a bad article does not
produce a replacement. The ledger records a row saying exactly that when an
article is deleted, so the behaviour is visible instead of being discovered.

Freeing the slot safely was considered and **deliberately not done here.** The
`create()` on that document id is the *only* thing preventing a double
publication, and the tombstone is also what stops the generator rewriting the same
topic the same day. Reopening a slot means a transaction that removes the post
while moving the duplicate-prevention record somewhere that survives, which is a
change to the anti-double-publish guarantee and needs its own justification and
its own tests. Until then: delete removes the article from every public surface,
and the day publishes two.

## Super Admin operation

**Super Admin → Blog Posts** is deliberately minimal: article titles, a
publication date to disambiguate similar titles, and Delete. No editor, no
approval queue, no status workflow — publishing is automatic and the articles are
not meant to be hand-edited, so every one of those additions would be surface
area with no user.

**Run today's publication check** invokes the same idempotent path the schedule
uses, so it cannot double-publish. It is useful for filling a slot missed during
a provider outage without waiting for the next hour. A run that publishes nothing
is usually correct — the slots are already filled — and is reported as
information, not as a failure.

**Publication runs** reads the ledger: one row per slot per run, with the stage
that refused, the safe detail, the trigger, and the fact-check's own verdict where
there was one. Filterable by stage, with published runs hidden by default because
the reason to open the panel is usually that something did not publish. This is
the screen that answers "generation succeeded, so where is the article?" — a
question the product previously could not answer at all.

Article titles link to the live article. They pointed at `/news/undefined`,
because `listBlogPosts` did not return `slug` while the contract-test fixture
included one — a fixture asserting a field the server never sent.

## Testing

`functions/test/unit/blogPipeline.test.js` — 112 tests. No test contacts a real
feed, AI provider or image provider.

Proven: exactly three daily theme slots; publication date derived in
America/Chicago; both 2026 DST transitions handled without a duplicate or missing
date slot; slots open at their local hour and stay open; no duplicate after a
retry; at most one article per run; a missed slot filled later the same day; never
publishing for a previous day; publication continuing when a publisher is
unreachable; the 60-day window; all four duplicate checks; tombstones still
counted; distinct themes; a primary source required for regulation; corroboration
required; sources saved with title, publisher, URL and date; SafeHaulNewsBot
identification; a 403 respected; unsupported SafeHaul claims rejected; publication
refused when verification cannot run; unsafe HTML escaped; unknown blocks dropped;
heading levels clamped; slug traversal rejected; complete image licence metadata;
the local fallback; unrecognised Openverse licences rejected; canonical metadata
and JSON-LD present; deleted articles gone from every public surface; unpublished
articles never exposed; invalid slugs answered identically to unknown ones; write
methods refused; and the Super Admin callables' authorization, recent-auth,
malformed-id and tombstone behaviour.

Also proven, and worth naming because their absence is what let "success" mean
two different things: every refusal writes a ledger row naming its stage — the
suite previously asserted refusals only against a return value, so it would have
passed with no ledger at all; a fact-check verdict of `supported: false` is
recorded as a verdict and not as an unqualified success; a published article
carries its generation and verification transaction ids; and the deletion path
records that the slot stays filled.

`src/tests/landingNewsSection.test.js` — 24 tests over the shipped landing files:
section and links present, no committed cards, no React or app code pulled in, no
`innerHTML`, alt text always set, graceful degradation, brand tokens reused,
breakpoints at 1024/768/480, visible focus, no body text under 11px, and the
fallback SVG's accessible name and self-containment.

## Limitations

Stated honestly rather than omitted:

- **Short-headline duplicate blind spot.** Token overlap needs three shared
  significant terms, so two short headlines about the same rule can slip through
  when they share only two. The canonical-URL and fingerprint checks catch that
  case in practice; the residual gap is asserted in
  `blogPipeline.test.js` so it cannot change silently.
- **Feed availability is not guaranteed.** Publishers change or withdraw feeds.
  A source that starts failing is recorded per run but does not raise an alert.
- **No visual-regression baselines** for the article or index pages; the roadmap
  item for screenshot baselines is still open, so layout is reviewed by eye.
- **The landing card strip needs JavaScript.** With JS disabled the section shows
  its placeholder and the link to `/news`, which is itself server-rendered and
  fully crawlable.
- **First-publication verification is a production step.** Nothing in CI proves
  that a real provider produces a publishable article, because no test may call
  one.
- **A deleted slot stays filled.** See [Deletion behaviour](#deletion-behaviour).
  Deleting an article does not cause a replacement to be written, and reopening
  the slot was deliberately left out of the change that added the ledger.
- **The enforced word floor is 150**, a long way below the 700–1,200 words
  originally specified. That is a recorded owner decision taken three times
  against free-tier provider limits, not drift. Raising a provider tier is what
  reverses it.

## Related files

- [`functions/blog/`](../functions/blog/)
- [`functions/ai/knowledge/safehaulCapabilities.js`](../functions/ai/knowledge/safehaulCapabilities.js)
- [`docs/ai-platform.md`](./ai-platform.md)
- [`docs/FIREBASE_HOSTING_RUNBOOK.md`](./FIREBASE_HOSTING_RUNBOOK.md)
- [`docs/firestore-data-model.md`](./firestore-data-model.md)
