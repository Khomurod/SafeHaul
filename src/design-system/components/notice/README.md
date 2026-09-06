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
| `titleAs` | p · h2-h6 | `p` | 11 of 19 titles are paragraphs; 8 are real headings |
| `icon` | a registry glyph, or `null` | the tone's own | `null` hides it; `undefined` takes the tone's |
| `actions` | node | — | 9 consumers carry a button; renders **under** the message |
| `size` | md · sm | `md` | |
| `announce` | off · polite · assertive | **`off`** | only 26 of 64 announce today |
| `className` | string | — | margin and width only |

`forwardRef` so a form can move focus to it; pass `tabIndex={-1}` alongside. The
focus ring is the component's own — see below.

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
| accent | `Sparkles` | **none** — see the correction below |
| neutral | `Info` | none — nothing uses a neutral notice |

Three departures, all stated rather than slipped in:

- **success takes `CheckCircle2`**, against a tally favouring the older
  `CheckCircle` 6 to 1. The two are different marks — one breaks the tick out
  through the ring, the other closes it — and the closed form is what reads as a
  success mark and what `SectionNavigation` already ships for `status="complete"`.
  One vocabulary inside the design system beats matching a majority outside it.
- **neutral takes `Info` on no evidence**, because nothing uses a neutral
  notice. It is the least assertive glyph available.
- **accent takes `Sparkles` on no evidence either, and this is a correction.**
  The audit's first tally credited accent with one site,
  `EnvelopeSidebar:272`. Reading it while scoping the migration showed a
  `<Button>` and its own helper text inside a tint — a **call-to-action panel,
  not a message**. It is not a notice, it does not migrate, and accent therefore
  has **zero** consumers.

Both guesses are recorded as guesses, so the first real consumer of either tone
can overrule them without arguing with a number that was never there.

That correction also moves the audit's own figures by one: the parse counted 70
elements carrying the signature, and this is a seventh that is not a message —
**65 notices, not 66**. The pattern is now five slices deep: a signature alone
cannot tell a message from a container, a legend, or a button in a tinted box.

### `flex-start`, not centred

A one-line notice looks identical either way. The majority shape is a title with
a body under it, where centring floats the glyph into the middle of a paragraph.

### Actions sit under the message — changed after the first migration

This shipped in 6b with the actions in a trailing slot beside the message and a
`@media (max-width: 639px)` block that dropped them underneath on small screens.
6c's first consumers disagreed, so it was checked rather than defended:

- **Atlassian's `SectionMessage`** renders actions after the content — "this
  placement allows users to read the full message before encountering available
  actions".
- **Polaris' `Banner`** puts its primary and secondary actions in a footer under
  the body.
- **Carbon's inline notification** is the one published system that keeps the
  action inline, and it moves it underneath at narrow widths.
- **This tree already agreed 2 to 1**: `Step4_Violations` and `Step9_Consent`
  had the button under the message; only `UploadField` put it beside.

So the action row is a child of the body column, after the message, at every
width. The breakpoint rule was the evidence rather than the solution — **a
placement that has to be undone on small screens was never the right
placement** — and it is deleted. `flex-wrap` stays, because two buttons at
412px still need somewhere to go.

### `titleAs`, because eight titles here are real headings

The title renders as a `<p>`, which is what 11 of the 19 titled blocks in this
tree do. Eight use an actual `<h2>`, `<h3>` or `<h4>`, and both Polaris and
Atlassian render a banner title as a heading. Flattening those eight would take
them out of the document outline a screen-reader user navigates by — silently,
because the page looks identical either way.

`titleAs` takes the element and never a level the component picked: `p` when
there is no outline to join, `h2`-`h6` when the caller knows where it sits.
`h1` throws: a notice is never the page's own heading. The look does not change
with the element; the design system owns that.

### The focus ring belongs to the component

