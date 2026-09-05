# Notice

**Status: Approved.** Built 2026-09-05 (slice 6b), from the audit recorded
below (slice 6a). The audit is kept in full rather than summarised, because
every default in the API is a number from it and a future change should have to
argue with the measurement rather than with a preference.

Consumers are migrated in 6c–6e; this slice ships the primitive and its
catalog entry only.

## API

| prop | values | default | why |
|---|---|---|---|
| `tone` | neutral · info · success · warning · danger · accent | `info` | replaces two hand-written tone lookup tables |
| `title` | string | — | the majority shape: 27 of 64 |
| `icon` | a registry glyph, or `null` | the tone's own | `null` hides it; `undefined` takes the tone's |
| `actions` | node | — | 9 consumers carry a button |
| `size` | md · sm | `md` | |
| `announce` | off · polite · assertive | **`off`** | only 26 of 64 announce today |
| `className` | string | — | margin and width only |

`forwardRef` so a form can move focus to it; pass `tabIndex={-1}` alongside.

### The glyph is decorative

`Icon` with no label renders `aria-hidden`, so a screen reader hears the
sentence once rather than "warning icon, warning:". The tone is never the only
signal — the words carry the meaning, and the border and fill are reinforcement.

### Per-tone defaults, counted rather than chosen

| tone | glyph | what the tree uses |
|---|---|---|
| danger | `AlertCircle` | AlertCircle ×13, AlertTriangle ×5, Info ×1 |
| warning | `AlertTriangle` | AlertTriangle ×4, AlertCircle ×2 |
| info | `Info` | Info ×3, Zap ×1, Loader2 ×1 |
| success | `CheckCircle2` | CheckCircle ×6, CheckCircle2 ×1 |
| accent | `Sparkles` | Sparkles ×1 |
| neutral | `Info` | nothing uses a neutral notice yet |

Two deliberate departures, stated rather than slipped in:

- **success takes `CheckCircle2`**, against a tally favouring the older
  `CheckCircle` 6 to 1. The two are different marks — one breaks the tick out
  through the ring, the other closes it — and the closed form is what reads as a
  success mark and what `SectionNavigation` already ships for `status="complete"`.
  One vocabulary inside the design system beats matching a majority outside it.
- **neutral takes `Info`** on no evidence at all, because nothing uses a neutral
  notice yet. Revisit when a consumer appears.

### `flex-start`, not centred

A one-line notice looks identical either way. The majority shape is a title with
a body under it, where centring floats the glyph into the middle of a paragraph.

### Actions wrap below 640px

Nine consumers carry a button, and a button beside a sentence at 412px leaves
neither enough room. Below the breakpoint the actions drop under the message and
indent to align with it.

---

# The shape audit that produced this

## What a notice is here

A tinted, bordered block carrying a short message: "your application was
submitted but these documents are outstanding", "this company will be blocked
from logging in", a queue error. It is rebuilt by hand at every site because no
primitive owns it — `FieldMessage` is scoped to one form field, `Badge` is a
chip, `PageState` is a whole slot.

Its signature in this tree is `bg-ds-status-<tone>-bg` beside
`border-ds-status-<tone>-border` for the same tone. Every one uses `--ds-*`
roles, so this is **composition drift, not palette drift**, which is exactly why
no existing rule sees it.

## The count, and how it was reached

The roadmap recorded **109 lines across 87 files** and said honestly that the
number included recorded exceptions and that the true count "was not enumerated
one by one". Enumerating it moved both figures.

Three line-based passes gave 74, then 67, then 65 — all estimates dressed as
counts. The tell was that the "is this a tinted container rather than a notice"
test was **window sensitive**: 7 at a ten-line window, 12 at twenty, 14 at
thirty. A window cannot tell a form control *inside* the tinted element from one
that merely follows it.

So the tree was parsed (`@babel/parser`, JSX plugin) and every element carrying
the signature in its own opening tag was asked whether a form control appears in
**its own subtree**:

