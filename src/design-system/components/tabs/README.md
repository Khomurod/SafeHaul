# Tabs — TabList and TabPanel

The WAI-ARIA tab pattern.

Eleven strips had hand-rolled this, and **seven of them had each written the same
`handleTabKeyDown`** with the same arrow/Home/End arithmetic. Two had `role="tab"`
with no `aria-selected` and no arrow-key movement — a tablist that announces
itself as one and then does not behave like one. One, Company Settings →
Company Profile, had tab *behaviour* with no tab semantics at all: plain
`<button>`s, `activeTab` state and a coloured border, so assistive technology
could not tell it was a tab interface or say which section was current.

All eleven are migrated. `ds/use-primitive`, which refuses a raw
`role="tablist"`, is what keeps the twelfth from being written, because a roadmap line is not a
guard.

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

## The shapes

| Shape | For |
|---|---|
| `underline` (default) | A page-level view switcher in a card or a panel |
| `variant="segmented"` | A page's views on the canvas, drawn as a white tray of 36px items with the chosen tab dark — the look of a list's segments (`ListToolbar`), so a page's tabs and a list's segments read as one kind of control. A count goes in `badge` (`badge: 6`) and reads muted after the label ("Sent Documents 6"). Icons step aside under 768px, where the tabs make equal rows: two in halves, three in thirds, four in a 2 × 2 grid, more in rows of three, each 44px tall |
| `variant="pill"` | A secondary strip *inside* a panel: bordered pills with a full radius, the chosen one on the selected tint with an action-coloured border and text. The campaign audience builder's import-method chooser |
| `fitted` | A strip that must span a narrow container instead of leaving a ragged gap. The notification popover |

They differ in the drawing and nothing else — same keyboard model, same
semantics. `segmented` and `pill` share `segmentedGroup.css` with `TabNav` and
`ListToolbar`'s segments; the chosen item there is also semibold, so the choice
never rests on colour alone, and under `forced-colors` it is outlined in
`Highlight`. A primitive that could express only the first shape would have
left the others hand-rolled, which is exactly how a primitive ends up with no
consumers.

`segmented` or `pill` with `orientation="vertical"` **throws**. Nothing wants it,
and a silently-ignored prop combination is how a component starts lying about
what it supports.

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

## `TabNav`: views that are pages

When each view has its own address (a route), the strip is navigation, not a
tab widget. `TabNav` draws the same underlined strip, from the same `Tabs.css`,
as a named `<nav>` holding a list of links.

```jsx
<TabNav
  ariaLabel="Record lists"
  items={[{ id: 'all', label: 'All', href: '/records/all', onClick }, …]}
  currentId="all"
/>
```

| | `TabList` | `TabNav` |
|---|---|---|
| Role | `tablist` of `tab`s, one `tabpanel` | `navigation` holding a list of links |
| Selection | `aria-selected` | `aria-current="page"` on the page shown |
| `Tab` | One stop for the strip | Every link is a stop, in order |
| Arrow keys | Move and select | None: a page change is not a cheap, reversible switch |
| Activation | Selection follows focus | `Enter` or a click follows the link; the browser offers "open in a new tab" |

- **`ariaLabel` is required**, and every item needs an `href`: a link with no
  destination is a button.
- **Routing is the caller's.** The design system knows no router: an item takes
  an `href`, and an `onClick` (a router's link click handler) for an in-app move
  without a reload. The leads list's All · Assigned to me · Unassigned is the
  consumer.
- `variant="segmented"` draws the segmented tray, for a scope switch in a list's
  toolbar row (`ListToolbar`'s `lead`); `underline` is the default. Horizontal
  only, no icons or badges: nothing asks for more yet.

## Not this component

- **`SectionNavigation`** for moving between sections of a settings page. That
  is navigation, not a tab widget, and it has a different keyboard contract.
- **`TabNav`** (above) when each view is its own page.
- **`Disclosure`** when more than one region may be open at once.
