---
name: SafeHaul Public Site
description: Engineering documentation for a record that has to be inspected — paper ground, graphite ink, colour reserved for meaning, and every figure drawn rather than photographed.
colors:
  paper: "#F7F7F5"
  paper-2: "#EDEEEC"
  paper-3: "#E4E6E3"
  graphite: "#14161A"
  graphite-2: "#1E2126"
  graphite-3: "#2A2E34"
  ink: "#14161A"
  ink-2: "#4B5157"
  ink-3: "#6B7278"
  ink-on-dark: "#F1F3F2"
  ink-on-dark-2: "#A8B0B6"
  ink-on-dark-3: "#838C93"
  rule: "#DADCD9"
  rule-strong: "#C3C7C3"
  rule-on-dark: "#333940"
  draft: "#2C4A9A"
  clear: "#0F5F4C"
  attend: "#A93226"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.75rem, 4.6vw, 4.25rem)"
    lineHeight: 1.05
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 100, 'wght' 620"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.75rem, 2.6vw, 2.5rem)"
    lineHeight: 1.12
    letterSpacing: "-0.016em"
    fontVariation: "'wdth' 100, 'wght' 600"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.1875rem"
    lineHeight: 1.3
    letterSpacing: "-0.008em"
    fontVariation: "'wdth' 100, 'wght' 600"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
    measure: "68ch"
  label:
    fontFamily: "'Geist Mono', ui-monospace, 'Cascadia Mono', monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    letterSpacing: "0.06em"
    textTransform: "uppercase"
rounded:
  control: "2px"
  panel: "3px"
spacing:
  gutter: "24px"
  measure: "1180px"
  section: "112px"
  sectionTight: "76px"
---

# SafeHaul public site — "Specification"

> The site is set as engineering documentation for a system that has to be
> inspected.

**Scope, updated when the marketing site was removed.** This is the design
contract for the stylesheets in `web/assets/css/`, which dress the two public
surfaces that remain: the server-rendered blog (`/news`, `/news/{slug}`,
`/news/feed.xml`) and the standalone privacy page (`/privacy.html`). Every rule
below binds both.

**It used to bind a third.** `landing/index.html` was the marketing homepage, and
`landing/assets/css/styles.css` was one 3447-line file dressing all three. The
homepage has been removed by owner decision; the stylesheet was not simply deleted
with it, because the blog had no styling of its own. The rules the surviving pages
actually use were extracted into five files — `news-foundation`, `news-chrome`,
`news-article`, `news-footer`, `news-responsive` — cut at this specification's own
section boundaries and kept in the original's source order, plus `policy.css` for
the privacy page. **They are one stylesheet split for length, and the `<link>`
order is the cascade.**

The homepage also briefly did not follow this specification: it was once replaced
with a separate build on its own `landing/assets/css/landing.css`, which broke the
claims gate, the lead capture, the News strip and the accessibility hardening
before being restored. Measured against "What this world refuses" below, that
stylesheet carried gradients, five `backdrop-filter` glass panels, radii up to
550px, seven coloured shadows, stock photography, an ROI calculator with invented
savings figures — and an `@import` of Google Fonts, undoing the self-hosting these
two faces exist for. The episode is kept here because the lesson outlived the
page: a public surface that leaves this system breaks gates nobody was thinking
about.

The product's whole mechanism is four scattered artifacts becoming one
inspectable assembly. That is literally what an exploded parts diagram depicts,
so the site is drawn the way technical documentation is drawn: ruled title
blocks, section numbers, callout balloons on leader lines, dimension ticks,
figure numbers, sources as a numbered apparatus.

Not a blueprint (no cyanotype, no white-on-blue), not paperwork, not nostalgia.
Modern documentation, on paper, in graphite.

Originally implemented in one file of 21 numbered sections; now in the five
`web/assets/css/news-*.css` files plus `policy.css`, still in that order — see
"Two surfaces, one stylesheet" below.

## The five rules