`forwardRef` plus the `tabIndex` pass-through exist so a form can move focus to
the error summary it just rendered — `StepIssues`, `Step3_License` and
`VerificationPortal` all do exactly that. Every one of them carried its own
`focus-visible:shadow-ds-focus` utility, which is a thing each new caller has to
remember and one of them eventually will not. Focus that lands somewhere
unmarked is worse than focus that does not move, so `.ds-notice:focus-visible`
draws the standard ring.

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

---

# What 6c found: the first migration area

**driver-app + verification + signing.** The audit above listed 20 sites here.
**Seventeen migrated.** Three came off the list on reading, which is the sixth
consecutive slice where a shape-only signature named the wrong component:

| site | why it is not a notice |
|---|---|
| `UploadField` uploading state | a `ProgressBar` and a percentage readout. The text labels the widget; the widget is the content. An info glyph beside a progress bar states nothing the bar does not. |
| `UploadField` success state | a file row: thumbnail, filename, status line, view and remove controls. A leading tick would displace the thumbnail and push the controls under the filename. |
| `StatusScreens:191` | a `<section aria-labelledby>` — a named **region** a screen-reader user can jump to and re-read the ESIGN terms in. `Notice` has no way to be a landmark: it would need `role="region"` plus an `id` on its own title. One consumer is not enough evidence to design a `titleId` prop around, so this is recorded as a gap rather than closed with a prop that would have a single caller — the same reasoning that records `accent`'s glyph as a guess. |

Three more were already excluded before the slice began — `Step9_Consent:301`
and `SafetySection:43` hold form controls, and `EnvelopeSidebar:272` is a
`<Button>` and its helper text inside a tint. Reading the whole of each changed
file also turned up three tinted blocks the audit never listed and that are
correctly not notices: a signed-confirmation pill (`Step9_Consent:266`), a
selected-state highlight in the suggestion list (`AiSuggestionReviewPanel:207`),
and the tone lookup map at the top of `PortalStatusScreens`.

## What changed in the component because of this area

Three things, each forced by a real consumer rather than chosen:

1. **Actions moved under the message** (see above) — the local majority and two
   published systems agreed against the shipped placement.
2. **`titleAs`** — eight titles in the tree are real headings.
3. **The focus ring** — three consumers here are the focus target a form moves
   to, and each was carrying its own utility class for it.

This is the whole reason 6b shipped with **zero consumers on purpose**. Had the
65 migrated in the same change, all three would have been baked into 52 files
before anyone read the first one.

## The visible changes this area makes, stated rather than slipped in

Seventeen blocks, each read individually. Every figure below is parsed off the
files as they were before the change, not counted off diff hunks — a hunk
boundary cannot tell a child from a neighbour, which is the same trap 6a's line
counting fell into three times.

**Glyphs**

| | sites |
|---|---|
| gains one, having had none | 7 |
| keeps the one it had, unchanged | 6 |
| `AlertTriangle` normalised to danger's `AlertCircle` | 2 |
| same glyph, moved from inside the text to the leading slot | 2 |

`PortalStatusScreens` is the only site passing `icon` explicitly: `ShieldCheck`
says *securely recorded*, which the success tick does not. It is also one of the
two that move — the glyph was inline in the sentence and is now leading, which
is better for a message that wraps and is a visible change either way.

**Type and geometry**

| | before | after |
|---|---|---|
| type size | 12px ×6, 13px ×8, inherited ×3 | 13px ×8 (`sm`), 14px ×9 (`md`) |
| radius | `lg` ×10, `md` ×6, none ×1 | `md` ×17 |

`size="sm"` is used at eight sites, each genuinely inside a tight container: the
sandbox banner, the upload error, and the six blocks in the AI panel, the scan
dialog and the 20rem preview rail. Everywhere else takes `md` — `sm` exists for
a notice inside a panel that is already tight, not as a way to preserve every
site's old size.

**One-offs, each stated because nothing else would catch it**

- a 4px left rail becomes a 1px border on four sides (`ApplicantDetailsCard`);
- `text-center` is dropped, because `Notice` sets `text-align: start` and its
  `className` is margin and width only (`PublicApplyHandler`);
