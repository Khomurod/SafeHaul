# Skeleton

**Status: Approved.** Its pixel baselines came from CI (run 41659416292) and were
looked at on a desktop (1440) and a phone (412) on 2026-11-03.

A grey placeholder where content is on its way and its shape is known, so the
page keeps its layout and nothing jumps or moves under the pointer when the
content arrives.

```jsx
import { Skeleton } from '@/design-system/components';

<p className="text-ds-heading-lg"><Skeleton width="half" /></p>
<Skeleton shape="block" height="lg" />
```

## Props

| Prop | Values | Notes |
|---|---|---|
| `shape` | `line` (default), `block` | a line stands in for text, a block for a tall control |
| `width` | `half`, `three-quarters`, `full` (default) | a share of the container |
| `height` | `lg` (152px) | `block` only, and required there; a `line` takes none |
| `className` | string | margin and placement |

The sets hold only what a consumer uses. A new width or height arrives with the
consumer that needs it. Anything else throws outside a production build; a
production build reports it and draws a full-width line (or an `lg` block).

## A line takes the height of its text

Put a `line` **inside** the element whose text it replaces — a heading, a
paragraph, a metric's value. It is 0.8em tall and centred on that element's
line, so the line box, and the layout around it, keeps the height it will have
when the text arrives. That is why a line takes no `height`.

`block` `lg` is 152px: the tallest choice button on the driver application's
start screen (145.5px at 1440), rounded up to a multiple of 8.

## Always hidden; its caller announces

A skeleton is always `aria-hidden`, and no prop un-hides it. A row of blanks
says nothing, so the caller announces once, in a polite `role="status"` that
exists before it fills: a group of cards once for the group (`MetricCard
loading` and the company dashboard's sentence), a page through its own heading.

## Motion

It pulses with the timing of `DataTable`'s skeleton rows (1.5s, half opacity at
the midpoint), so the two read as one family. Under `prefers-reduced-motion` the
pulse stops. `DataTable` keeps its own rows and keyframes.

## Mistakes

- **A skeleton with no announcement.** A screen-reader user hears nothing at
  all while it is on screen.
- **A skeleton shaped unlike what usually arrives.** It promises a layout and
  then breaks the promise; use `LoadingState` where the shape is not known.
- **A skeleton for an operation in flight** — a save, a send. That is
  `Button loading`, which keeps the control and its name.