**1. The Drawn-Line Rule.** Structure is drawn in `--graphite` and `--rule`.
`--draft` is a *line* colour: leaders, callout balloons, focus rings, inline
links. It never fills a region behind text.

**2. The Meaning Rule.** `--clear` means verified or complete. `--attend` means
attention or required. `--draft` means the drawn line and the link. There is no
fourth meaning, and none of the three is ever decorative. The one soft fill on
the site — `--clear-soft` behind a completed application step — is state, not
decoration.

**3. The Black-Action Rule.** The primary action is `--graphite`, not a brand
colour. **There is no brand colour on this site.** On a graphite ground the
action inverts to a `--paper` fill with `--graphite` text.

**4. The Typed-Things Rule.** Geist Mono sets what a technical document types or
numbers: figure numbers, section numbers, dimensions, table headers, timestamps,
prices, plan tags, captions. **Never prose.** Two deliberate relaxations: figure
captions and screenshot captions keep the mono voice but drop the uppercasing and
heavy tracking, because a sentence set in tracked-out caps becomes something to
decode rather than read.

**5. The Eleven-Pixel Floor.** No text below 11px anywhere, in CSS *or* inside a
figure. This is the rule that forced the scrolling-figure decision below.

And one prohibition, which is what keeps this off the AI-default path: **no
ambient decoration.** No gradients, no glow, no glassmorphism, no noise overlay,
no coloured card shadows, no pills, no radius above 4px, no icon-in-a-circle.
Elevation is flat by default; the three shadow tokens exist for the two things
that genuinely float (the dialog) and one that lifts on scroll (the bar).

## Contrast, and where the tokens run out

Every ink was measured against the ground it sits on, and one of them has almost
no headroom:

| Ink | On | Ratio |
|---|---|---|
| `--ink` #14161A | `--paper` | 17.0:1 |
| `--ink-2` #4B5157 | `--paper` | 7.4:1 |
| `--ink-3` #6B7278 | `--paper` | **4.55:1** |
| `--ink-3` #6B7278 | `--paper-2` | **4.19:1 — fails** |
| `--ink-2` #4B5157 | `--paper-2` | 6.9:1 |
| `--draft` #2C4A9A | `--paper` | 7.7:1 |
| `--clear` #0F5F4C | `--paper` | 7.1:1 |
| `--attend` #A93226 | `--paper` | 6.2:1 |
| `--ink-on-dark-3` #838C93 | `--graphite` | 5.4:1 |

**`--ink-3` is the floor, and only on `--paper`.** The recessed grounds spend its
0.05 of headroom, so anything quiet sitting on `--paper-2` or `--paper-3` uses
`--ink-2` instead. The accessibility audit caught this on the activity
board's header row. It cannot catch it on a hover state, so the `.spec-row:hover`
rule darkens its own index by hand — that one is reasoned, not measured by the
gate.

Do not lighten `--ink-3`. The earlier candidate #7A8087 measures 3.7:1 on
`--paper` and fails outright.

## The signature device: the margin rule

A technical drawing has a ruled margin carrying the sheet number.

- Every major section opens with a **2px `--graphite` rule** across the full
  measure, and immediately under it a title-block row: mono section number
  (`01`–`10`) and a mono section label, with the `h2` at measure below.
- At `≥1300px` the section number hangs **outside** the measure, in the sheet's
  left margin. Below that it sits inline in the title block row.
- The hero's title block runs the **full measure**, not just the text column —
  the ruled margin belongs to the sheet, not to one column of it.
- This is a ruled block. It is not an eyebrow chip, and there is no pill anywhere
  on the site.

## Motion: "parts seat into position"

One grammar, `--ease-seat`. On the pages that remain (news, privacy) motion is
small: hover moves of 140ms, gated behind `@media (hover: hover) and (pointer:
fine)`; a modal fades its overlay and scales its container from 0.98, never 0.

Banned: parallax, scroll-hijacking, counting-up numbers, infinite loops,
`transition: all`, `ease-in` on any UI element, animating layout properties.

`prefers-reduced-motion: reduce` keeps opacity and removes every transform.

