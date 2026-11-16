# Badge

Badge is a business-neutral label with a semantic tone and optional icon.
Feature modules own the label, domain vocabulary, and tone mapping.

```jsx
<Badge tone="success" icon={CheckCircle2}>Signed</Badge>
```

| Prop | Values | Notes |
|---|---|---|
| `tone` | `neutral` (default), `info`, `success`, `warning`, `danger`, `accent` | the status tints; an unknown tone throws |
| `icon` | a glyph token from `@design-system/icons` | drawn at `xs` (12px) before the label |

A badge is a borderless pill: the tone's tint behind a 12px label in the medium
weight, 24px tall, as wide as its label and no wider (`width: fit-content`, so a
column flex parent cannot stretch it). The tint and the label are the pill on
screen. Its 1px border is kept, transparent, because forced-colours mode paints
a transparent border in the system text colour — without it a badge in a
high-contrast theme is bare text.

Status is never colour alone: the label carries the meaning, and a glyph (when
the feature passes one) repeats it. An icon-less badge gets no dot; the label and
the tint already say it.
