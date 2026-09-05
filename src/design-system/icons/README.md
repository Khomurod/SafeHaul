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

`Button`, `IconButton`, `Tabs` and `FileInput` each decide how big the glyph
inside them is, and they still do. `Icon.css` states its sizes through
`:where()`, which has zero specificity, so those container rules win every
argument exactly as they did when the glyph came straight from the package.

Written the obvious way (`.ds-icon[data-size='md']`, specificity 0-2-0) this
file would have silently overridden them and made every icon in every button
16px regardless of the button's size.

`Icon` also never passes `size` through to the glyph. That would set width and
height **attributes**, which a stylesheet cannot override at a breakpoint — and
the container rules depend on being able to.

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

178 files still import from `lucide-react` directly. Until that reaches zero,
`Icon` also accepts a bare icon component and design-system containers resolve
their `icon` prop through `glyphComponent`, because those files still hand raw
components across prop boundaries — `<PageState icon={AlertTriangle} />` has to
keep working while its file is unmigrated.

The guard that refuses a NEW `lucide-react` import, and the recorded list of the
178 that exist, land with the migration campaign rather than here: a backlog
file nothing reads is a list, not a ratchet. When it is drained the only source
of a glyph is this directory, every value flowing into `icon` is a token, and
the passthrough branch is deleted with nothing left for it to catch.

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
