---
name: SafeHaul Marketing Site
description: The driver qualification file, made into a page — goldenrod folder stock, kraft board, and form paper.
colors:
  folder: "#e2a72e"
  folder-lit: "#f0c14f"
  folder-tab: "#d59a22"
  folder-deep: "#a8760f"
  kraft: "#2b1d0e"
  kraft-lit: "#3f2d16"
  kraft-rule: "#57411f"
  sheet: "#faf7f0"
  sheet-alt: "#f3eee2"
  sheet-rule: "#ddd2bb"
  sheet-edge: "#c9bda3"
  ink: "#17130e"
  ink-soft: "#574b3c"
  ink-faint: "#7d6f5c"
  ink-on-kraft: "#f4ecdd"
  ink-on-kraft-soft: "#cbb897"
  rope: "#b03a24"
  rope-deep: "#8a2b18"
  stamp: "#45348c"
  stamp-lit: "#a99cf0"
  verified: "#1d5b41"
typography:
  display:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.6rem, 5.6vw, 4.6rem)"
    lineHeight: 0.97
    letterSpacing: "-0.033em"
    fontVariation: "'wdth' 88, 'wght' 800"
  headline:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.85rem, 3.1vw, 2.75rem)"
    lineHeight: 1.04
    letterSpacing: "-0.028em"
    fontVariation: "'wdth' 92, 'wght' 750"
  title:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.2rem"
    lineHeight: 1.24
    letterSpacing: "-0.015em"
    fontVariation: "'wdth' 96, 'wght' 700"
  body:
    fontFamily: "Archivo, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
  label:
    fontFamily: "'Courier Prime', ui-monospace, 'Courier New', monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.1em"
rounded:
  control: "2px"
  sheet: "3px"
  tab: "10px 10px 0 0"
spacing:
  gutter: "24px"
  section-tight: "84px"
  section: "116px"
components:
  button-primary:
    backgroundColor: "{colors.rope}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "12px 26px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.rope-deep}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "12px 26px"
  button-outline-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.folder-lit}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.rope}"
    rounded: "{rounded.control}"
    padding: "12px 26px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    padding: "12px 14px"
  nav-tab:
    backgroundColor: "{colors.folder-tab}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    padding: "10px 15px"
    height: "44px"
  nav-tab-active:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink}"
  card-sheet:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.ink-soft}"
    rounded: "{rounded.sheet}"
    padding: "30px 26px"
  input-field:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
    height: "46px"
---

# Design System: SafeHaul Marketing Site

## Overview

**Creative North Star: "The Driver File"**

Every SafeHaul feature exists to produce one thing: a driver qualification file
that holds together months later, when someone asks to see it. So the marketing
site is not a page about that object — it is that object. Goldenrod folder stock
is the ground. Index tabs along the top edge are the navigation. Form-paper
sheets sit on the stock, punched and held on a metal prong. Kraft board backs the
sections that have to feel closed and serious. Marks land as rubber stamps at the
angle a hand would leave them.

The register is a working safety office under fluorescent light at mid-morning:
lit, saturated, unglamorous, legible at speed. It is deliberately *not* the beige
nostalgia this world falls into — a real file folder is a saturated object, and
rendering it politely turns the system into a costume. Nor is it the category
default this replaced: a centered hero, a mint-to-white gradient wash, a floating
screenshot and a bento of equal cards, all of which could belong to any product
in any category.

Density varies on purpose. Folder grounds carry big type and air; sheets carry
ruled, tight, form-like information; kraft carries short declarative statements
with generous separation. Depth is physical throughout — paper lies on paper and
throws a real offset shadow.

**Key Characteristics:**
- Saturated goldenrod as a committed ground, not an accent
- Two faces only: a wide institutional grotesque and a true typewriter
- Every screenshot is a print in a mount, never a rectangle floating on a background
- Colour carries fixed meaning; no component invents a new one
- Square-cut corners and printed rules; almost nothing is soft

## Colors

A four-material palette — folder stock, kraft board, form paper, ink — with three
meaning colours used by law and never for decoration.

### Primary
- **Goldenrod Folder Stock** (`#e2a72e`): the ground of the hero, the logo strip,
  the problem section, pricing and the closing call to action. Roughly a third of
  the page. It is a surface, never a mark.
- **Rope Red** (`#b03a24`): the action colour. Primary buttons, the tab cap on
  the section you are reading, stamp outlines, links inside body copy, the
  focus ring. On folder stock use **Rope Deep** (`#8a2b18`), because `#b03a24`
  measures 4.04:1 there.

### Secondary
- **Kraft Board** (`#2b1d0e`): the redweld backing. The trust band and the
  footer. Used where the page should feel closed rather than open.
