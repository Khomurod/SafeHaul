# DESIGN.md — the removed landing page's sections (2026-11-07)

History, not guidance. These sections of `DESIGN.md` described the public
landing page (`/`), its figures, FAQ and screenshots, which were removed with
the marketing site. Kept verbatim; `DESIGN.md` keeps what the news pages and
`/privacy.html` still use.

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

`scripts/check-public-claims.mjs` strips tags and keeps text nodes, so every
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

## Screenshots are exhibits

True colour, in a plain 1px `--rule-strong` frame, with a typed caption and a
figure number. The outgoing site multiplied and desaturated them into the ground,
which is a treatment a screenshot cannot survive.

The phone exhibit is **cropped to the top of the screen**, and its caption says
so. A 390 × 844 capture shown whole ran 650px tall and left its story's other
column 300px short; shrunk to fit, its own interface became unreadable.

Never screenshot production. The capture script ran against the fixture tenant,
and went with the marketing site whose exhibits it produced. **The rule outlives
it:** production screenshots once leaked real driver names and phone numbers onto
a public page.
