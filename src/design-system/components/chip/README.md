# Chip

**Status: Approved.** Added 2026-09-05, retiring six recorded exceptions across
four files.

The interactive twin of `Badge` — the same pill, the same 12px semibold text,
the same six status tints, the same 12px leading glyph — plus a pointer, a focus
ring and a pressed state.

```jsx
import { Chip, ChipGroup } from '@/design-system/components';

<ChipGroup ariaLabelledBy={statusLabelId}>
  {options.map((option) => (
    <Chip key={option.id} pressed={selected.includes(option.id)} onClick={() => toggle(option.id)}>
      {option.label}
    </Chip>
  ))}
</ChipGroup>

<Chip href={`tel:${phone}`} tone="success" icon={Phone}>{formatted}</Chip>
```

## Props

| Prop | Values | Notes |
|---|---|---|
| `size` | `xs` (default), `sm` | 24px and 36px |
| `tone` | `default` (quiet outline), `neutral`, `info`, `success`, `warning`, `danger`, `accent` | applies when not pressed |
| `pressed` | `true` / `false` / omitted | omitted means "not a toggle" — no `aria-pressed` at all |
| `icon` | a glyph token from `@/design-system/icons` | rendered at `xs`, beside the check when pressed |
| `href` | a URL | renders an `<a>`; without it, a `<button type="button">` |
| `external` | boolean | `target="_blank" rel="noopener noreferrer"`; refuses without `href` |

`ChipGroup` takes `ariaLabel` **or** `ariaLabelledBy` and refuses to render with
neither. Prefer `ariaLabelledBy` when the words are already on screen — an
`aria-label` duplicating a visible label is how the two drift apart.

## Sizes are the shared control steps, not a private scale

`xs` is the same 24px as `IconButton size="xs"` — the WCAG 2.2 SC 2.5.8 target
minimum — and `sm` is the same 36px as `Button size="sm"`. Naming them after the
steps they use is what lets a chip line up with the control beside it, and
`check:visual-contract` measures one of each pair in the same story so the claim
fails as a number rather than as somebody's misaligned toolbar.

## Pressed is never colour alone

`pressed` sets `aria-pressed` **and** draws a leading check. The fill is the half
that disappears in forced-colours mode; the check is the half that survives. The
same reasoning is recorded in `SegmentedControl.css` for its selected option.

Tone applies to the un-pressed state only. A pressed chip fills with
`action-primary` whatever its tone, because a tinted "on" competing with a tinted
"off" says nothing at 24px — and both consumers that hand-wrote this already
filled with primary.

## What it is not

- **not `Button`.** A 24px pill with 12px text is deliberately off the button
  scale, which starts at 36px and refuses anything under it except the icon-only
  `xs` step.
- **not `SegmentedControl`.** That is a 44px card grid and single-select by
  contract — its `value` is a scalar. The campaign audience filters are a
  multi-select `status` array, and adopting it would double the height of a
  filter strip sitting above a dense table. Measured twice, and recorded in both
  allowlist entries this component retired.
- **not `Link` / `ButtonLink`.** Underlined text and a button-shaped anchor. A
  tinted inline token is neither.

## `href` and `pressed` together throw

A link goes somewhere; it is not a two-state control, and `aria-pressed` on an
anchor is invalid ARIA. A screen reader announcing "link, not pressed" for a
phone number is worse than silence, so this is a refusal that names both fixes
rather than a quiet drop.

The audit that produced this component corrected the gap it was written from:
the roadmap recorded "a tinted pill that is also a `tel:` link" and cited two
sites, but only one of them is a link — the candidate list's call chip is a
`<button>` that opens the call-outcome dialog. A link-only primitive would have
shipped and left it unmigrated.

## The other half of the toggle contract

`Button` and `IconButton` also take `pressed`, for a toggle that must keep its
variant — the candidate list's sort arrows, which are icon-only at 24px and are
not chips. See `../button/README.md`.

`check:ui-contract`'s `hand-rolled-toggle` rule refuses a raw `<button>` or `<a>`
carrying `aria-pressed` anywhere outside the design system's own source, so the
shape cannot come back by hand.
