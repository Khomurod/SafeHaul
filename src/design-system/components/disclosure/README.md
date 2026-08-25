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