- the retry button moves from beside the sentence to under it (`UploadField`) —
  the one site the new action placement visibly changes.

**What did NOT change, and is asserted**

Live regions balance exactly: **8 `role="alert"` became 8 `announce="assertive"`,
1 `role="status"` became 1 `announce="polite"`.** Getting one wrong either
silences a real error or interrupts over nothing, and 14 `getByRole('alert')`
assertions across this area's tests would fail if it happened. Every message's
wording is unchanged, `verification-error-summary` and the two `step-*-issues`
test ids ride through the prop spread, and the three focus targets keep their
`ref` and `tabIndex` — with a ring the component now draws itself.

---

# What 6d found: company-admin, campaigns and shared

**34 candidates → 12 notices.** The largest drop of any slice, and the seventh
consecutive one where a shape-only signature named the wrong component.

## The finding is bigger than the migration: 17 tinted ICON TILES

Of the 22 candidates that are not notices, **seventeen are a small tinted square
or circle holding exactly one glyph** — a section-header mark, a modal-header
mark, a row marker, a locked-feature badge. `applicationTabCards:310` ·
`NewDocumentDialog:81` · `TemplateLibraryPanel:107` · `NotesTab:229` ·
`LaunchPad:96` · `InlineLeaderboard:164` and `:202` · `PEVRequestModal:221` ·
`QuickLeadModal:154` · `VOEPreviewModal:121` and `:276` ·
`DriverProfileModal:250` · `PEVTabParts:63` · `NotificationItem:81` ·
`PaywallMessage:23` · `CompanyChooserModal:139` · `FeatureLockedModal:52`.

With the four the roadmap already recorded, that is **at least 21 sites across
six tints and five sizes** — now the largest un-owned shape left in the
application, and invisible to every rule for the same reason the notice was.
It is not built here: widening a migration slice to build a second primitive is
how a slice stops being reviewable.

The other five non-notices are a tinted list row (`DocumentsOverview:134`), an
unread-row tint (`NotificationDropdown:112`), a modal header band
(`FeatureDeactivationWarning:149`), a chat bubble (`NotesTab:242`, whose
`rounded-tl-none` is the speech corner) and the badge-tone map already recorded.

## The two guesses are settled, and the answer is that they stay guesses

`neutral`'s `Info` and `accent`'s `Sparkles` are recorded above as guesses
because nothing used those tones. 6d had six candidates that could have closed
them. **Every one is a tile, a medallion or a bubble.** So in this application
the accent and neutral tints are not message tints at all — they mark identity —
and neither default can ever be measured from this codebase.

**Both tones stay on the component anyway.** Polaris' default `Banner` is
exactly a neutral notice, and Atlassian's `SectionMessage` ships `discovery` —
an accent-toned notice for announcing something new. This codebase simply has
not written one. Removing them to match today's consumers would make the
component narrower than the standard it was built against, and the first person
who wants an announcement banner would hand-roll it, which is the failure this
phase exists to end.

## Two migrations that needed reading, not a table

- **`DQFileTab:321` is wrapped in an always-mounted `<div role="alert">`.** That
  wrapper is the live region and it stays; the `Notice` inside takes the default
  `announce="off"`. Moving the role onto the notice would look like a faithful
  migration and would quietly stop the announcement, because a live region added
  to the DOM at the same moment as its content is not reliably announced. The
  same reasoning `announce` is documented under, applied in reverse.
- **`LaunchPad`'s two blocks are the two outcomes of one pre-flight check**, and
  they had drifted apart: the failure was left-aligned with a heading, the
  success centred without one. Migrating only the failure would have made that
  worse. Both migrate and now share one treatment, left-aligned inside a centred
  card — which is what a block of content does under a centred headline.

## Glyphs passed explicitly, and why

Three sites keep a chosen glyph rather than taking the tone's, following the
rule 6c derived: **the default is for sites with no glyph.**

