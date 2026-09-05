# Disclosure

A collapsible section: a header that expands and collapses its own content.

The roadmap recorded why `Button` could not supply this. The trigger must fill
its rail edge to edge, carry a rotating affordance, and sit **inside a heading**
so the section appears in the document outline. `Button`'s padding and inline
layout express none of those.

## Why not `<details>` / `<summary>`

Genuinely tempting and genuinely wrong here:

- Its open/closed state lives in the DOM rather than in React state, so a
  sidebar that remembers which sections are open has to fight it.
- `<summary>`'s marker and focus behaviour are still inconsistent enough across
  browsers that every real use ends up overriding them anyway.

A `<button aria-expanded>` inside a heading is what the WAI-ARIA Authoring
Practices describe for this case.

## More than one may be open

That is the property one consumer chose this over a tab strip for. If exactly
one region should be visible at a time, you want `Tabs`, not several of these.

## Controlled and uncontrolled

Pass `open` + `onToggle` for a rail that remembers its sections. Pass
`defaultOpen` and nothing else for a section that just opens and closes.

## Rules the tests pin

- **The heading wraps the button**, not the reverse. A button containing a
  heading is not a heading, and the section vanishes from the outline.
- **`aria-expanded` carries the state.** The chevron rotation is decorative and
  never the only signal.
- **Content is unmounted when closed, not `hidden`.** A stale focus target
  inside a collapsed section is otherwise reachable by find-in-page and by
  screen-reader browse mode.
- **`headingLevel` matches the surrounding outline**; default `3`.

## `variant`

| | `default` | `card` |
|---|---|---|
| Where it goes | a sidebar rail, flush to the edge | inside a `Card` |
| Title | 12px, bold, uppercase, letter-spaced, truncates | `heading-sm`, bold, wraps |
| Extras | `meta` — a trailing count | `description`, `leading` |
| Chevron | 16px, inherits the trigger colour | 24px, link colour |
| Hover | tints, to say which row of a stack you are on | nothing — it is the only control in its card |

### `card` does not draw a card

`Card` owns the surface, border, radius and padding. The variant only takes off
the rail chrome — the section's bottom border, the trigger's own padding, the
hover tint — so a disclosure sits correctly **inside** one. It is named for
where it goes, not for what it paints.

```jsx
<Card padding="md">
  <Disclosure
    variant="card"
    title="How to connect a mailbox"
    description="Step-by-step guides for three providers"
    leading={<span className="rounded-ds-md bg-ds-action-primary p-ds-2">…</span>}
    open={showGuide}
    onToggle={setShowGuide}
  >
    …
  </Disclosure>
</Card>
```

### `leading` is a slot, and the wrapper hides it

Whatever you pass sits inside an `aria-hidden` wrapper, so a caller cannot
forget. What goes in it is the feature's business — a toned tile, a product
mark, a glyph — and none of it may carry meaning the title does not already
say.

There is deliberately no tile primitive behind it. A filled square icon tile
appears at four sites in this tree and is recorded as its own roadmap gap;
building one *inside* `Disclosure` would be the wrong home for it.

### The description is part of the trigger's accessible name

The whole header is one control, so everything visible in it is announced.
Choosing a description is choosing part of the name — keep it short, and never
put anything there that would read as a second sentence of instructions. This
is unchanged from the markup the variant replaced, and a test pins it.

### Combinations that throw

- `description` or `leading` without `variant="card"` — the rail's 12px
  micro-label has room for neither.
- `meta` with `variant="card"` — it would fight the chevron for the same
  trailing slot.

Each is a layout nobody has built or reviewed. Refusing costs a caller one
error message; shipping one untested costs a reviewer a screenshot they did not
know to take. Lift either when a consumer needs it, with a story and a probe.

## The guard

`hand-rolled-disclosure` counts a `<button aria-expanded>` **inside a heading**.

Not "a raw `<button aria-expanded>`", which was measured first and matched two
elements in the whole tree — this one and a bottom app-bar tab that would then
need a recorded reason to buy it off. The eleven live `aria-expanded` sites are
mostly not disclosures at all: four menu triggers, a combobox (where the
attribute sits on an `<input>`), a navigation group, a drawer trigger, a filter
toggle, a row expander. `Disclosure` replaces none of them, and nine are already
on `Button` or `IconButton`.

The heading is what separates the one from the ten, because a disclosure
*section* puts its trigger inside one so the section reaches the document
outline. So the other ten are left alone by their own structure rather than by
an exemption list, and this rule needs no entry in `CONTRACT_EXEMPT_RULES` —
this component renders `<Heading>`, a capitalised binding for the caller's
level, and the rule reads lowercase `h1`–`h6` only.
