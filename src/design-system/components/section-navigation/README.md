# SectionNavigation

`SectionNavigation` is the approved business-neutral pattern for switching
between grouped sections inside a feature workspace. Features own group labels,
item availability, the current identifier, and the content rendered after a
selection.

The component provides:

- a labelled navigation landmark and labelled groups;
- `aria-current="page"` for the selected destination;
- optional `aria-controls` linkage to the content region;
- 44px minimum targets, visible focus, selected, hover, and disabled states;
- Arrow Up/Down, Home, and End focus movement without replacing native Tab
  order;
- stack and compact grid mobile layouts without an inner horizontal scroller.

It does not own routes, permissions, feature flags, tab state, data loading, or
business vocabulary.
