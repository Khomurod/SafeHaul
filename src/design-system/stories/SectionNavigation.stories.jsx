import React, { useState } from 'react';
import { Bell, FileText, History, Settings, Shield, SlidersHorizontal } from 'lucide-react';
import { Card, SectionNavigation } from '@design-system/components';
import { Stack } from '@design-system/layouts';
import { NAVIGATION_GROUPS } from './fixtures';

const ICONS = {
  overview: FileText,
  details: SlidersHorizontal,
  history: History,
  preferences: Settings,
  notifications: Bell,
  advanced: Shield,
};

const withIcons = (groups) =>
  groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item, icon: ICONS[item.id] })),
  }));

/**
 * Stateful wrapper. `SectionNavigation` is controlled — it never owns which
 * section is current, because that belongs to the feature.
 */
function SectionNavigationExample({ groups = NAVIGATION_GROUPS, initialId = 'overview', ...props }) {
  const [currentId, setCurrentId] = useState(initialId);
  return (
    <SectionNavigation
      {...props}
      groups={groups}
      currentId={currentId}
      onSelect={setCurrentId}
    />
  );
}

/**
 * `SectionNavigation` is the approved grouped in-page navigation: a labelled
 * `<nav>` containing headed groups of section links.
 */
const meta = {
  title: 'Components/SectionNavigation',
  component: SectionNavigation,
  args: { label: 'Section navigation', mobileLayout: 'stack' },
  argTypes: {
    mobileLayout: { control: 'inline-radio', options: ['stack', 'grid'] },
    groups: { control: false },
    currentId: { control: false },
    onSelect: { control: false },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Consumed by the Company Settings shell, which keeps its own',
          'tab state, labels, feature flags, permissions and rendered content.',
          '',
          '**Important:** this is *not* a WAI-ARIA tablist, and it is not a substitute for',
          'one. There is still **no approved `Tabs` primitive** — the driver dossier\'s',
          'tablist is a recorded feature-owned exception. Use `SectionNavigation` for a',
          'settings-style sidebar of grouped sections; do not restyle it into a horizontal',
          'tab strip.',
          '',
          '### Intended use',
          '',
          'Navigating between sections of one screen when the sections fall into named',
          'groups. Below about five ungrouped sections, plain in-page headings are simpler.',
          '',
          '### Supported variants',
          '',
          '`mobileLayout` is `stack` (default — one item per row) or `grid` (a compact tile',
          'grid for short labels). `label` names the `<nav>` landmark.',
          '',
          '### Accessibility expectations',
          '',
          '- It renders a real `<nav>` with an accessible name, and each group is a',
          '  `<section>` labelled by its own heading, so the structure is navigable.',
          '- The current item carries `aria-current="page"` — not just a colour change.',
          '- Arrow Up/Down move focus between items, and Home/End jump to the first and last.',
          '  Disabled items are skipped, and focus wraps at both ends.',
          '- **Moving focus does not select.** Selection happens on activation, which is the',
          '  correct model for navigation (unlike a radio group, where selection follows',
          '  focus).',
          '- `controlsId` should point at the region the navigation swaps, so the',
          '  relationship is announced.',
          '- Icons are decorative and `aria-hidden`; the label carries the meaning.',
          '',
          '### Common mistakes',
          '',
          '- Using it as a tablist by adding `role="tab"` — that changes the expected keyboard',
          '  contract and then only half of it is implemented.',
          '- Marking the current item with colour alone.',
          '- Disabling an item with no explanation anywhere on the page.',
          '- Putting one item in a group; a group heading with a single child is noise.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features own the groups, the labels, the icons, which items are disabled, the',
          'current-section state and everything the content region renders. They must not',
          'restyle the navigation or reimplement its keyboard behaviour.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default stacked navigation, with a disabled item in the second group. */
export const Default = {
  render: (args) => (
    <div className="sb-measure">
      <SectionNavigationExample {...args} />
    </div>
  ),
};

/** Icons reinforce each item; the label still carries the meaning. */
export const WithIcons = {
  render: (args) => (
    <div className="sb-measure">
      <SectionNavigationExample {...args} groups={withIcons(NAVIGATION_GROUPS)} />
    </div>
  ),
};

/** The real composition: navigation beside the region it controls. */
export const WithContentRegion = {
  parameters: { layout: 'fullscreen' },
  render: (args) => (
    <div className="sb-page">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(200px, 260px) 1fr',
          gap: 'var(--ds-space-5)',
          alignItems: 'start',
        }}
      >
        <SectionNavigationExample
          {...args}
          groups={withIcons(NAVIGATION_GROUPS)}
          controlsId="story-section-panel"
        />
        <Card id="story-section-panel">
          <Stack gap="sm">
            <h2 style={{ margin: 0 }}>Overview</h2>
            <p style={{ margin: 0 }}>
              The navigation points at this region with <code>controlsId</code>, so the
              relationship between the two is announced rather than merely visual.
            </p>
          </Stack>
        </Card>
      </div>
    </div>
  ),
};

/** `mobileLayout="grid"` packs short labels into tiles on narrow screens. */
export const MobileGridLayout = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: (args) => <SectionNavigationExample {...args} mobileLayout="grid" />,
};

/** `mobileLayout="stack"` — the default — at mobile width. */
export const MobileStackLayout = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: (args) => <SectionNavigationExample {...args} mobileLayout="stack" groups={withIcons(NAVIGATION_GROUPS)} />,
};

/**
 * Long labels. The disabled third item in the second group is deliberately long
 * — labels wrap inside the item rather than truncating, because a truncated
 * navigation label leaves the user guessing where a link goes.
 */
export const LongLabels = {
  render: (args) => (
    <div style={{ maxWidth: '240px' }}>
      <SectionNavigationExample {...args} groups={withIcons(NAVIGATION_GROUPS)} />
    </div>
  ),
};

/** Keyboard behaviour, spelled out. */
export const KeyboardNavigation = {
  render: (args) => (
    <div className="sb-measure">
      <Stack gap="md">
        <p className="sb-note">
          <kbd>Tab</kbd> into the navigation, then <kbd>↑</kbd>/<kbd>↓</kbd> to move between
          items and <kbd>Home</kbd>/<kbd>End</kbd> to jump to the ends. Focus wraps and skips
          the disabled item. Moving focus does <strong>not</strong> change the section —
          press <kbd>Enter</kbd> or <kbd>Space</kbd> to activate.
        </p>
        <SectionNavigationExample {...args} groups={withIcons(NAVIGATION_GROUPS)} />
      </Stack>
    </div>
  ),
};
