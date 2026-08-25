# Tabs — TabList and TabPanel

The WAI-ARIA tab pattern.

Nine screens had hand-rolled this, and **seven of them had each written the same
`handleTabKeyDown`** with the same arrow/Home/End arithmetic. Two earlier copies
had `role="tab"` with no `aria-selected` and no arrow-key movement — a tablist
that announces itself as one and then does not behave like one.

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
- **Selection is text as well as colour** — a visually-hidden "(selected)"
  alongside `aria-selected`, because the underline is invisible to a
  colour-blind reader and absent in forced-colours mode.
- **The panel is `tabIndex={0}`**, so a keyboard user moving off the strip lands
  in the content they just switched to.
- **A vertical strip ignores the horizontal arrows**, so it cannot hijack the
  scroll keys of a horizontally scrolling region around it.

## Not this component

- **`SectionNavigation`** for moving between sections of a settings page. That
  is navigation, not a tab widget, and it has a different keyboard contract.
- **`Disclosure`** when more than one region may be open at once.
