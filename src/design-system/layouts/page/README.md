# Page layout

These primitives own business-neutral content width, page heading structure,
section boundaries, spacing, inline groups, and responsive grids. Features own
the rendered text, controls, and composition decisions.

## `PageContainer` — the canvas

`width="standard"` is the canvas every company workspace page uses: **1200px of
content** (`--ds-page-content-width`) centred between two 40px gutters
(`--ds-page-gutter`), 32px below the top bar and 48px after the last section.
The gutters are added to the width rather than taken out of it, so the content's
left edge is the same on every `standard` page at every width. Under 768px the
gutters are 16px (`--ds-page-gutter-mobile`), with 20px above and 40px below.

`width="wide"` (the default) is for work surfaces with side panes — the
application prep editor, the unfinished-application review — up to 1600px
including its gutters. Do not nest one container in another; that doubles the
gutter.

## `PageHeader`

```jsx
<PageHeader
  back={{ label: 'Leads', href: '/company/leads', onClick: routeInScript }}
  eyebrow="Driver applications & leads"
  title="Add lead"
  description="Manually add a new lead to your pipeline."
  actions={<><Button>Cancel</Button><Button variant="primary">Save Lead</Button></>}
  mobileActions="sticky"
/>
```

| Prop | Notes |
|---|---|
| `title` | the page's `<h1>`: 30px (`--ds-font-size-heading-2xl`), bold, balanced over its lines; 24px under 768px |
| `eyebrow` | a non-empty string: the section the page belongs to, drawn above the title in capitals in the brand colour |
| `back` | `{ label, href, onClick? }`: a link back, before the eyebrow with a short rule between them. It is a `Link`, so it needs an `href`; a page that routes in script also passes `onClick` and calls `preventDefault`. A 44px target on a phone |
| `count`, `countLabel` | the number of records beside the title (below) |
| `description` | under the title row, at most 68 characters a line, no one-word last line |
| `actions` | on the title's row at its right, centred on the title line (a 44px button overhangs the 34.5px line rather than making the row taller); secondary first, primary last |
| `mobileActions` | `'row'` (default) or `'sticky'` — what the actions do under 768px |
| `level` | `1` (default) or `2` |
| `headingRef` | reaches the heading, for a page that moves focus to it |

The DOM order is always **title, description, actions** — the header is a grid
that draws the actions on the title's row on a wide screen and after the
description on a phone, so reading and Tab order are the same at every width.
The title keeps at least 20rem beside the actions; with less room the actions
wrap among themselves, on their side of the title row, rather than squeeze it
into a column of short lines.

**Under 768px** the order on screen is the DOM order: eyebrow, title,
description, then the actions as a full-width row, each child an equal share.
With `mobileActions="sticky"` the same actions element is pinned to the bottom
of the screen as a white bar with a top rule, clear of the safe area — for a
one-form page whose Save must stay in reach — and a `PageContainer` holding it
adds the bar's height to its bottom padding. The scroll container — the
document, or the application frame's `<main>` however deep the page sits in it
— takes the same height as `scroll-padding-bottom`, so a field that Tab scrolls
into view stops above the bar rather than under it (WCAG 2.2 SC 2.4.11, Focus
Not Obscured). A page that scrolls inside some other element is not covered:
it would need the same `scroll-padding-bottom` on that element. The height is
one row of controls, so keep a sticky bar to one or two actions that fit on one
row. The bar is page content on `--ds-z-raised`, so the top bar, the navigation
drawer and every dialog cover it. Do not combine it with a `SaveBar` on one
page.

### The count

`PageHeader` takes `count` and `countLabel` on a list page: the number of
records beside the `<h1>`, outside it, so the heading keeps the page's name. The
screen shows the number; a screen reader reads it with its word ("8
applications"), and hears it change, because the count is a `status` region.
Leave `count` out while the number is unknown; with `countLabel` given, the
region stays in place, empty, so the number that arrives is announced.

### Levels

`PageHeader` is the page's `<h1>` unless `level={2}`: a shell whose masthead
already holds the one `<h1>`, as Super Admin's does, passes `2`, and the title
keeps the 24px step under the masthead. A page that moves focus to its heading
after an action (the row that held focus was removed) passes `headingRef`; the
heading is then focusable from script, not from Tab.

## `PageEyebrow`

The line above a title on its own, for a frame that holds several pages under
one eyebrow and draws it once (Company Settings: "Settings" above every
section, or "← Settings" where the section list is its own page). It takes the
same `eyebrow` and `back`, draws nothing when given neither, and sits
`--ds-space-2` above the page's `PageHeader`, which then has no eyebrow of its
own.
