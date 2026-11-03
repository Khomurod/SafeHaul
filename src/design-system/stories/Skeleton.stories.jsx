import React from 'react';
import { Card, Skeleton } from '@design-system/components';
import { Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/Skeleton',
  component: Skeleton,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added for the company dashboard\'s counts (through',
          '`MetricCard loading`). Its pixel baselines came from CI (run 41659416292) and',
          'were looked at on a desktop (1440) and a phone (412) on 2026-11-03.',
          '',
          '### Intended use',
          '',
          'A grey placeholder where content is on its way and its shape is known, so the',
          'page keeps its layout and nothing jumps when the content arrives. Where the',
          'shape is not known, use `LoadingState`. An operation in flight is not this: that',
          'is `Button loading`.',
          '',
          '### Supported variants',
          '',
          '- `shape="line"` (default) stands in for text. Put it **inside** the element whose',
          '  text it replaces: it takes that text\'s height, so the line box keeps its size.',
          '  It takes no `height`.',
          '- `width`: `half`, `three-quarters`, `full` (default), a share of its container.',
          '- `shape="block" height="lg"` stands in for a tall control (152px).',
          '- Anything else throws outside a production build and draws a full-width line',
          '  (or a `lg` block) in one.',
          '',
          '### Accessibility expectations',
          '',
          '- **Always `aria-hidden`**, with no prop to un-hide it. Its caller announces what',
          '  is loading, once, in a polite `role="status"`: a group of cards once for the',
          '  group, a page through its own heading. A skeleton with no announcement is',
          '  silent to a screen-reader user.',
          '- The pulse stops under `prefers-reduced-motion`. It has the same timing as',
          '  `DataTable`\'s skeleton rows, so the two read as one family.',
          '',
          '### Common mistakes',
          '',
          '- A skeleton with no status sentence beside it.',
          '- A skeleton shaped unlike what usually arrives: it promises a layout and then',
          '  breaks the promise.',
          '- A skeleton for a save or a send in flight. That is `Button loading`.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

const WIDTHS = ['half', 'three-quarters', 'full'];

/**
 * Lines at each width inside heading-size and body-size text, beside the text
 * they stand in for, and the one block height inside a card. The status
 * sentence is what a screen reader hears; the placeholders are hidden.
 */
export const Shapes = {
  render: () => (
    <Stack gap="lg">
      <p role="status" className="sr-only">Loading the summary.</p>
      <div className="sb-grid">
        {WIDTHS.map((width) => (
          <div className="sb-specimen" key={width}>
            <span className="sb-specimen__label">width={width}</span>
            <p className="text-ds-heading-lg">Section title</p>
            <p className="text-ds-heading-lg"><Skeleton width={width} /></p>
            <p className="text-ds-body">A line of body text</p>
            <p className="text-ds-body"><Skeleton width={width} /></p>
          </div>
        ))}
      </div>
      <div className="sb-specimen">
        <span className="sb-specimen__label">shape=block height=lg</span>
        <Card padding="lg">
          <Skeleton shape="block" height="lg" />
        </Card>
      </div>
    </Stack>
  ),
};
