# Icons

The icon contract. Approved 2026-09-05.

```jsx
import { Icon, Trash2 } from '@/design-system/icons';

<Icon icon={Trash2} size="sm" />
<Icon icon={Trash2} label="Delete" />   // when the glyph IS the control
```

## The scale

| Step | Size | Use |
|---|---|---|
| `xs` | 12px | Inside a badge, a chip, a dense corner affordance |
| `sm` | 14px | Beside 13px text; the `sm` control step |
| `md` | **16px** | The default. Beside body text and in `md` controls |
| `lg` | 18px | The `lg` control step; a section heading |
| `xl` | 20px | A page heading, a prominent single action |
| `2xl` | 24px | A medallion, an empty state, a disclosure chevron |

The steps are `--ds-icon-size-*` in `tokens/foundation.css`, and
`--ds-control-icon-{sm,md,lg}` — which named the same three numbers first — are
now aliases of `sm`/`md`/`lg`. One vocabulary, because two would drift.

Nothing below 12px: a stroked glyph loses its interior and reads as a smudge.

## A glyph is a token, not a component

`glyphs.js` exports 171 **tokens**. A token cannot be rendered:

```jsx
<Trash2 size={13} />   // throws, by name, at the call site
```

That is the guard, and it is deliberate. The obvious shape for the registry is
`export { Trash2 } from 'lucide-react'` — and it would have achieved nothing.
Moving 209 files onto a new import path while every one of them keeps passing
whichever pixel number it already passes is the campaign's failure mode wearing
the campaign's clothes.

A static rule cannot close that gap, because the commonest shape hides the name
entirely:

```jsx
const Glyph = ICONS[status];
<Glyph size={16} />          // no name in the source for a rule to match
```

The token catches it, and every other spelling, without knowing any of them.

## Containers still size their own glyph

`Button`, `IconButton`, `Tabs`, `Chip`, `SegmentedControl`, `FileInput` and
`StatusMedallion` each decide how big the glyph inside them is, and they still
do. `Icon.css` states its sizes through `:where()`, which has zero specificity,
so those container rules win every argument exactly as they did when the glyph
came straight from the package.

Written the obvious way (`.ds-icon[data-size='md']`, specificity 0-2-0) this
file would have silently overridden them and made every icon in every button
16px regardless of the button's size.

`Icon` also never passes `size` through to the glyph. That would set width and
height **attributes**, which a stylesheet cannot override at a breakpoint — and
the container rules depend on being able to.

## The medallion was on that list before it was true

**`StatusMedallion` joined that list on 2026-09-06, and the day it did not
belong on it is worth keeping.** Phase 4 wrote the sentence above as though it
were already true of every container that holds a glyph. Measured against the
CSS, only five carried a `> svg` rule; the medallion set its own diameter and
left the glyph to the call site. So every call site chose: 24 in the catalog and
in both patterns that render one, 28 in the signing room, 40 in the
locked-feature modal, 48 after a bulk upload. `PageState` and `ConfirmDialog`
each carried a comment admitting 24 was not a decision — it was what a bare
lucide glyph rendered before this contract existed.

Phase 7 found it, because a size that is not on the scale is exactly the signal
that a container is missing: sixteen of the thirty-two off-scale glyph sizes in
the whole application are one role — a large glyph announcing a page-level
state — wearing four different numbers.

`Badge`, `DataTable` and `SectionNavigation` still do not size their glyphs.
Nothing off-scale lands in them today, so that is a note rather than a defect;
`StatusMedallion.css` records the ratio the medallion's two steps come from, and
is the model if one of those three ever needs the same treatment.

## Announced, or not — never neither

A glyph is either decoration beside a word, where a screen reader announcing it
is noise, or it is the whole control, where it must carry a name or the control
is announced as nothing at all. There is no safe default between those, so the
prop decides: no `label` is `aria-hidden`, a `label` is `role="img"` with that
name, and a blank `label` throws rather than announcing an image and then saying
nothing about it.

## Adding a glyph

Two lines in `glyphs.js`: import it aliased, export it wrapped. The registry
holds every name measured in use on 2026-09-05 and nothing speculative, so a
call site being migrated should never need one — but adding one is not an event.

## The migration, and what ends it

178 files still import from `lucide-react` directly, recorded in
`lucide-import.backlog.json`. Until that reaches zero, `Icon` also accepts a
bare icon component and design-system containers resolve their `icon` prop
through `glyphComponent`, because those files still hand raw components across
prop boundaries — `<PageState icon={AlertTriangle} />` has to keep working while
its file is unmigrated.

`check:icon-contract` enforces the campaign over `src/` — the application, the
same scope `check:ui-contract` governs, because that is what Vite bundles and a
fixture in `scripts/` describing an import is not an import. The backlog is a
**record of debt, not an allowlist**: a file not listed may not name the
package at all; a
listed file may never take more glyphs than its recorded count; a listed file
that reaches zero must lose its entry, and the check fails until it does; an
entry for a path that no longer exists fails too, so a rename cannot carry an
exemption. When the last entry goes, so does the file.

It is deliberately **not** an allowlist rule in `check:ui-contract`. That
records an exception as a hand-written reason naming the roadmap row it rests
on, which is right for a decision and wrong for 178 entries whose reason is "not
migrated yet" — 178 boilerplate reasons is the `debt` escape hatch this
repository already deleted once, renamed.

And the direction is measured against **git, not the branch**: a change that
adds a file together with its own entry, or raises a count to match a file it
just grew, is refused, because a gate must not take its scope from the branch it
is gating.

When it is drained the only source of a glyph is this directory, every value
flowing into `icon` is a token, and the passthrough branch is deleted with
nothing left for it to catch.

## Branded artwork is not an icon

The SafeHaul mark (`Logo.jsx`) and the loader (`SafeHaulLoader.jsx`) stay
outside this contract and must not be approximated with a generic glyph. They
carry brand colour from `--ds-color-brand-*` and are pinned by
`src/tests/brandAssets.test.jsx`.

## Two things the measurement found

**33 of the 171 names are lucide compatibility aliases** whose canonical name
has since changed: `AlertCircle` is today's `CircleAlert`, `Home` is `House`,
`Filter` is `Funnel`, `Loader2` is `LoaderCircle`. The registry keeps the names
this codebase actually writes, which is why `glyph()` takes the name rather than
reading `displayName` — deriving it would have renamed a fifth of the registry
to identifiers that appear nowhere in the repository.

**`UploadCloud` and `CloudUpload` are the same drawing**, and both are in live
use. Both are exported so no call site has to be renamed in order to be
migrated; collapsing them is a Phase 7 tidy with no visual consequence.