- **Form Paper** (`#faf7f0`) and **Second Ply** (`#f3eee2`): the sheets. Every
  section that carries structured information sits on one of these.

### Tertiary
- **Stamp Violet** (`#45348c`, lit `#a99cf0`): dates and audit marks only. The
  lit value is what appears on kraft, where the base measures 1.66:1.
- **Ledger Green** (`#1d5b41`): confirmed, verified, complete. Checkmarks,
  completed steps, the seal.

### Neutral
- **Ink** (`#17130e`): all headings, all labels, printed rules, the 2px section
  rules that structure the page.
- **Soft Ink** (`#574b3c`) and **Faint Ink** (`#7d6f5c`): body copy and captions
  on paper.
- **Sheet Rule** (`#ddd2bb`) and **Sheet Edge** (`#c9bda3`): printed rules and
  paper edges.

### Named Rules

**The Ground Rule.** `--folder` and `--folder-deep` never carry text, anywhere.
They fill, they rule, they cap a tab. `--folder-lit` is the only goldenrod
permitted as ink, and only on kraft, where it measures over 7:1. This is
enforced: `src/tests/landingPage.test.js` fails the build on `color: var(--folder)`.

**The Darker-On-Gold Rule.** Secondary ink is redefined on folder grounds
(`--ink-soft: #42372b`, `--ink-faint: #4a3e31`). The paper values measure 3.97:1
on goldenrod, which is a fail, not a rounding error. A new folder-ground section
joins that selector list or axe will catch it.

**The Meaning Rule.** Red means act or attend. Violet means a date or an audit
mark. Green means verified. A component never invents a fourth meaning, and never
borrows one of these three for decoration.

## Typography

**Display Font:** Archivo (variable, `wght` 400–800, `wdth` 75–125), self-hosted
**Body Font:** Archivo at 400
**Label/Mono Font:** Courier Prime, self-hosted

**Character:** A wide American institutional grotesque against a true typewriter.
Archivo set semi-condensed and heavy reads like a filing-drawer plate; Courier
Prime is the machine that filled the form in. The width axis is doing real work —
headlines compress to 88, tab labels and table headers ride at normal width.

### Hierarchy
- **Display** (`wdth` 88 / `wght` 800, `clamp(2.6rem, 5.6vw, 4.6rem)`, 0.97):
  the h1 only. Left-aligned at roughly half measure, never centered.
- **Headline** (`wdth` 92 / `wght` 750, `clamp(1.85rem, 3.1vw, 2.75rem)`, 1.04):
  section titles.
- **Title** (`wdth` 96 / `wght` 700, `1.2rem`, 1.24): card and row headings.
- **Body** (400, `1.0625rem`, 1.62): all prose, capped at 68ch.
- **Label** (Courier Prime 400, `0.75rem`, `0.1em`, uppercase): tabs, stamps,
  sheet heads, table headers, form labels, log timestamps, captions.

### Named Rules

**The Typed-Things Rule.** Courier Prime is for what the file world would
actually have typed, stamped or logged: labels, dates, references, table headers,
log lines, captions. It is never used for prose. Monospace as a costume for
"technical" is the failure mode this rule exists to prevent.

**The Eleven-Pixel Floor.** No text below 11px (`0.6875rem`) anywhere, including
captions and stamps. Enforced over the shared stylesheet by
`src/tests/landingNewsSection.test.js`.

## Layout

One measure of 1220px, gutters of 24px. Section grounds run edge to edge and
constrain their own contents with `padding-inline: max(gutter, (100% - 1220px)/2)`
— giving a section a max-width instead leaves kraft and sheet bands floating as
panels with cut vertical edges, which is a rectangle on a background rather than
a material.

Vertical rhythm alternates deliberately: 116px on full sections, 84px on tight
ones, and the story blocks open with their own tab and a 2px ink rule. Grounds
alternate folder → sheet → kraft → sheet → folder so no material runs long enough
to flatten.

Breakpoints: 1100 (hero and stories go single column), 1024 (news to two columns,
problem and manifest stack), 968 (tab rail collapses to a drawer), 768 (pricing
and news to one column), 480 (hero rhythm tightens so the punched sheet still
reaches the first viewport).

## Elevation & Depth

Physical, not ambient. Every shadow carries both an offset and a blur, because
what is being modelled is paper lying on paper. Nothing glows and nothing uses a
zero-offset halo.

### Shadow Vocabulary
- **lift-1** (`0 1px 2px rgba(43,29,14,.16)`): a stamp resting on a sheet.
- **lift-2** (`0 6px 14px -6px rgba(43,29,14,.34), 0 2px 4px rgba(43,29,14,.12)`):
  small mounted objects, the compare table, the signature block.
