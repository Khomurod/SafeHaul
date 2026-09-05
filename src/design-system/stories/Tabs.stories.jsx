import React, { useState } from 'react';
import { Icon, Archive, FileText, LayoutTemplate, Send } from '@design-system/icons';
import { Badge, Card, TabList, TabPanel } from '@design-system/components';
import { Stack } from '@design-system/layouts';

const TABS = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
];

function Example({
  orientation = 'horizontal', tabs = TABS, initial = 'documents', variant, fitted,
}) {
  const [active, setActive] = useState(initial);
  const idBase = `sb-${orientation}-${variant || 'underline'}-${fitted ? 'fitted' : 'hug'}`;
  const strip = (
    <TabList
      ariaLabel="Workspace views"
      idBase={idBase}
      tabs={tabs}
      activeTab={active}
      onChange={setActive}
      orientation={orientation}
      {...(variant ? { variant } : {})}
      {...(fitted ? { fitted } : {})}
    />
  );
  const panel = (
    <TabPanel idBase={idBase} tabId={active}>
      <div style={{ padding: 'var(--ds-space-4)' }}>
        Content for <strong>{tabs.find((t) => t.id === active)?.label}</strong>.
      </div>
    </TabPanel>
  );

  if (orientation === 'vertical') {
    return (
      <Card padding="none">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 200px) 1fr' }}>
          {strip}
          {panel}
        </div>
      </Card>
    );
  }
  return <Card padding="none"><Stack>{strip}{panel}</Stack></Card>;
}

const meta = {
  title: 'Components/Tabs',
  component: TabList,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-08-21.',
          '',
          'Nine screens had hand-rolled this, and seven of them had each written the same',
          '`handleTabKeyDown` with the same arrow/Home/End arithmetic. Two earlier copies had',
          '`role="tab"` with no `aria-selected` and no arrow-key movement — a tablist that',
          'announces itself as one and then does not behave like one.',
          '',
          '### Two exports, on purpose',
          '',
          '`TabList` and `TabPanel` are separate because two consumers render the strip and',
          'the panel in *different components* — the driver dossier\'s sidebar owns the strip',
          'and the profile modal owns the panel. They agree on ids through `tabIds`, which',
          'both call, so the `aria-controls` / `aria-labelledby` pair cannot drift apart.',
          '',
          '### Keyboard',
          '',
          '| Key | Does |',
          '| --- | --- |',
          '| `Tab` | Enters the strip at the selected tab, and leaves it. One stop, not one per tab |',
          '| `←` `→` (or `↑` `↓` when vertical) | Move and select, wrapping at both ends |',
          '| `Home` / `End` | First / last tab |',
          '',
          'Selection follows focus (automatic activation), which is right when switching is',
          'cheap and reversible — and is what all nine copies already did, so migrating them',
          'changes no behaviour.',
          '',
          '### Two shapes, and why they are props',
          '',
          'Eleven hand-rolled strips carried at least three appearances between them. A',
          'primitive expressing only the page-level underline would have left the others',
          'hand-rolled — which is how a primitive ends up with no consumers, as this one did',
          'for the four days between being built and being adopted.',
          '',
          '| Shape | For |',
          '| --- | --- |',
          '| `underline` (default) | A page-level view switcher |',
          '| `variant="pill"` | A secondary strip INSIDE a panel, where an underline would read as a second page-level strip |',
          '| `fitted` | A strip that must span a narrow container — a popover — instead of leaving a ragged gap |',
          '',
          'They differ in the selected treatment and nothing else: same height, same icon',
          'size, same keyboard model. `pill` with `orientation="vertical"` throws rather than',
          'being silently ignored — nothing wants it, and a quietly-dropped prop is how a',
          'component starts lying about what it supports.',
          '',
          '### Accessibility',
          '',
          '- Selection is carried by `aria-selected`, which is the whole mechanism the ARIA',
          '  tab pattern specifies. It used to *also* append a visually-hidden "(selected)" so',
          '  that selection was "not colour alone"; that made the selected tab announce its',
          '  state twice and put state inside its accessible NAME, so every exact-match query',
          '  for a tab had to know about it. The visual half of that concern lives in CSS now:',
          '  a `forced-colors` rule keeps the selected tab distinguished by a border that is',
          '  present against ones that are not, rather than by hue.',
          '- `aria-controls` is set on the SELECTED tab only. The design system renders one',
          '  panel, so pointing every tab at a panel id that does not exist was a dangling',
          '  IDREF — and the ARIA pattern makes the attribute optional in exactly that case.',
          '- The panel is `tabIndex={0}` by the pattern, so a keyboard user moving off the',
          '  strip lands in the content they just switched to. It forwards its ref, because',
          '  the driver dossier hands it to `Modal`\'s `initialFocusRef`.',
          '- `ariaLabel` is required. "tab list" is not a name.',
          '',
          '### Not a tab strip',
          '',
          'Use `SectionNavigation` for navigating between sections of a settings page — that',
          'is navigation, not a tab widget, and it has a different keyboard contract. Use',
          '`Disclosure` when more than one region may be open at once.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default horizontal strip. */
export const Default = { render: () => <Example /> };

/** Vertical, for a sidebar. Arrow keys follow the orientation. */
export const Vertical = { render: () => <Example orientation="vertical" /> };

/** A tab may carry a count. It sits inside the tab's accessible name. */
export const WithBadges = {
  render: () => (
    <Example
      tabs={[
        { id: 'documents', label: 'Documents', icon: FileText, badge: <Badge tone="info">12</Badge> },
        { id: 'sent', label: 'Sent', icon: Send, badge: <Badge tone="neutral">3</Badge> },
        { id: 'archive', label: 'Archive', icon: Archive },
      ]}
    />
  ),
};

/** Many tabs wrap rather than overflowing the card. */
export const ManyTabs = {
  render: () => (
    <Example
      tabs={Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: `Section ${i + 1}` }))}
      initial="t0"
    />
  ),
};

/**
 * `variant="pill"` — a secondary strip inside a panel. The campaign audience
 * builder's import-method chooser is the live consumer.
 */
export const PillVariant = { render: () => <Example variant="pill" /> };

/**
 * `fitted` — the tabs share the strip's width. For a narrow panel, where tabs
 * hugging their labels leave a ragged gap. The notification popover is the live
 * consumer.
 */
export const Fitted = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Example fitted tabs={TABS.slice(0, 2)} />
    </div>
  ),
};

/** Mobile width. The strip wraps; every tab keeps its full label and height. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => <Example />,
};