The landing page's motion, figures, FAQ and screenshot exhibits went with it:
`docs/archive/design-landing-2026-11.md`.

## The lockup

`web/assets/images/logo.svg` — the four original shapes, geometry untouched,
recoloured from #17130e / #b03a24 to `--graphite` #14161A and `--attend` #A93226.
The viewBox carries 2 units of padding so the optical gap beside the wordmark is
part of the file rather than something every call site has to remember.

- **Clear space:** 0.5 × mark height on all four sides. Nothing enters it,
  including the wordmark.
- **Sized by height, not width.** The mark is 152 × 132; the outgoing site put it
  in a 28 × 28 box, which scaled it to 28 wide and left it towering over the
  wordmark's 14px cap height. `.logo` sets `height: 22px; width: auto`.
- **Small-size variant:** the same file at `height: 18px`; below that the mark's
  four counters close up and the wordmark should stand alone.
- **Reversed variant:** `logo-mono.svg`, one colour (#F1F3F2), for graphite
  grounds. A second file rather than `currentColor` because an `<img>` is an
  independent document and cannot inherit it. The print stylesheet inverts it,
  because the footer prints on white.

**The mark is also the favicon and the blog's JSON-LD publisher logo.** A
recolour lands on three surfaces.

**A standalone `.svg` is parsed as XML, so its comments may not contain a double
hyphen.** Naming a CSS custom property in one silently breaks the whole file —
the browser shows a broken-image icon and reports nothing. This cost a debugging
round; both authored SVGs now say so in their own comments.

## Never screenshot production

Production screenshots once leaked real driver names and phone numbers onto a
public page. Any screenshot for a public page is taken against a fixture tenant.

## Two surfaces, one stylesheet

`/news`, `/news/{slug}` and `/news/feed.xml` are server-rendered by
`functions/blog/publicApi.js`; `/privacy.html` is static. They **share these
stylesheets**. The old section 16 dresses the blog and is now
`news-article.css`; sections 6 and 18 dress the navbar and footer that function
emits and are now `news-chrome.css` and `news-footer.css`; the privacy page's own
three classes are `policy.css`. Nothing in any of them may assume the removed
homepage's markup exists — which is no longer a discipline to keep, but a fact.

The blog ships **no JavaScript of its own and therefore no mobile-menu toggle** —
a toggle button with nothing wired to it is a control that does not work.
`news-responsive.css` keeps its navigation reachable below 900px with a
`:not(:has(.mobile-menu-toggle))` rule that lays the links out as a horizontally
scrolling row. That rule and that omission are **one decision**: change either
and the blog loses its navigation on a phone.

`.news-grid` must stay a multi-column grid, and its `grid-template-columns: 1fr`
must stay literal and stay within 400 characters of the 768px breakpoint — a test
greps for exactly that.

**The two deploys ship together.** Hosting alone serves the new stylesheets
against old blog markup, and the Cloud Function alone serves new markup against
old stylesheets. Both halves of that are now more likely, not less: the markup and
the stylesheets live in different deploy artifacts.

## What this world refuses

The category default — and the default an AI design tool returns for "enterprise
B2B SaaS" — is an indigo-to-violet gradient CTA, pill buttons, coloured card
shadows, a centred hero over a bento grid, and `back.out` stagger. Every one of
those is banned above. If the build starts drifting toward any of them, the
direction has been lost.

Also refused: photography, testimonials, customer counts, time-saved statistics,
ROI figures, review ratings, uptime numbers, security certifications, and any
claim that a named carrier endorses SafeHaul. None of those exist. The pricing
panel says "Plan B" rather than "Most popular" for exactly this reason — a
popularity claim is a statistic, and there is no number behind it.

The candour is a brand asset. The FAQ answer beginning *"No software can do that,
and anyone who says otherwise is selling you something"* is worth more than any
testimonial. It lived on the homepage, and went with it. Nothing on the public
site says it now — worth knowing if the marketing site is ever rebuilt, because
the phrase was test-enforced precisely so it could not be quietly dropped.