- **lift-3** (`0 18px 34px -14px rgba(43,29,14,.44), 0 4px 10px -4px rgba(43,29,14,.2)`):
  loose documents, price forms, mounted screenshots.
- **lift-4** (`0 34px 60px -22px rgba(43,29,14,.5), 0 10px 20px -10px rgba(43,29,14,.26)`):
  the hero exhibit and the dialog — the top sheet of the stack.

### Named Rules

**The Material Rule.** Folder stock and kraft board carry a real grain — tiled
fractal-noise turbulence as a data URI, multiplied at 0.14 on folder and overlaid
at 0.30 on kraft. A flat fill is a swatch of a colour, not a sheet of anything. A
grain so faint it cannot be seen in a screenshot is a compliance token; if you
cannot see it, raise it or remove it.

## Shapes

Square-cut. Controls and inputs take 2px, sheets 3px, and that is the whole
radius vocabulary — except tabs, which take `10px 10px 0 0` because that is the
shape of the object the navigation is made of. Structure is drawn with rules
rather than boxes: 2px ink rules open every section and underline every header
row; 1px `--sheet-rule` separates items within one. Loose paper is rotated by
fractions of a degree (0.35°–1.4°); stamps land at −6° or −7°.

## Components

### Buttons
- **Shape:** square-cut (2px), 44px minimum height, 54px at `btn-lg`.
- **Primary:** rope red fill, white text, `lift-2` rising to `lift-3` on hover,
  1px downward press on `:active` — paper being pressed.
- **Outline:** 2px ink border on transparent; inverts to ink fill with
  `--folder-lit` text on hover.
- **Secondary:** rope-outlined, filling on hover. Deliberately lighter than
  primary: a filled slab here competes with the page's real action.
- **Ghost:** no border, 9%-ink wash on hover.

### Navigation — the index tabs (signature component)
The nav is the folder's tabs. Each link is a tab standing on the rail: folder-tab
fill, 1px `--folder-deep` border with no bottom edge, `10px 10px 0 0`, and a 3px
inset cap. The tab for the section being read fills with `--sheet`, caps in rope,
and lifts 3px so it stands proud of the rail. State is carried by `aria-current`
set from an IntersectionObserver scroll-spy, so it is announced as well as drawn.
Below 968px the tab lies on its side — the cap moves to the leading edge and the
stack reads as a drawer of files.

### Cards / Containers
Sheets, not cards. `--sheet` or `--sheet-alt` fill, 1px `--sheet-edge`, 3px
radius, `lift-3`, and a fractional rotation where the object is meant to read as
loose. Screenshots are always mounted: a padded sheet frame with its own border
and shadow, the image itself multiplied and slightly desaturated so it reads as
printed rather than projected. Nested cards do not occur.

### Inputs / Fields
White fill, 1px ink border, 2px radius, 46px tall, Courier Prime uppercase label
above. Focus and invalid both draw a 3px rope underline via `inset box-shadow` —
a form field being marked, not a glow.

### The activity record (signature component)
Kraft panel, Courier Prime, tabular numerals, timestamps in `--stamp-lit`,
appended lines with a footer that names the data as an illustration. It is used
where the product's claim is that a trail exists — showing the trail rather than
asserting it in a card.

## Do's and Don'ts

### Do:
- **Do** ground each section in one material and let it run edge to edge.
- **Do** mount every screenshot in a sheet frame with `mix-blend-mode: multiply`
  and `saturate(0.88)`, so the interface belongs to the paper it sits on.
- **Do** reach for a printed rule before a box. 2px ink opens a section; 1px
  `--sheet-rule` separates rows inside one.
- **Do** draw icons: one sprite, one 2.4px stroke, square caps and mitre joins.
- **Do** theme the browser's own surfaces — selection, caret, `accent-color`,
  scrollbars, focus rings — from this palette.
- **Do** label demonstration data as an illustration wherever a visitor could
  mistake it for a real driver record.

### Don't:
- **Don't** set text in `--folder` or `--folder-deep`, on any surface.
- **Don't** soften the goldenrod toward cream, parchment or beige. The saturation
  is the design; the muted version is the costume.
- **Don't** use Courier Prime for prose, or for "technical" atmosphere.
- **Don't** add a radius beyond 2px / 3px / the tab shape.
- **Don't** let a stamp or seal overlap text it would strike through.
- **Don't** introduce a fourth meaning colour, or reuse red, violet or green for
  decoration.
- **Don't** put a kicker or eyebrow above a heading. The HIRE / SIGN / VERIFY
  marks are index tabs on a section edge — an object in the world, not a label
  floating above an h2.
