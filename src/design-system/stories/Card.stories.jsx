import React from 'react';
import { fn } from 'storybook/test';
import { Activity, FileText, Inbox, TrendingUp } from 'lucide-react';
import { Badge, Button, Card, MetricCard } from '@design-system/components';
import { Inline, ResponsiveGrid, Stack } from '@design-system/layouts';

/**
 * `Card` is the approved surface primitive: an elevated, bordered region that
 * groups related content. `MetricCard` is the single-number summary tile built
 * on the same surface.
 */
const meta = {
  title: 'Components/Card',
  component: Card,
  argTypes: {
    padding: { control: 'inline-radio', options: ['none', 'sm', 'md', 'lg'] },
    as: { control: 'text', description: 'Rendered element. Defaults to `section`.' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved for `Card`. `MetricCard` is Approved with a caveat** — it is',
          'proven by the Company dashboard, but a compatibility `StatCard` still exists',
          'elsewhere and the roadmap keeps the card family open until those consumers are',
          'migrated. Prefer `MetricCard`; do not add new `StatCard` usage.',
          '',
          '### Intended use',
          '',
          '`Card` groups content that belongs together and needs to be visually separated',
          'from the page canvas. `MetricCard` shows one labelled number, optionally as a',
          'button that filters or navigates.',
          '',
          '### Supported variants',
          '',
          '- `Card` padding: `none`, `sm`, `md` (default), `lg`. `none` is for a card whose',
          '  child manages its own edges — a table, or an image that must bleed to the border.',
          '- `Card` renders `<section>` by default; use `as` for a different element when the',
          '  document outline needs it (`as="article"`, `as="div"`).',
          '- `MetricCard` tones: `neutral`, `info`, `success`, `warning`, `danger`, `accent`.',
          '',
          '### Accessibility expectations',
          '',
          '- A `Card` is a container, not a control. It has no role and must not take a',
          '  click handler — a whole clickable card hides the real action from keyboard and',
          '  screen-reader users. Put a `Button` or link inside it instead.',
          '- Because the default element is `<section>`, a card that is a landmark region',
          '  should be named: give it an `aria-labelledby` pointing at its own heading.',
          '- `MetricCard` becomes a real `<button>` only when `onActivate` is supplied, and',
          '  it then carries `aria-label="{label}: {value}"` plus `aria-pressed` when active.',
          '  A non-interactive metric renders a plain `div` with no misleading role.',
          '- Tone on a `MetricCard` is decoration. The label and value carry the meaning.',
          '',
          '### Common mistakes',
          '',
          '- Nesting cards inside cards to create hierarchy. Two levels of elevation reads as',
          '  noise; use a heading or a `Stack` instead.',
          '- Using `padding="none"` and then hand-rolling padding on the child, which drifts',
          '  from the token scale.',
          '- Attaching `onClick` to the card wrapper.',
          '- Using `MetricCard` for anything that is not a single scannable value.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features decide what goes in a card, which metrics matter, and what activating a',
          'metric filters. They must not change the card surface, radius, border or shadow.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default card: `padding="md"` on a `<section>`. */
export const Default = {
  render: (args) => (
    <Card {...args}>
      <Stack gap="sm">
        <h2 style={{ margin: 0 }}>Card title</h2>
        <p style={{ margin: 0 }}>
          A card groups related content and separates it from the page canvas. It owns the
          surface, border, radius and elevation; the content is entirely yours.
        </p>
      </Stack>
    </Card>
  ),
};

/** The four padding steps. `none` is for children that manage their own edges. */
export const Padding = {
  render: () => (
    <ResponsiveGrid minItemWidth="240px">
      {['none', 'sm', 'md', 'lg'].map((padding) => (
        <div className="sb-specimen" key={padding}>
          <span className="sb-specimen__label">padding={padding}</span>
          <Card padding={padding}>
            <p style={{ margin: 0 }}>Content at <code>{padding}</code> padding.</p>
          </Card>
        </div>
      ))}
    </ResponsiveGrid>
  ),
};

/** A card with a heading, body, status and its own actions. */
export const WithHeaderAndActions = {
  render: () => (
    <Card>
      <Stack gap="md">
        <Inline gap="sm">
          <h2 style={{ margin: 0, flex: 1 }}>Record summary</h2>
          <Badge tone="success">Complete</Badge>
        </Inline>
        <p style={{ margin: 0 }}>
          Cards carry their own actions in a footer row. The card never becomes the button —
          the actions are real controls a keyboard user can reach individually.
        </p>
        <Inline gap="sm">
          <Button variant="primary" onClick={fn()}>Open record</Button>
          <Button variant="secondary" onClick={fn()}>Download</Button>
        </Inline>
      </Stack>
    </Card>
  ),
};

/** Every `MetricCard` tone, non-interactive. */
export const MetricCardTones = {
  render: () => (
    <ResponsiveGrid minItemWidth="200px">
      <MetricCard label="Total records" value="1,284" tone="neutral" icon={<FileText size={20} />} />
      <MetricCard label="In review" value="36" tone="info" icon={<Activity size={20} />} />
      <MetricCard label="Completed" value="912" tone="success" icon={<TrendingUp size={20} />} />
      <MetricCard label="Expiring soon" value="18" tone="warning" icon={<Inbox size={20} />} />
      <MetricCard label="Blocked" value="4" tone="danger" icon={<Inbox size={20} />} />
      <MetricCard label="Priority" value="7" tone="accent" icon={<Activity size={20} />} />
    </ResponsiveGrid>
  ),
};

/**
 * With `onActivate`, a `MetricCard` becomes a real button and can be used as a
 * filter. `active` reflects the pressed state to assistive technology.
 */
export const MetricCardInteractive = {
  render: () => (
    <ResponsiveGrid minItemWidth="200px">
      <MetricCard label="All records" value="1,284" tone="neutral" active onActivate={fn()} />
      <MetricCard label="In review" value="36" tone="info" onActivate={fn()} />
      <MetricCard label="Completed" value="912" tone="success" onActivate={fn()} />
    </ResponsiveGrid>
  ),
};

/**
 * Long labels and unusually wide values. `MetricCard` truncates its label and
 * keeps the full text in a `title`, so a tile never pushes its neighbours out of
 * alignment.
 */
export const LongContent = {
  render: () => (
    <Stack gap="lg">
      <ResponsiveGrid minItemWidth="200px">
        <MetricCard
          label="Records awaiting secondary verification before release"
          value="1,284,509"
          tone="warning"
        />
        <MetricCard label="Short" value="8" tone="neutral" />
      </ResponsiveGrid>
      <Card>
        <Stack gap="sm">
          <h2 style={{ margin: 0 }}>
            A heading long enough to wrap onto a second line inside the card surface
          </h2>
          <p style={{ margin: 0 }}>
            Cards grow with their content and never clip it. Verify that wrapped headings keep
            their spacing from the body copy, and that the longest single unbroken value in the
            content — for example an identifier like
            {' '}<code>RECORD-000000000000000000000042</code> — does not force the card to
            scroll horizontally.
          </p>
        </Stack>
      </Card>
    </Stack>
  ),
};

/** Narrow viewport: metric tiles reflow to a single column. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="md">
      <ResponsiveGrid minItemWidth="200px">
        <MetricCard label="Total records" value="1,284" tone="neutral" onActivate={fn()} />
        <MetricCard label="In review" value="36" tone="info" onActivate={fn()} />
        <MetricCard label="Expiring soon" value="18" tone="warning" onActivate={fn()} />
      </ResponsiveGrid>
      <Card>
        <p style={{ margin: 0 }}>Cards keep their padding at mobile width.</p>
      </Card>
    </Stack>
  ),
};
