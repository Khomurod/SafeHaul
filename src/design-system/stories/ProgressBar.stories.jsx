import React from 'react';
import { ProgressBar } from '@design-system/components';
import { Stack } from '@design-system/layouts';

/**
 * `ProgressBar` is the approved determinate progress meter. It owns the track,
 * the fill, the tone and the ARIA `progressbar` semantics.
 */
const meta = {
  title: 'Components/ProgressBar',
  component: ProgressBar,
  args: { value: 40, max: 100, label: 'Completion', tone: 'info' },
  argTypes: {
    value: { control: { type: 'range', min: 0, max: 100, step: 1 } },
    max: { control: { type: 'number', min: 1 } },
    tone: { control: 'inline-radio', options: ['info', 'success', 'warning', 'danger'] },
    label: { control: 'text' },
    valueText: { control: 'text' },
  },
  parameters: {
    docs: {
      description: {
        component: [
          '**Status: Approved.** Added with the public driver application, which is its',
          'proven consumer.',
          '',
          '### Why it exists',
          '',
          'The application\'s step meter used to be a styled `<div>` that communicated',
          'progress by width alone — completely invisible to assistive technology. This',
          'primitive always exposes `aria-valuenow` and an accessible name, so progress is',
          'available to everyone.',
          '',
          '### Intended use',
          '',
          '**Determinate** progress only: a value out of a known maximum. There is no',
          'indeterminate mode. For work of unknown length, use a loading state such as the',
          '`DataTable` skeleton or a status message instead of a fake moving bar.',
          '',
          '### Supported variants',
          '',
          'Tones are `info` (default), `success`, `warning` and `danger`. `max` defaults to',
          '`100` but any positive number works, so a 3-of-7 step meter needs no percentage',
          'arithmetic at the call site.',
          '',
          '### Accessibility expectations',
          '',
          '- Either `label` or `labelledBy` is **required** and the component throws without',
          '  one. A nameless progress bar announces a number with no subject.',
          '- `valueText` overrides the announced value. Use it whenever the raw number is not',
          '  the useful sentence — `"Step 3 of 7"` is far better than `"3"`.',
          '- The value is clamped to `0…max`, so an out-of-range value cannot render a fill',
          '  wider than its track or announce an impossible number.',
          '- Non-finite values and a non-positive `max` throw rather than rendering `NaN%`.',
          '- **Tone is never the only signal.** A caller must supply a text label, and a',
          '  danger-toned bar still needs words nearby saying what went wrong.',
          '',
          '### Common mistakes',
          '',
          '- Using it as a decorative meter for a rating or a score. It announces itself as',
          '  progress toward completion.',
          '- Animating it to imply activity when the value has not changed.',
          '- Relying on the percentage alone in a step wizard, where users think in steps.',
          '',
          '### When feature-specific composition is acceptable',
          '',
          'Features decide what is being measured, what the label says and which state maps',
          'to which tone. They must not restyle the track or fill.',
        ].join('\n'),
      },
    },
  },
};

export default meta;

/** The default: an info-toned determinate bar. */
export const Default = {
  render: (args) => (
    <div className="sb-measure"><ProgressBar {...args} /></div>
  ),
};

/** All four tones. The label always says what the bar measures. */
export const Tones = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <ProgressBar value={45} label="In progress" tone="info" valueText="45% complete" />
        <ProgressBar value={100} label="Finished" tone="success" valueText="Complete" />
        <ProgressBar value={70} label="Approaching the limit" tone="warning" valueText="70% of the limit used" />
        <ProgressBar value={96} label="Over the safe threshold" tone="danger" valueText="96% of the limit used" />
      </Stack>
    </div>
  ),
};

/** Boundary values. Both ends render cleanly, with no sliver or overflow. */
export const BoundaryValues = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="md">
        <div className="sb-specimen">
          <span className="sb-specimen__label">value=0</span>
          <ProgressBar value={0} label="Not started" valueText="Not started" />
        </div>
        <div className="sb-specimen">
          <span className="sb-specimen__label">value=1</span>
          <ProgressBar value={1} label="Just started" valueText="1% complete" />
        </div>
        <div className="sb-specimen">
          <span className="sb-specimen__label">value=100</span>
          <ProgressBar value={100} label="Complete" tone="success" valueText="Complete" />
        </div>
        <div className="sb-specimen">
          <span className="sb-specimen__label">value=140 — clamped to max, never overflows</span>
          <ProgressBar value={140} label="Clamped" valueText="Complete" />
        </div>
      </Stack>
    </div>
  ),
};

/**
 * A step meter. `max` is the number of steps, and `valueText` announces
 * "Step 3 of 7" instead of the bare number — which is what a user is actually
 * tracking.
 */
export const StepMeter = {
  render: () => (
    <div className="sb-measure">
      <Stack gap="sm">
        <p style={{ margin: 0, fontWeight: 600 }} id="story-step-label">Step 3 of 7 — Details</p>
        <ProgressBar value={3} max={7} labelledBy="story-step-label" valueText="Step 3 of 7" />
      </Stack>
    </div>
  ),
};

/** Mobile width. The bar is full-width and the label wraps above it. */
export const NarrowViewport = {
  globals: { viewport: { value: 'safehaulMobile' } },
  render: () => (
    <Stack gap="sm">
      <p style={{ margin: 0, fontWeight: 600 }} id="story-step-label-mobile">
        Step 3 of 7 — Details about the record and the organisation responsible for it
      </p>
      <ProgressBar value={3} max={7} labelledBy="story-step-label-mobile" valueText="Step 3 of 7" />
    </Stack>
  ),
};
