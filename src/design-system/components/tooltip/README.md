# Tooltip

The name of an icon-only control, shown beside it while the pointer is over it
or it has keyboard focus. Its one consumer is the company sidebar folded to its
glyphs.

```jsx
<Tooltip label="Settings" disabled={sidebarOpen}>
  <NavLink to="/company/settings" aria-label="Settings">…</NavLink>
</Tooltip>
```

## Rules the tests pin

- **The control names itself.** The label is `aria-hidden`: give the control an
  `aria-label` (or its own words), so a screen reader hears the name once.
  `label` is required and throws when empty.
- **Drawn on `document.body`**, fixed to the viewport 8px right of the control's
  middle (`placement="right"`, the only placement yet), on the dropdown layer. A
  scrolling or clipped container around the control cannot cut it off; it
  follows the control on scroll and resize.
- **WCAG 1.4.13.** It stays while the pointer crosses onto it (a 120ms grace),
  stays until hover or focus ends, and Escape dismisses it.
- **Keyboard focus shows it, a click's focus does not** (`:focus-visible`).
- **`disabled` shows no label**, and hides one already shown: an open menu,
  where the words are on screen, needs none. The control is never remounted.
- **It wraps nothing.** Its child is one element that forwards its ref (a link,
  a `Button`); the handlers go on that element, beside its own, so the control
  keeps its place and its parent's spacing (`space-y-*`) exactly. Anything else
  throws.

## Not for

- Anything a person must read to use the page: put it on screen.
- Interactive content (links, buttons): that is a popover or a dialog.
- A touch screen's only way to learn a name: a control there carries its words.