```
 70  elements whose opening tag carries the signature
 -6  hold a form control -> a tinted container, not a notice
———
 64  notices borne by an element
 +2  components whose tone comes from a lookup table, so the
     signature sits in an object rather than an opening tag
———
 66  NOTICES
```

`.js` files carry the signature **zero** times, so `.jsx` is the whole tree.

**Count elements, not lines.** A line count double-counts a ternary
(`success ? '…-success-…' : '…-danger-…'` is two lines, one notice) and a tone
lookup table (one line per tone, one notice). Both errors point upward, which is
why every estimate came in high.

## What it is NOT — six tinted containers

These hold form controls. They are highlighted *regions*, not messages, and
`Notice` is the wrong remedy for every one:

`CompanyBulkUpload:138` · `ApplicationFormsPanel:81` · `UserProfilePage:352` ·
`Step9_Consent:301` · `SafetySection:43` · `CallOutcomeModalUI:199`

This is the fourth consecutive slice where a shape-only signature would have
demanded the wrong component — 17 of 25 round discs were not avatars, 10 of 11
`aria-expanded` controls were not disclosures, 3 of 5 `aria-current` sites were
not selectable. Expect it rather than be surprised by it, and scope the rule in
6f accordingly.

## Five shapes, measured

Of the 64 element-borne notices:

| shape | count | what it is |
|---|---|---|
| title + body | 27 | a bold line and a sentence or list under it |
| icon + sentence | 14 | one glyph, one line of text |
| plain sentence | 14 | text alone, no glyph |
| with actions | 9 | a `Button` inside the block |

The plan predicted roughly ~30 icon+sentence and ~12 title+body. It is the other
way round: **title+body is the majority shape**, so `title` is not an optional
extra bolted onto a one-line component — it is what most consumers need.

## Two splits that decide defaults

### Announcement — 26 of 64 announce themselves

26 carry `role="alert"`, `role="status"` or `aria-live`; **38 are silent**.

So `announce` should default to **off**. A component that announces by default
would turn 38 quiet blocks into interruptions, and most of them are describing
something already visible on the page. The 26 that do announce are the ones the
migration sets explicitly.

### Icon — 37 of 64 carry one

37 have a glyph, 27 do not. Roughly even.

Polaris (`Banner`), Carbon (`InlineNotification`) and Atlassian
(`SectionMessage`) all show a tone icon by default, so **defaulting to one is
the published standard** and is what should ship.

Say plainly what that costs: it **adds an icon to about 27 places that have
none**. That is a visible change across a good part of the application and
belongs in the migration PR's own description, reviewed at both widths — not
arriving as a component default nobody announced.

## Already recorded as exceptions, and excluded throughout

`SignerField` · `ResizableDraggableField` · `candidateListColumns` ·
`RequiredDocumentsChecklist` · `InlineValidationNote` · `NotesTab` ·
`fieldDefinitions` · `AiSuggestionOverlay`

These are PDF field overlays, a field-type colour legend and badge-tone maps —
tinted for identity, not to carry a message.

## Two absorbed, one migrated

- **`SubmissionRecordNotice`** and **`QueueStatusIndicator`** are the two
  tone-lookup components. Their tone maps are literally what `Notice`'s `tone`
  prop becomes, so both are absorbed rather than migrated.
- **`ConfirmDialog:153` sits inside `src/design-system/` itself** — a
  `<p role="alert">` with an `Info` glyph and the error text, in an
  always-mounted live region. The answer is **migration, not exemption**: a
  design-system pattern should consume the design-system component. 6f's
  `design-system/` exemption does not need to cover it.

## What 6b has to build, read off the above

- `tone` — the six status roles, replacing two lookup tables.
- `title` optional but first-class; it is the majority shape.
- `icon` with a per-tone default, `null` to hide.
- `actions` slot — 9 consumers.
- `announce` defaulting to **off**; polite/assertive set by the 26.
- `size` md/sm, and `className` for margin and width only.

Nothing here is a decision waiting on an owner. The one thing to surface in the
migration is the added icons.
