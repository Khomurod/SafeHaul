import React, { useState } from 'react';
import { Badge, Button, Card, Disclosure } from '@design-system/components';
import { Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/Disclosure',
  component: Disclosure,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-08-21.',
          '',
          'The roadmap recorded why `Button` could not supply this: the trigger must fill its',
          'rail edge to edge, carry a rotating affordance, and sit *inside a heading* so the',
          'section appears in the document outline. `Button`\'s padding and inline layout',
          'express none of those.',
          '',
          '### Why not `<details>` / `<summary>`',
          '',
          'Genuinely tempting and genuinely wrong here. The native element keeps its',
          'open/closed state in the DOM rather than in React state, so a sidebar that',
          'remembers which sections are open has to fight it; and `<summary>`\'s marker and',
          'focus behaviour are still inconsistent enough across browsers that every real use',
          'overrides them anyway.',
          '',
          '### More than one may be open',
          '',
          'That is the property one consumer chose this over a tab strip for. If exactly one',
          'region should be visible at a time, you want `Tabs`, not several of these.',
          '',
          '### Accessibility',
          '',
          '- `aria-expanded` on the trigger carries the state; the chevron rotation is',
          '  decorative and never the only signal.',
          '- The heading wraps the button, not the reverse — a button containing a heading is',
          '  not a heading, and the section would vanish from the outline.',
          '- Content is **unmounted** when closed, not `hidden`. A stale focus target inside a',
          '  collapsed section is otherwise reachable by find-in-page and by browse mode.',
          '- `headingLevel` matches the surrounding outline; default `3`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** A rail of sections, several open at once. */
export const Default = {
  render: function DefaultStory() {
    const [open, setOpen] = useState({ one: true, two: true, three: false });
    const toggle = (key) => (value) => setOpen((state) => ({ ...state, [key]: value }));
    return (
      <Card padding="none" style={{ maxWidth: 320 }}>
        <Disclosure title="Required fields" meta={<Badge tone="info">4</Badge>} open={open.one} onToggle={toggle('one')}>
          <Stack gap="sm">
            <Button size="sm" fullWidth justify="start">Full name</Button>
            <Button size="sm" fullWidth justify="start">Date</Button>
          </Stack>
        </Disclosure>
        <Disclosure title="Optional fields" meta={<Badge tone="neutral">2</Badge>} open={open.two} onToggle={toggle('two')}>
          <Stack gap="sm">
            <Button size="sm" fullWidth justify="start">Reference</Button>
          </Stack>
        </Disclosure>
        <Disclosure title="Advanced" open={open.three} onToggle={toggle('three')}>
          <p style={{ margin: 0, color: 'var(--ds-color-content-secondary)' }}>Nothing configured.</p>
        </Disclosure>
      </Card>
    );
  },
};

/** Uncontrolled: it opens and closes on its own. */
export const Uncontrolled = {
  render: () => (
    <Card padding="none" style={{ maxWidth: 420 }}>
      <Disclosure title="Closed by default">Body content.</Disclosure>
      <Disclosure title="Open by default" defaultOpen>Body content.</Disclosure>
    </Card>
  ),
};

/** A long title truncates rather than pushing the chevron off the edge. */
export const LongTitle = {
  render: () => (
    <Card padding="none" style={{ maxWidth: 280 }}>
      <Disclosure
        title="A section title long enough to need truncating"
        meta={<Badge tone="warning">12</Badge>}
        defaultOpen
      >
        Body content.
      </Disclosure>
    </Card>
  ),
};

export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Card padding="none">
      <Disclosure title="Required fields" meta={<Badge tone="info">4</Badge>} defaultOpen>
        Body content.
      </Disclosure>
      <Disclosure title="Optional fields">Body content.</Disclosure>
    </Card>
  ),
};
