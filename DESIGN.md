---
name: SafeHaul Marketing Site
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

# SafeHaul marketing site — "Specification"

> The site is set as engineering documentation for a system that has to be
> inspected.

**Scope, verified 2026-08-13.** This is the design contract for
`landing/assets/css/styles.css`, which currently dresses **`landing/privacy.html`
and the server-rendered blog** (`/news`, `/news/{slug}`, `/news/feed.xml`). The
**homepage does not follow it** — `landing/index.html` was later replaced with a
separate build on its own `landing/assets/css/landing.css`. Every rule below
binds the `styles.css` surfaces and any future work that returns the homepage to
this system; none of it describes what `index.html` renders today. See
[`landing/README.md`](landing/README.md) for the split and its consequences.

The product's whole mechanism is four scattered artifacts becoming one
inspectable assembly. That is literally what an exploded parts diagram depicts,
so the site is drawn the way technical documentation is drawn: ruled title
blocks, section numbers, callout balloons on leader lines, dimension ticks,
figure numbers, sources as a numbered apparatus.

Not a blueprint (no cyanotype, no white-on-blue), not paperwork, not nostalgia.
Modern documentation, on paper, in graphite.

Implemented in `landing/assets/css/styles.css` in 21 numbered sections. That
file is also the blog's stylesheet — see "Two surfaces, one stylesheet" below.

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
`--ink-2` instead. `npm run check:landing-a11y` caught this on the activity
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

One grammar, everywhere.

| Case | Spec |
|---|---|
| Section reveal | The section's **direct children** move `translateY(10px)` → 0 with opacity, 320ms `--ease-out`, staggered 60ms. One IntersectionObserver per section, fired once, then unobserved. |
| Hero assembly | Four plates enter from above their own exploded positions and seat there — 280ms each, 60ms apart, bottom-up. 520ms total. Runs once on load. |
| Leader draw | `stroke-dashoffset` → 0 over 480ms `--ease-seat`, then the dash-dot pattern is restored by a zero-duration keyframe. |
| Activity board | Cells fade left-to-right at 24ms per cell, once, on reveal. |
| FAQ open | A 320ms `opacity` + `translateY(-4px)` keyframe. See "Why the FAQ is not a grid animation". |
| Modal | Overlay opacity + `visibility 0s`; container `scale(0.98)` → 1. Never `scale(0)`. |
| Hover | 140ms, gated behind `@media (hover: hover) and (pointer: fine)`. |

Banned: parallax, scroll-hijacking, counting-up numbers, infinite loops,
`transition: all`, `ease-in` on any UI element, animating layout properties.

`prefers-reduced-motion: reduce` keeps opacity and removes every transform.

**The plates seat into their exploded positions; they do not collapse into the
base plate.** The exploded arrangement *is* the figure.

**Reveals stagger a section's children, not nested observers.** Nesting
`data-reveal` inside `data-reveal` looked equivalent and was not: a section
taller than the viewport takes the immediate-reveal path in `main.js`, its nested
figure kept waiting for an intersection of its own, and Figure 2 shipped at
`opacity: 0` on a real page. One observer per section cannot produce that state.

## The six figures

All inline SVG, all authored. **No photography anywhere, by decision** — a stock
truck photograph would be the one thing on the page that is not a description of
the product.

One grammar: **1.25px hairlines, 1.75px emphasis, square caps, mitre joins**,
fills only in `--graphite` / `--clear` / `--attend`, 21px callout balloons with
mono numerals, leader lines that break at right angles rather than curving.

| Figure | Where | What it draws |
|---|---|---|
| **1 — Exploded assembly** | Hero | Four labelled plates on a dash-dot assembly axis above one assembled record plate, with `04 PARTS` / `01 RECORD` dimensions. The record plate is divided into the four sections that seated into it. |
| **2 — Section view** | Inspection frame | Four hatched enclosures, one artifact each, with the row dimensioned `FOUR PLACES TO LOOK` and dash-dot system boundaries between them. |
| **3 — Queue / retry** | Apply | A time axis; the dropout drawn as an absence, two attempts as ticks, and the deterministic identifier as both attempts resolving into one record. |
| **4 — Seal detail** | Sign | The drafting detail convention: a ring on the document, two tangents, an enlarged view carrying the seal. |
| **5 — Round trip** | Verify | A five-step sequence across three lifelines, with the rate-limited portal drawn as a real throttled channel rather than described. |
| **6 — Pipeline shape** | Platform row 06 | A schematic funnel carrying **no numbers**, labelled an illustration. Any figure on it would be invented. |

