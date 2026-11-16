import React from 'react';
import { IconButton, Tooltip } from '@design-system/components';
import { Icon, LayoutDashboard, Megaphone, Settings } from '@design-system/icons';

const meta = {
  title: 'Components/Tooltip',
  component: Tooltip,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-11-12.',
          '',
          'The name of an icon-only control, shown beside it on hover and keyboard focus:',
          'a folded sidebar\'s items. The label is drawn on `document.body`, so a scrolling',
          'or clipped container around the control cannot cut it off.',
          '',
          '### Accessibility',
          '',
          '- The control names itself (`aria-label`); the label is `aria-hidden`, so the',
          '  name is heard once.',
          '- WCAG 1.4.13: it stays while the pointer moves onto it, stays until hover or',
          '  focus ends, and Escape dismisses it.',
          '- A click\'s focus does not show it; a keyboard focus does.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Campaigns', icon: Megaphone },
  { label: 'Settings', icon: Settings },
];

/** A folded menu in a clipped, scrolling column: hover or Tab to an item. */
export const FoldedMenu = {
  render: () => (
    <nav
      aria-label="Example sections"
      style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 64, padding: 8, overflow: 'hidden auto' }}
    >
      {ITEMS.map((item) => (
        <Tooltip key={item.label} label={item.label}>
          <IconButton label={item.label} variant="ghost">
            <Icon icon={item.icon} size="lg" />
          </IconButton>
        </Tooltip>
      ))}
    </nav>
  ),
};
