import React, { useState } from 'react';
import { Archive, FileText, LayoutTemplate, Send } from 'lucide-react';
import { Badge, Card, TabList, TabPanel } from '@design-system/components';
import { Stack } from '@design-system/layouts';

const TABS = [
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'sent', label: 'Sent', icon: Send },
  { id: 'archive', label: 'Archive', icon: Archive },
];

function Example({ orientation = 'horizontal', tabs = TABS, initial = 'documents' }) {
  const [active, setActive] = useState(initial);
  const strip = (
    <TabList
      ariaLabel="Workspace views"
      idBase={`sb-${orientation}`}
      tabs={tabs}
      activeTab={active}
      onChange={setActive}
      orientation={orientation}
    />
  );
  const panel = (
    <TabPanel idBase={`sb-${orientation}`} tabId={active}>
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
          '### Accessibility',
          '',
          '- Selection is carried by `aria-selected` **and** by visually-hidden "(selected)"',
          '  text, never by the underline colour alone.',
          '- The panel is `tabIndex={0}` by the pattern, so a keyboard user moving off the',
          '  strip lands in the content they just switched to.',
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

/** Mobile width. The strip wraps; every tab keeps its full label and height. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => <Example />,
};
