# Avatar

**Status: Approved.** Added 2026-09-05, replacing eight hand-built discs.

A disc standing for a person or an organisation.

```jsx
import { Avatar } from '@/design-system/components';

<Avatar size="sm" tone="accent">{initials}</Avatar>
<Avatar size={{ base: 'lg', sm: 'xl' }} tone="info" bordered>{initials}</Avatar>
<Avatar shape="square" tone="neutral">{companyInitials}</Avatar>
```

## Props

| Prop | Values | Notes |
|---|---|---|
| `size` | `xs` 20 · `sm` 32 · `md` 40 (default) · `lg` 48 · `xl` 64, or `{ base, sm }` | pixels; the responsive pair swaps at 640px |
| `shape` | `circle` (default), `square` | a person is a circle |
| `tone` | `neutral` (default), `info`, `success`, `warning`, `danger`, `accent`, `primary`, `inverse` | |
| `bordered` | boolean | a 2px surface ring, for a disc overlapping something |

## The scale is fixed, and it is not ours

Every published system checked exposes a fixed set of steps and lets the
consumer pick one:

| System | Steps (px) |
|---|---|
| [GitHub Primer](https://primer.style/product/components/avatar/) | 16, 20, 24, 32, 40, 48, 64 |
| [Shopify Polaris](https://polaris-react.shopify.com/components/images-and-icons/avatar) | 20, 24, 28, 32, 40 |
| Atlassian | 16, 24, 32, 48, 96 |
| [Red Hat](https://ux.redhat.com/elements/avatar/guidelines/) | nine steps, default 64 — "chosen by the consumer" |

None of them lets the component read the viewport and decide for itself. The
five steps here are all Primer steps, and they are exactly the sizes this
product already used.

Two sizes in the tree were **not** on it:

- **36px** (`CompanyTopbar`, `UsersView`). Primer's scale skips it for a
  structural reason — base-4 to 32, base-8 from there — so both moved to 40.
- **24px** (`BulkUploadLayout`). Not an avatar: a numbered step marker in a
  progress indicator. It stays where it is.

## `size` also takes a responsive pair

Primer types its own prop `number | { narrow?, regular?, wide? }`. A responsive
avatar is first-class API in the reference system for exactly this kind of dense
application, because a record header legitimately wants a larger disc where
there is room and a smaller one where there is not.

`{ base, sm }` is the same idea in this repository's breakpoint vocabulary —
`base` is the phone, `sm` is Tailwind's 640px, which is the breakpoint the one
consumer that needs this already used by hand. Passing the same step twice
throws: that is a plain string spelled the long way.

The driver dossier's header is that consumer, and it is unchanged at both
widths. What changed is that the pair now lives in the contract instead of in a
`sm:h-16 sm:w-16` at the call site.

## Circle or square is a rule, not a preference

Primer states it outright: *"Circle Avatars represent individual people. Square
Avatars represent non-human entities, such as bots, AI agents, teams, or
organizations."* A square avatar keeps the control radius rather than going
fully sharp, so it still reads as part of the same family.

## Always hidden

An avatar restates a name that is already beside it, so announcing "M" before
"Maria Garcia" is noise. There is no prop to un-hide one, and passing
`aria-hidden="false"` does nothing.

**Five of the eight discs this replaced were not hidden**, so a screen-reader
user heard the initial read out as content.

## A disc holding a glyph is not this

Twenty-five round discs were measured in the product and only **eight** were
avatars. The other seventeen are four different things that happen to be
circles:

| What | Belongs to |
|---|---|
| A glyph in a disc — an empty-state medallion | `StatusMedallion` |
| An unread-count badge | no primitive; feature-owned |
| A numbered step marker in a progress indicator | no primitive; recorded as a gap |
| A radio dot, a selection indicator | the form controls that own them |

That is why `check:ui-contract`'s `hand-rolled-avatar` rule reads what a disc
**holds** — a person's initial — rather than its shape. A shape-only rule
matched all 25 and would have demanded `Avatar` for every one of them.
