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
- stack and compact grid mobile layouts without an inner horizontal scroller.

It does not own routes, permissions, feature flags, tab state, data loading, or
business vocabulary.

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