| site | glyph | why not the default |
|---|---|---|
| `ContentComposer:159` | `Zap` | the info tone's `Info` would make an encouraging "Pro Tips" panel clerical — one of the four substitutions 6c flagged as wrong |
| `PEVRequestModal:333` | `Info` | a deliberately calm legal note; the warning tone's `AlertTriangle` would escalate it. 6c named this the borderline case |
| `BulkUploadLayout:161` | `HelpCircle` | guidance on how to do the task, not information about its state |

Two lists lose their per-item glyphs (`LaunchPad`'s errors, `ContentComposer`'s
tips): one leading mark states the kind once, and repeating it on every line was
the hand-built way of drawing a list. Disc markers carry the enumeration, which
is also what assistive technology reads as a list.

---

# What 6e found: super-admin, settings, auth and the signing room

The last migration area. **34 candidates → 16 notices.** A 50% drop, against
6d's 65% and 6c's 15%.

## The rule this area added: a caller may already own the live region

**Five sites wrap the tinted block in a permanently-mounted `role="status"` or
`role="alert"`** and render the block conditionally inside it: `CreateView:289`
and `:297`, `UserMembershipsManager:316`, and `DQFileTab:321` migrated in 6d.

**When a caller already owns an always-mounted live region, the notice must not
take one.** Both failure modes are silent:

- two nested live regions announce the same text twice;
- moving the role onto the conditionally-rendered notice stops the announcement
  altogether, because a live region added to the DOM at the same moment as its
  content is not reliably announced.

So those sites keep their wrapper and pass the default `announce="off"`. This is
the same reasoning `announce` is documented under, applied in reverse, and it is
a pattern rather than a coincidence — worth checking for before every migration.

## Four sites compute their tone

`EmailSettingsTab:303` and `AddLineModal:247` pick tone — and one of them the
live role too — from a `testResult.success` ternary. These are the "tone from a
lookup" shape 6a counted separately and could not classify from a line at all.
They migrate as `tone={x ? 'success' : 'danger'}`, which is precisely what `tone`
and `announce` being props is for. `EmailSettingsTab` also loses an inner
`Badge` that was standing in for a title: a chip inside a message says the state
twice once the block carries a glyph of its own.

## Where the line falls between two blocks that look identical

`IntegrationManager:328` and `EmailSettingsTab:365` are both info-tinted blocks
with a bold label. One migrates and one does not:

**A label over PROSE is a notice; a label over DATA is not.** `:328` explains
what shared credentials do and where phone lines are managed. `:365` lists host,
port and username. `IntegrationManager:384` is prose too — it is *how to find*
the values, a sequence of steps, and it becomes an `<ol>` so assistive
technology reads it as one.

## The audit was wrong about one site, and reading the file caught it

`StatsBackfillPanel:207` was listed as a notice. It is a **results panel**: the
heading and sentence are followed by a nested summary card and a preview table.
The test the plan already stated — *a toned card becomes a `Notice` unless the
card carries other structure* — disqualifies it, and the enumeration could not
see that because a title and a sentence at the top look identical either way.
17 → 16.

## Two glyph decisions

- **`IntegrationManager:254` normalises `Activity` → the warning tone's
  `AlertTriangle`.** `Activity` is the integration-health domain mark and reads
  as decoration on a `role="alert"` fetch failure. Contrast the three glyphs
  6d kept explicitly: those said something the tone did not.
- **`LoginScreen:156` loses `animate-in slide-in-from-top-2`.** `Notice`'s
  `className` is margin and width only, and an animation is neither — but it is
  also the right answer on its own merits: that class carries no
  `prefers-reduced-motion` guard, and an alert sliding into view is exactly the
  case where motion should be reduced.

## The tile count rises a third time

Four more of the 18 non-notices are tinted icon tiles — `PersonalProfileTab:119`
(whose mark is `LinkIcon`, in a named region), `LoginScreen:338`, and
`AnalyticsView:276` and `:302`, the last two holding a **number** rather than a
glyph. That takes the roadmap's Tinted icon tile row from at least 21 to **at
least 25**.