### Text inside a figure is page copy

`scripts/check-landing-claims.mjs` strips tags and keeps text nodes, so every
`<text>` and `<title>` in a figure is checked against the capability allowlist.
Keep figure lettering factual.

### Two figure-scale decisions worth keeping

**A drawing holds its scale; it does not stretch.** Given the full 1180 measure,
Figures 3–5 rendered at about 1.45×, which blew their 12px labels past every mono
size on the page — the figure started shouting in a voice the rest of the site
does not have. They are capped near 1:1 at 560px, with the caption as a title
block beside them.

**Below its natural width a drawing scrolls rather than shrinking.** In a 342px
phone column a 520-unit drawing renders at 0.66×, putting its labels at about 8px
— under the Eleven-Pixel Floor and genuinely unreadable. Figures 2–5 therefore
keep their scale and scroll sideways inside a `role="region"` wrapper, with a
visible hint below them. Two consequences that are easy to undo by accident:

- The wrappers carry `tabindex="0"` **in the markup**, because a scroll region a
  keyboard cannot reach is a region a keyboard user cannot read, and that has to
  hold with JavaScript off. `main.js` then *removes* the stop where the figure
  does not actually overflow. The enhancement only ever removes a tab stop, never
  adds one — the safe direction for it to fail in.
- Every grid track that a figure can sit in must be `minmax(0, 1fr)`, not `1fr`.
  A bare `1fr` is `minmax(auto, 1fr)` and never shrinks below min-content, so
  Figure 2's `min-width: 520px` forced its collapsed track to 520px at 390 and
  pushed the figure off the page, where `overflow-x: hidden` on the body clipped
  it into unreachability.

**Figure 1 is the exception: it ships a second composition drawn for the phone**
(340 units, no dimension apparatus), because squashing a 540-unit drawing to 340
loses the drawing.

## Why the FAQ is not a grid animation

`display: none` cannot be transitioned, and the answers keep the `hidden`
attribute — that is the accessibility hardening this page was fixed to have, and
`[hidden] { display: none !important }` near the top of the stylesheet is what
makes `element.hidden` actually win over a component's own display value.

So the reveal is a **keyframe on becoming visible**, not a
`grid-template-rows: 0fr → 1fr` animation. The two cannot coexist. This is
recorded so it is not "fixed" later by someone who does not know why.

## The lockup

`landing/assets/images/logo.svg` — the four original shapes, geometry untouched,
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

## Screenshots are exhibits

True colour, in a plain 1px `--rule-strong` frame, with a typed caption and a
figure number. The outgoing site multiplied and desaturated them into the ground,
which is a treatment a screenshot cannot survive.

The phone exhibit is **cropped to the top of the screen**, and its caption says
so. A 390 × 844 capture shown whole ran 650px tall and left its story's other
column 300px short; shrunk to fit, its own interface became unreadable.

Never screenshot production. `npm run capture:landing-screenshots` runs against
the fixture tenant. Production screenshots once leaked real driver names and
phone numbers onto a public page.

## Two surfaces, one stylesheet

`/news`, `/news/{slug}` and `/news/feed.xml` are server-rendered by
`functions/blog/publicApi.js` and **share this stylesheet**. Section 16 dresses
them; sections 6 and 18 dress the navbar and footer that function emits. Nothing
in 6, 16 or 18 may assume the homepage's markup exists.

The blog ships **no JavaScript of its own and therefore no mobile-menu toggle** —
a toggle button with nothing wired to it is a control that does not work.
Stylesheet section 20 keeps its navigation reachable below 900px with a
`:not(:has(.mobile-menu-toggle))` rule that lays the links out as a horizontally
scrolling row. That rule and that omission are **one decision**: change either
and the blog loses its navigation on a phone.

`.news-grid` must stay a multi-column grid, and its `grid-template-columns: 1fr`
must stay literal and stay within 400 characters of the 768px breakpoint — a test
greps for exactly that.

**The two deploys ship together.** Hosting alone serves the new stylesheet
against old blog markup.

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
testimonial. It went with the homepage replacement and **no test enforces it
today** — restore it deliberately, and pin it if you do.
