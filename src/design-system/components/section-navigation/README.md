# SectionNavigation

`SectionNavigation` is the approved business-neutral pattern for switching
between grouped sections inside a feature workspace. Features own group labels,
item availability, the current identifier, and the content rendered after a
selection.

The component provides:

- a labelled navigation landmark and labelled groups;
- `aria-current="page"` for the selected destination, or `"step"` when
  `currentType="step"` says the rail is a position in a process;
- optional `aria-controls` linkage to the content region;
- 44px minimum targets, visible focus, selected, hover, and disabled states;
- Arrow Up/Down, Home, and End focus movement without replacing native Tab
  order;
- stack and compact grid mobile layouts without an inner horizontal scroller;
- an optional second line per item (`item.description`).

It does not own routes, permissions, feature flags, tab state, data loading, or
business vocabulary.

## The C2 rail

The rail is a card: border, radius and elevation come from the card roles
(`--ds-card-border`, `--ds-card-radius`, `--ds-card-shadow`), so it sits beside
the page's other cards as one of them. Its **width and stickiness are the
consumer's** — the company settings frame gives it 288px, sticky beside the
content.

- **Group headings**: 12px semibold capitals, `0.08em`, `content-muted`.
- **Items**: a 20px glyph column and the label (14px medium, `content`).
- **The current item**: `--ds-color-surface-selected` (the brand tint) and the
  action navy (`--ds-color-action-primary`) on the label and the glyph, with a
  **semibold label** — the cue that is not a colour. Its 3px left border stays
  transparent, and in forced colours it becomes `Highlight` (the others
  `Canvas`), where the tint and the navy are both replaced. Hover tints only the
  items that are not current.
- **Kept on the scale against the C2 render**: 8px card padding and 12px insets
  (C2 10px, off the spacing scale), a semibold current label (C2 500 — the
  weight is the cue that is not a colour), `content-muted` (slate-600) glyphs
  (C2 slate-500, which `content-muted` deliberately is not), and 4px
  between items (C2 none).
- **An item with no glyph has no glyph column.** Before, its label was placed in
  the 20px track and broke after every second letter (the catalog's `Default`
  story showed it); with no glyph the template is one track (two with a status).

## `item.description`

```jsx
{ id: 'team', label: 'Team', icon: Users, description: 'Who recruits for you' }
```

A second line under the label, in the label's column: 12px, `content-muted`
(also on the current item), `line-height` tight, `text-wrap: pretty`, wrapping
rather than cut. A described rail draws the lighter **16px glyph** (C2), level
with the first line, in the same 20px column; a rail without descriptions keeps
its 20px glyph.

It is the item's **description, not part of its name**, and it is drawn
**beside the button, not inside it**: the line is a sibling of the `<button>` in
the `<li>`, linked with `aria-describedby`. So the button's visible text is
exactly its name — the label (and a step's status suffix) — and the item is found
and announced as "Team", followed by its description. Inside the button the line
was visible text the name lacked, which WCAG 2.5.3 (Label in Name) refuses: axe's
`label-content-name-mismatch`, serious, on every settings item. `aria-hidden` on
the line does not clear it; moving it out does. The rule is off by default in
axe, so the unit test switches it on.

The row still acts as one control:

- the button's `::before` is stretched over the whole `<li>` (`position:
  relative` on the `<li>`, none on the button), and the line is
  `pointer-events: none`, so a click or a tap anywhere on the row, the line
  included, is a click on the button;
- that `::before` is the row's box: it carries the hover and current fill and
  the focus ring, so both cover both lines; in forced colours the current row's
  `Highlight` bar runs down both lines;
- it sits under the text with **no `z-index`** (the stylesheet contract refuses
  a bare one and the `--ds-z-*` scale has no negative step): it is the first
  positioned box in the row's tree order, and the glyph, label, status and line
  are `position: relative` after it, so they paint over it. `isolation` on the
  `<li>` keeps that order inside the row;
- the button keeps the top and side insets and the `<li>` adds the bottom one,
  so a described row is as tall as it was with the line inside.

An item without one renders exactly as before: no ids, no `aria-describedby`, no
`data-described` (`description: null` counts as none). A description must be a
non-empty string; anything else throws (outside a production build). In every
layout, the phone `grid` included, the description sits tight under its label:
only the column gap tightens there.

## A page rail and a step rail

The same component, four props apart. A wizard rail is a rail: the same list,
the same keyboard behaviour, the same focus handling — what differs is what it
announces and where it sits.

| | page rail | step rail |
|---|---|---|
| `currentType` | `page` (default) | `step` |
| `frame` | `card` (default) — draws border, radius, padding, surface, shadow | `none` — the container already draws one |
| `group.label` | a heading, exposed as a named region | omit it; a single-group rail has no heading to give |
| `item.status` | absent | `complete` / `incomplete` |

`currentType` is not cosmetic. `aria-current="step"` is what ARIA defines for a
position in a process; a wizard announcing "current page" tells a screen-reader
user they navigated somewhere they did not.

A group with no `label` renders a plain `<div>` rather than a `<section>` with
no accessible name — a landmark element claiming nothing is worse than no
landmark.

## `item.status`, and what it announces

The glyph is decorative. The state is carried by a visually-hidden suffix that
becomes part of the item's accessible name, so the rail announces
**"Audience (completed)"** in one breath rather than leaving the state to a
colour. The leading space is deliberate and load-bearing.

The two glyphs differ in **shape** — a filled check against an empty ring — so
the state survives forced-colours mode and a monochrome print, which is the
rule `Chip`'s pressed state follows one component over.

## The third grid column is scoped, and that is not caution

An item is `grid-template-columns: 20px minmax(0,1fr)`. The status marker needs
a third track, and declaring it on the shared template would look free — an
empty `auto` track is 0 wide.

It is not free. Measured in Chromium before the decision:

```
20px minmax(0,1fr)        label width: 268px
20px minmax(0,1fr) auto   label width: 256px    (nothing in the third track)
```

Grid places its `gap` between every declared track whether or not anything sits
in one, so every item in every existing consumer would have quietly lost a
`--ds-space-3` of label width. The third column is therefore scoped to
`.ds-section-navigation__item[data-status]`, a unit test asserts no
`[data-status]` appears without one, and `check:visual-contract` reads both
templates — three tracks on a step item, two on an ordinary one.