The rest: two modal header bands, two full-panel states that belong to
`PageState`, three labelled data blocks, one section label, three chips, one
action panel, one inline toast, one form container.

## Two recorded claims disproved, both the same defect

6c's audit named four glyph substitutions that would be wrong. **Two of them
were not real.** `StatsBackfillPanel`'s `CheckCircle → AlertTriangle` and
`PersonalProfileTab`'s `Loader2 → Info` both came from a scan that returned a
CONTROL'S icon as the block's leading mark — a button's icon in the first case,
a copy button's loading spinner 28 lines away in the second. The other two,
`ShieldCheck` and `Zap`, hold up and were each verified by reading before being
acted on.

This is the same lesson at a third level:

- 6a — a text window cannot tell a child from a sibling;
- 6c — a diff hunk boundary cannot tell a child from a neighbour;
- 6e — **a subtree scan cannot tell a slot from anything inside it.**

A glyph is a claim about a slot. 6f's rule has to count slots, not subtrees.

---

# 6f: the guard, and what it found

`hand-composed-notice` landed 2026-09-06 and closes this family.

## The scope is a SLOT test, and that is the whole design

An element is a hand-composed notice when it carries **both halves** of the
signature — `bg-ds-status-X-bg` and `border-ds-status-X-border`, on the element
itself — and its own body holds **words** and holds **no control, table or
nested `Card`**.

The obvious rule, "an element with the status tint", was run over the tree
first. It matched **25 tinted icon tiles**: a square or circle holding one glyph
and no words. Allowlisting those would have been 25 boilerplate reasons, which
Phase 4 already ruled is the `debt` escape hatch under another name. The body
test excludes every one of them structurally instead.

That the test reads a **body** and not a subtree is the third instance of one
lesson this campaign kept paying for:

| | the lesson |
|---|---|
| 6a | a text window cannot tell a child from a sibling |
| 6c | a diff hunk boundary cannot tell a child from a neighbour |
| 6e | a subtree scan cannot tell a **slot** from anything inside it |

Two glyph findings recorded in this repository turned out to be a button's icon
read as a block's mark. A rule built on the same mistake would have inherited it.

## The rule found what three audits had not

Run for the first time, it matched **four sites nobody had classified**:

- **`ReviewChangePortal:132`** and **`SandboxActionPanel:127` and `:133`** —
  three genuine notices in `driver-changes` and `sandbox`, **two feature areas
  none of 6c, 6d or 6e covered.** The plan named three migration areas and they
  did not add up to the application. Nobody noticed until something scoped to the
  whole tree ran over the whole tree.
- **`ConfirmDialog:153`**, inside `src/design-system/` itself — the sixth
  instance of the always-mounted live wrapper, and 6a's ruling honoured: the rule
  does **not** exempt the design system, because a pattern that hand-builds the
  component sitting beside it is the drift rather than an exception to it.

**An audit covers what it was pointed at; a rule covers what exists.** All four
migrated rather than being allowlisted — adding an entry to make a rule pass is
the dishonesty this campaign refuses.

## 19 tolerated entries, each a judgement

228 → 247 violations across 34 → 46 files, and the count going up is the guard
improving, per the §7 precedent. What the rule deliberately cannot decide is the
judgement the three migrations made by hand: whether a tinted block that *does*
carry words is a message, a labelled data block, a chat bubble, a list row or a
modal header band. So the §7 review step stays, narrowed to exactly that.

Stories are held to the rule. The catalog demonstrates `Notice`; it does not
demonstrate the thing `Notice` replaced.

## P29 was hollow, and running the mutation is what showed it

The first version pinned depth-counted body reading with a fixture whose words
sat *inside* the nested element — so truncating the body at the first close tag
still found them, and the count did not move. Rewritten with two fixtures that
each change verdict, the sharper being that **a body read too short makes the
rule accuse a block that frames a form**. Third hollow assertion this campaign
has caught by running the mutation rather than reasoning about it, after
`classAndAttributeCount` and P22.
