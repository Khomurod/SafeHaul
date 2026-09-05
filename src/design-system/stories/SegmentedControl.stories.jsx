import React, { useState } from 'react';
import {
    Icon, Ban, CheckCircle, Clock, LayoutGrid, List, Rows3, XCircle
} from '@design-system/icons';
import { Card, SegmentedControl } from '@design-system/components';
import { Stack } from '@design-system/layouts';

const meta = {
  title: 'Components/SegmentedControl',
  component: SegmentedControl,
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added 2026-08-21, retiring four separate recorded',
          'exceptions that were each a `role="group"` of raw `<button aria-pressed>` cards.',
          '',
          '### Why `aria-pressed` and not a radiogroup',
          '',
          'A radiogroup is the textbook choice for single-select, and it is the wrong one',
          'here. It brings the roving-focus keyboard model with it — arrow keys move *and*',
          'select, and Tab leaves the group. Every call site is a grid of tappable cards that',
          'users reach one at a time with Tab, and two of them sit inside a form where the',
          'arrow keys already mean something else.',
          '',
          '`role="group"` with `aria-pressed` keeps each option individually tabbable and',
          'announces its state. The trade-off is deliberate, and it has a limit: **this is',
          'not the pattern for a long list of mutually exclusive options.** For that, use',
          '`ChoiceGroup` with `Radio`, which is a real radiogroup.',
          '',
          '### Accessibility',
          '',
          '- `ariaLabel` is required. "pressed" on its own does not say what was chosen.',
          '- Selection is a filled tint **plus** a heavier border, never the tint alone —',
          '  the tint is what disappears in forced-colours mode.',
          '- A multi-column grid collapses to one column below 640px. Two cards at 412px get',
          '  about 170px each, which truncates any real label.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

function Example({ options, columns = 2, initial = null, label = 'Result' }) {
  const [value, setValue] = useState(initial);
  return (
    <Card>
      <SegmentedControl ariaLabel={label} options={options} value={value} onChange={setValue} columns={columns} />
    </Card>
  );
}

/** A toned grid of outcome cards — the shape all four call sites had. */
export const TonedGrid = {
  render: () => (
    <Example
      label="Result"
      columns={2}
      initial="reached"
      options={[
        { value: 'reached', label: 'Reached / interested', icon: CheckCircle, tone: 'success' },
        { value: 'callback', label: 'Reached / call back', icon: Clock, tone: 'info' },
        { value: 'declined', label: 'Reached / declined', icon: Ban, tone: 'warning' },
        { value: 'no_answer', label: 'No answer', icon: XCircle, tone: 'danger' },
      ]}
    />
  ),
};

/** A compact two-option toggle — the other shape, a view switcher. */
export const TwoOptionToggle = {
  render: () => (
    <Example
      label="Layout"
      columns={2}
      initial="list"
      options={[
        { value: 'list', label: 'List', icon: List },
        { value: 'grid', label: 'Grid', icon: LayoutGrid },
      ]}
    />
  ),
};

/** Three columns, and one option unavailable. */
export const WithDisabledOption = {
  render: () => (
    <Example
      label="Density"
      columns={3}
      initial="comfortable"
      options={[
        { value: 'comfortable', label: 'Comfortable', icon: Rows3 },
        { value: 'compact', label: 'Compact', icon: List },
        { value: 'custom', label: 'Custom', disabled: true },
      ]}
    />
  ),
};

/** Nothing chosen yet. Every option reads as unpressed, none as default. */
export const NoSelection = {
  render: () => (
    <Example
      label="Result"
      columns={2}
      options={[
        { value: 'a', label: 'First option', tone: 'success' },
        { value: 'b', label: 'Second option', tone: 'danger' },
      ]}
    />
  ),
};

/** Mobile: the grid collapses to one column so labels are not truncated. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Example
      label="Result"
      columns={2}
      initial="reached"
      options={[
        { value: 'reached', label: 'Reached / interested', icon: CheckCircle, tone: 'success' },
        { value: 'callback', label: 'Reached / call back', icon: Clock, tone: 'info' },
        { value: 'declined', label: 'Reached / declined', icon: Ban, tone: 'warning' },
        { value: 'no_answer', label: 'No answer', icon: XCircle, tone: 'danger' },
      ]}
    />
  ),
};
