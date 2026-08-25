# Tabs — TabList and TabPanel

The WAI-ARIA tab pattern.

Eleven strips had hand-rolled this, and **seven of them had each written the same
`handleTabKeyDown`** with the same arrow/Home/End arithmetic. Two had `role="tab"`
with no `aria-selected` and no arrow-key movement — a tablist that announces
itself as one and then does not behave like one. One, Company Settings →
Company Profile, had tab *behaviour* with no tab semantics at all: plain
`<button>`s, `activeTab` state and a coloured border, so assistive technology
could not tell it was a tab interface or say which section was current.

All eleven are migrated (2026-08-25). `check:ui-contract`'s
`hand-rolled-tablist` rule is what keeps the twelfth from being written: this
component was built on 2026-08-21 and still had **zero** consumers four days
later, because a roadmap line is not a guard.

```jsx
const [active, setActive] = useState('documents');

<TabList
  ariaLabel="Documents workspace views"
  idBase="documents"
  tabs={[{ id: 'documents', label: 'Documents', icon: FileText }, …]}
  activeTab={active}
  onChange={setActive}
/>
<TabPanel idBase="documents" tabId={active}>{body}</TabPanel>
```

## Two exports, on purpose

They are separate because two consumers render the strip and the panel in
*different components* — the driver dossier's sidebar owns the strip and the
profile modal owns the panel. Both derive their ids from `idBase` through
`tabIds`, so the `aria-controls` / `aria-labelledby` pair cannot drift apart by
hand.

## Two shapes

| Shape | For |
|---|---|
| `underline` (default) | A page-level view switcher. Nine of the eleven call sites |
| `variant="pill"` | A secondary strip *inside* a panel, where an underline would read as a second page-level strip. The campaign audience builder's import-method chooser |
| `fitted` | A strip that must span a narrow container instead of leaving a ragged gap. The notification popover |

They differ in the selected treatment and nothing else — same control height,
same icon size, same keyboard model. A primitive that could express only the
first shape would have left the other two hand-rolled, which is exactly how a
primitive ends up with no consumers.

`variant="pill"` with `orientation="vertical"` **throws**. Nothing wants it, and
a silently-ignored prop combination is how a component starts lying about what it
supports.

## Keyboard

| Key | Does |
|---|---|
| `Tab` | Enters the strip at the selected tab, and leaves it — one stop for the whole strip |
| `←` `→` (`↑` `↓` when vertical) | Move and select, wrapping at both ends |
| `Home` / `End` | First / last tab |

Selection follows focus (automatic activation). That is correct when switching
is cheap and reversible, and it is what all nine hand-rolled copies did, so
migrating them changes no behaviour.

## Rules the tests pin

- **`ariaLabel` is required.** "tab list" is not a name.
- **Roving `tabIndex`.** Exactly one tab is in the tab order; without it a
  ten-tab strip costs ten Tab presses to walk past.
- **Selection is `aria-selected`, and nothing else in the name.** This component
  used to append a visually-hidden "(selected)" as well, so that selection was
  "not colour alone". It made the selected tab announce its state twice, and it
  put state inside the accessible *name* — so every exact-match query for a tab
  had to know about it. The visual half of that concern is real and is handled in
  `Tabs.css`: under `forced-colors: active` the unselected border is `Canvas` and
  the selected one is `Highlight`, so the distinction is a border that is
  *present* against ones that are not, rather than a hue.
- **`aria-controls` is on the selected tab only.** One panel is rendered, so
  pointing every tab at a panel id that does not exist was a dangling IDREF. The
  ARIA tab pattern makes the attribute optional in exactly that case, and it is
  what lets a consumer share one panel between tabs — the notification popover
  does.
- **The panel is `tabIndex={0}`**, so a keyboard user moving off the strip lands
  in the content they just switched to. It **forwards its ref**, because the
  panel is a real focus target: the driver dossier hands it to `Modal`'s
  `initialFocusRef` so opening the dialog lands the user in the content rather
  than on its close button.
- **A vertical strip ignores the horizontal arrows**, so it cannot hijack the
  scroll keys of a horizontally scrolling region around it.

## Not this component

- **`SectionNavigation`** for moving between sections of a settings page. That
  is navigation, not a tab widget, and it has a different keyboard contract.
- **`Disclosure`** when more than one region may be open at once.
